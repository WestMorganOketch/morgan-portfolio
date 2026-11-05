import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CAREER_DOCUMENT_BYTES,
  createCareerDocumentService,
  decryptCareerDocument,
  encryptCareerDocument,
  validateCareerDocumentMetadata,
} from "../src/careerDocuments.js";

const KEY = "6b".repeat(32);
const ID = "5a3b67f3-ecda-47ac-9b90-b836f0289d11";
const PDF = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "utf8");

test("career document encryption round-trips bytes and authenticates its identity and MIME metadata", () => {
  const encrypted = encryptCareerDocument(PDF, KEY, { documentId: ID, contentType: "application/pdf" });
  assert.notDeepEqual(encrypted.ciphertext, PDF);
  assert.equal(encrypted.encryption_iv.length, 12);
  assert.equal(encrypted.encryption_tag.length, 16);
  assert.equal(encrypted.plaintext_sha256.length, 64);
  assert.deepEqual(decryptCareerDocument(encrypted.ciphertext, KEY, {
    documentId: ID,
    contentType: "application/pdf",
    encryptionIv: encrypted.encryption_iv,
    encryptionTag: encrypted.encryption_tag,
    plaintextSha256: encrypted.plaintext_sha256,
  }), PDF);
  assert.throws(() => decryptCareerDocument(encrypted.ciphertext, "4c".repeat(32), {
    documentId: ID,
    contentType: "application/pdf",
    encryptionIv: encrypted.encryption_iv,
    encryptionTag: encrypted.encryption_tag,
    plaintextSha256: encrypted.plaintext_sha256,
  }), /could not be authenticated or decrypted/i);
  assert.throws(() => decryptCareerDocument(encrypted.ciphertext, KEY, {
    documentId: "6a3b67f3-ecda-47ac-9b90-b836f0289d11",
    contentType: "application/pdf",
    encryptionIv: encrypted.encryption_iv,
    encryptionTag: encrypted.encryption_tag,
    plaintextSha256: encrypted.plaintext_sha256,
  }), /could not be authenticated or decrypted/i);
  const tampered = Buffer.from(encrypted.ciphertext);
  tampered[0] ^= 1;
  assert.throws(() => decryptCareerDocument(tampered, KEY, {
    documentId: ID,
    contentType: "application/pdf",
    encryptionIv: encrypted.encryption_iv,
    encryptionTag: encrypted.encryption_tag,
    plaintextSha256: encrypted.plaintext_sha256,
  }), /could not be authenticated or decrypted/i);
});

test("career document metadata validation bounds title, kind, MIME, filename and content size", () => {
  const result = validateCareerDocumentMetadata({
    title: "Master CV",
    kind: "master_resume",
    originalFilename: "../../Morgan Resume.pdf",
    contentType: "application/pdf",
    buffer: PDF,
  });
  assert.equal(result.originalFilename, "Morgan Resume.pdf");
  assert.equal(result.title, "Master CV");
  assert.throws(() => validateCareerDocumentMetadata({
    title: "x",
    kind: "master_resume",
    originalFilename: "x.pdf",
    contentType: "application/pdf",
    buffer: PDF,
  }), /title/i);
  assert.throws(() => validateCareerDocumentMetadata({
    title: "Master CV",
    kind: "other",
    originalFilename: "x.pdf",
    contentType: "application/pdf",
    buffer: PDF,
  }), /category/i);
  assert.throws(() => encryptCareerDocument(PDF, "", { documentId: ID, contentType: "application/pdf" }), /DOC_ENCRYPTION_KEY/i);
  assert.throws(() => encryptCareerDocument(Buffer.alloc(0), KEY, { documentId: ID, contentType: "application/pdf" }), /between 1 byte/i);
  assert.equal(MAX_CAREER_DOCUMENT_BYTES, 10 * 1024 * 1024);
});

function makeStorage() {
  const files = new Map();
  return {
    files,
    storage: {
      async getBucket() { return { data: { public: false }, error: null }; },
      async createBucket() { throw new Error("The test bucket should already exist."); },
      from(bucket) {
        assert.equal(bucket, "career-private-documents");
        return {
          async upload(path, bytes, options) {
            assert.equal(options.contentType, "application/octet-stream");
            files.set(path, Buffer.from(bytes));
            return { error: null };
          },
          async remove(paths) {
            for (const path of paths) files.delete(path);
            return { error: null };
          },
          async download(path) {
            const bytes = files.get(path);
            if (!bytes) return { data: null, error: { message: "not found" } };
            return { data: { arrayBuffer: async () => Uint8Array.from(bytes).buffer }, error: null };
          },
        };
      },
    },
  };
}

