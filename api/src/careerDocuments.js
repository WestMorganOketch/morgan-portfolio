import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { encryptionKeyFromEnvironment } from "./careerGmail.js";

export const MAX_CAREER_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const CAREER_DOCUMENT_TYPES = Object.freeze({
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
});
export const CAREER_DOCUMENT_KINDS = Object.freeze([
  "master_resume", "certificate", "supporting_document", "employment_record",
]);
export const CAREER_DOCUMENT_CONSENT_PURPOSES = Object.freeze([
  "application_email", "public_profile",
]);

const AAD_PREFIX = "morgan-career-document:v1:";

function asBuffer(value, label = "document") {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new TypeError("The " + label + " content must be a byte buffer.");
}

function safeFilename(value) {
  const valueText = String(value ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const clean = valueText.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 255);
  return clean || "career-document";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameDigest(left, right) {
  if (typeof left !== "string" || !/^[a-f0-9]{64}$/.test(left)
      || typeof right !== "string" || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function documentAad(documentId, contentType) {
  return Buffer.from(AAD_PREFIX + documentId + ":" + contentType, "utf8");
}

export function encryptCareerDocument(bufferValue, keyValue, { documentId, contentType } = {}) {
  const buffer = asBuffer(bufferValue);
  if (buffer.length < 1 || buffer.length > MAX_CAREER_DOCUMENT_BYTES) {
    throw new RangeError("Career documents must be between 1 byte and 10 MB.");
  }
  if (typeof documentId !== "string" || !/^[0-9a-f-]{36}$/i.test(documentId)) {
    throw new TypeError("A valid document ID is required for authenticated encryption.");
  }
  if (!Object.hasOwn(CAREER_DOCUMENT_TYPES, contentType)) {
    throw new TypeError("The detected document type is not supported.");
  }
  const key = encryptionKeyFromEnvironment(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(documentAad(documentId, contentType));
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return {
    ciphertext,
    encryption_iv: iv,
    encryption_tag: cipher.getAuthTag(),
    plaintext_sha256: sha256(buffer),
    byte_size: buffer.length,
  };
}

export function decryptCareerDocument(ciphertextValue, keyValue, {
  documentId, contentType, encryptionIv, encryptionTag, plaintextSha256,
} = {}) {
  const ciphertext = asBuffer(ciphertextValue, "encrypted document");
  if (typeof documentId !== "string" || !/^[0-9a-f-]{36}$/i.test(documentId)
      || !Object.hasOwn(CAREER_DOCUMENT_TYPES, contentType)) {
    throw new TypeError("The saved document metadata is invalid.");
  }
  const iv = asBuffer(encryptionIv, "encryption IV");
  const tag = asBuffer(encryptionTag, "authentication tag");
  if (iv.length !== 12 || tag.length !== 16) throw new Error("The saved document encryption metadata is invalid.");
  const key = encryptionKeyFromEnvironment(keyValue);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(documentAad(documentId, contentType));
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (!sameDigest(sha256(plaintext), plaintextSha256)) {
      throw new Error("The document integrity check failed.");
    }
    if (plaintext.length < 1 || plaintext.length > MAX_CAREER_DOCUMENT_BYTES) {
      throw new Error("The decrypted document size is invalid.");
    }
    return plaintext;
  } catch {
    throw new Error("The saved document could not be authenticated or decrypted. Verify the encryption key and stored file.");
  }
}

export function validateCareerDocumentMetadata({ title, kind, originalFilename, contentType, buffer } = {}) {
  const cleanTitle = String(title ?? "").trim();
  const cleanKind = String(kind ?? "").trim();
  const cleanFilename = safeFilename(originalFilename);
  const file = asBuffer(buffer);
  if (cleanTitle.length < 2 || cleanTitle.length > 120 || /[\u0000-\u001f\u007f]/.test(cleanTitle)) {
    throw new TypeError("Document title must contain 2–120 supported characters.");
  }
  if (!CAREER_DOCUMENT_KINDS.includes(cleanKind)) throw new TypeError("Choose a supported document category.");
  if (!Object.hasOwn(CAREER_DOCUMENT_TYPES, contentType)) throw new TypeError("Only verified PDF, PNG, and JPG files are accepted.");
  if (file.length < 1 || file.length > MAX_CAREER_DOCUMENT_BYTES) throw new RangeError("Career documents must be between 1 byte and 10 MB.");
  return { title: cleanTitle, kind: cleanKind, originalFilename: cleanFilename, contentType, buffer: file };
}

let defaultStorageClient;

export function careerDocumentStorageFromEnvironment(env = process.env) {
  const url = String(env.SUPABASE_URL ?? "").trim();
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !serviceKey) return null;
  if (!defaultStorageClient) {
    defaultStorageClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return defaultStorageClient;
}

export function createCareerDocumentService({
  db, storage = careerDocumentStorageFromEnvironment(), env = process.env,
  now = () => new Date(), idFactory = randomUUID,
} = {}) {
  if (!db || typeof db.query !== "function") throw new TypeError("Career document service requires a database.");
  const bucketName = String(env.CAREER_DOCUMENT_BUCKET ?? "career-private-documents").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(bucketName)) throw new TypeError("CAREER_DOCUMENT_BUCKET is invalid.");

  async function ensurePrivateBucket() {
    if (!storage?.storage) throw new Error("Private career document storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the API.");
    const result = await storage.storage.getBucket(bucketName);
    if (result.error) {
      if (String(result.error.statusCode) !== "404") throw new Error("The private career document bucket could not be checked.");
      const created = await storage.storage.createBucket(bucketName, {
        public: false,
        fileSizeLimit: MAX_CAREER_DOCUMENT_BYTES,
        allowedMimeTypes: ["application/octet-stream"],
      });
      if (created.error) throw new Error("The private career document bucket could not be created.");
      return;
    }
    if (result.data?.public !== false) throw new Error("The career document bucket must be private. No file was transferred.");
  }

  async function list() {
    const { rows } = await db.query(
      \`SELECT d.id, d.title, d.kind, d.original_filename, d.content_type,
              d.byte_size, d.plaintext_sha256, d.created_at,
              COALESCE(app.action = 'granted', false) AS application_email_consent,
              COALESCE(pub.action = 'granted', false) AS public_profile_consent
       FROM public.jr_career_documents AS d
       LEFT JOIN LATERAL (
         SELECT action FROM public.jr_career_document_consents
         WHERE document_id = d.id AND purpose = 'application_email'
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) AS app ON true
       LEFT JOIN LATERAL (
         SELECT action FROM public.jr_career_document_consents
         WHERE document_id = d.id AND purpose = 'public_profile'
         ORDER BY created_at DESC, id DESC LIMIT 1
       ) AS pub ON true
       WHERE d.archived_at IS NULL
       ORDER BY d.created_at DESC, d.id
       LIMIT 100\`,
    );
    return rows;
  }

  async function upload(input) {
    const value = validateCareerDocumentMetadata(input);
    await ensurePrivateBucket();
    const id = idFactory();
    const encrypted = encryptCareerDocument(value.buffer, env.DOC_ENCRYPTION_KEY, {
      documentId: id, contentType: value.contentType,
    });
    const storagePath = id + ".enc";
    const uploadResult = await storage.storage.from(bucketName).upload(
      storagePath,
      encrypted.ciphertext,
      { contentType: "application/octet-stream", cacheControl: "0", upsert: false },
    );
    if (uploadResult.error) throw new Error("The encrypted document could not be stored privately.");
    try {
      const { rows } = await db.query(
        \`INSERT INTO public.jr_career_documents
          (id, title, kind, original_filename, content_type, byte_size, storage_path,
           encryption_iv, encryption_tag, plaintext_sha256, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, title, kind, original_filename, content_type, byte_size,
                   plaintext_sha256, created_at, false AS application_email_consent,
                   false AS public_profile_consent\`,
        [id, value.title, value.kind, value.originalFilename, value.contentType,
          encrypted.byte_size, storagePath, encrypted.encryption_iv,
          encrypted.encryption_tag, encrypted.plaintext_sha256, now()],
      );
      if (!rows[0]) throw new Error("The document metadata could not be saved.");
      return rows[0];
    } catch (error) {
      try { await storage.storage.from(bucketName).remove([storagePath]); } catch { /* best-effort cleanup */ }
      throw error;
    }
  }

  async function download(id) {
    await ensurePrivateBucket();
    const { rows } = await db.query(
      \`SELECT id, original_filename, content_type, byte_size, storage_path,
              encryption_iv, encryption_tag, plaintext_sha256
       FROM public.jr_career_documents
       WHERE id = $1 AND archived_at IS NULL\`,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    const result = await storage.storage.from(bucketName).download(row.storage_path);
    if (result.error || !result.data) throw new Error("The encrypted document file could not be retrieved from private storage.");
    const ciphertext = Buffer.from(await result.data.arrayBuffer());
    const buffer = decryptCareerDocument(ciphertext, env.DOC_ENCRYPTION_KEY, {
      documentId: row.id,
      contentType: row.content_type,
      encryptionIv: row.encryption_iv,
      encryptionTag: row.encryption_tag,
      plaintextSha256: row.plaintext_sha256,
    });
    if (buffer.length !== Number(row.byte_size)) throw new Error("The document size does not match its private metadata.");
    return { id: row.id, filename: row.original_filename, contentType: row.content_type, buffer };
  }

  async function setConsent(id, { purpose, action, acknowledgement, actor }) {
    if (!CAREER_DOCUMENT_CONSENT_PURPOSES.includes(purpose)) throw new TypeError("Choose a supported document release purpose.");
    if (!["granted", "revoked"].includes(action)) throw new TypeError("Choose grant or revoke for document consent.");
    const cleanActor = String(actor ?? "admin").trim().slice(0, 254) || "admin";
    const cleanAcknowledgement = String(acknowledgement ?? "").trim().slice(0, 400);
    if (action === "granted" && cleanAcknowledgement.length < 30) {
      throw new TypeError("Explicit acknowledgement is required before granting document release consent.");
    }
    const { rows } = await db.query(
      \`INSERT INTO public.jr_career_document_consents
        (document_id, purpose, action, actor, acknowledgement, created_at)
       SELECT id, $2, $3, $4, $5, $6
       FROM public.jr_career_documents
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id, document_id, purpose, action, actor, acknowledgement, created_at\`,
      [id, purpose, action, cleanActor, cleanAcknowledgement, now()],
    );
    if (!rows[0]) return null;
    return rows[0];
  }

  async function archive(id) {
    const { rows } = await db.query(
      \`UPDATE public.jr_career_documents
       SET archived_at = $2
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id, title, archived_at\`,
      [id, now()],
    );
    return rows[0] ?? null;
  }

  return { list, upload, download, setConsent, archive, bucketName };
}