function makeDb() {
  const docs = new Map();
  const consents = [];
  return {
    docs, consents,
    async query(statement, values = []) {
      if (statement.includes("LEFT JOIN LATERAL")) {
        return { rows: [...docs.values()].filter((row) => !row.archived_at).map((row) => ({
          id: row.id,
          title: row.title,
          kind: row.kind,
          original_filename: row.original_filename,
          content_type: row.content_type,
          byte_size: row.byte_size,
          plaintext_sha256: row.plaintext_sha256,
          created_at: row.created_at,
          application_email_consent: [...consents].reverse().find((entry) =>
            entry.document_id === row.id && entry.purpose === "application_email")?.action === "granted",
          public_profile_consent: false,
        })) };
      }
      if (statement.startsWith("INSERT INTO public.jr_career_documents")) {
        const [id, title, kind, originalFilename, contentType, byteSize, storagePath, iv, tag, digest, createdAt] = values;
        const row = {
          id, title, kind, original_filename: originalFilename, content_type: contentType,
          byte_size: byteSize, storage_path: storagePath, encryption_iv: iv,
          encryption_tag: tag, plaintext_sha256: digest, created_at: createdAt, archived_at: null,
        };
        docs.set(id, row);
        return { rows: [{ ...row, application_email_consent: false, public_profile_consent: false }] };
      }
      if (statement.startsWith("INSERT INTO public.jr_career_document_consents")) {
        const [documentId, purpose, action, actor, acknowledgement, createdAt] = values;
        if (!docs.has(documentId) || docs.get(documentId).archived_at) return { rows: [] };
        const row = { id: "consent-" + (consents.length + 1), document_id: documentId, purpose, action, actor, acknowledgement, created_at: createdAt };
        consents.push(row);
        return { rows: [row] };
      }
      if (statement.includes("FROM public.jr_career_documents") && statement.includes("WHERE id = $1 AND archived_at IS NULL")) {
        const row = docs.get(values[0]);
        return { rows: row && !row.archived_at ? [row] : [] };
      }
      if (statement.startsWith("UPDATE public.jr_career_documents")) {
        const row = docs.get(values[0]);
        if (!row || row.archived_at) return { rows: [] };
        row.archived_at = values[1];
        return { rows: [{ id: row.id, title: row.title, archived_at: row.archived_at }] };
      }
      throw new Error("Unexpected database query: " + statement.slice(0, 120));
    },
  };
}

test("private document service encrypts before storage, decrypts on download and appends revocable release consent", async () => {
  const db = makeDb();
  const storage = makeStorage();
  const now = () => new Date("2026-11-05T15:00:00.000Z");
  const service = createCareerDocumentService({
    db, storage,
    env: { DOC_ENCRYPTION_KEY: KEY, CAREER_DOCUMENT_BUCKET: "career-private-documents" },
    now,
    idFactory: () => ID,
  });
  const uploaded = await service.upload({
    title: "Verified master CV",
    kind: "master_resume",
    originalFilename: "Morgan-CV.pdf",
    contentType: "application/pdf",
    buffer: PDF,
  });
  assert.equal(uploaded.id, ID);
  assert.equal(uploaded.application_email_consent, false);
  const stored = db.docs.get(ID);
  assert.notDeepEqual(storage.files.get(stored.storage_path), PDF);
  assert.deepEqual((await service.download(ID)).buffer, PDF);

  const granted = await service.setConsent(ID, {
    purpose: "application_email",
    action: "granted",
    actor: "morgan@example.test",
    acknowledgement: "I explicitly authorize this document for an application email attachment.",
  });
  assert.equal(granted.action, "granted");
  assert.equal((await service.list())[0].application_email_consent, true);
  const revoked = await service.setConsent(ID, {
    purpose: "application_email",
    action: "revoked",
    actor: "morgan@example.test",
    acknowledgement: "I revoke my previously granted application email attachment permission.",
  });
  assert.equal(revoked.action, "revoked");
  assert.equal((await service.list())[0].application_email_consent, false);

  const archived = await service.archive(ID);
  assert.equal(archived.id, ID);
  assert.equal(await service.download(ID), null);
  assert.equal((await service.list()).length, 0);
});

test("document service refuses to use a public object-storage bucket", async () => {
  const service = createCareerDocumentService({
    db: makeDb(),
    storage: { storage: { async getBucket() { return { data: { public: true }, error: null }; } } },
    env: { DOC_ENCRYPTION_KEY: KEY, CAREER_DOCUMENT_BUCKET: "career-private-documents" },
  });
  await assert.rejects(service.upload({
    title: "Master CV", kind: "master_resume", originalFilename: "cv.pdf",
    contentType: "application/pdf", buffer: PDF,
  }), /bucket must be private/i);
});
