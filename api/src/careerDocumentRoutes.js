import { fileTypeFromBuffer } from "file-type";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { z } from "zod";
import {
  CAREER_DOCUMENT_KINDS,
  MAX_CAREER_DOCUMENT_BYTES,
  createCareerDocumentService,
} from "./careerDocuments.js";

const uuidSchema = z.string().uuid();
const uploadSchema = z.object({
  title: z.string().trim().min(2).max(120),
  kind: z.enum(CAREER_DOCUMENT_KINDS),
}).strict();
const consentSchema = z.object({
  purpose: z.literal("application_email"),
  action: z.enum(["granted", "revoked"]),
  confirmed: z.literal(true),
  acknowledgement: z.string().trim().min(30).max(400),
}).strict();
const archiveSchema = z.object({ confirmed: z.literal(true) }).strict();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CAREER_DOCUMENT_BYTES, files: 1, fields: 2, fieldSize: 1200 },
});

const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many private document changes. Try again later." },
});

function filenameForDownload(value) {
  return String(value ?? "career-document")
    .replace(/[\r\n"\\]/g, "_")
    .replace(/[^\x20-\x7e]/g, "_")
    .slice(0, 180) || "career-document";
}

function parseRequest(schema, input) {
  const result = schema.safeParse(input);
  return result.success ? { data: result.data } : { error: result.error.flatten() };
}

async function checkTables(db) {
  const { rows } = await db.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [["jr_career_documents", "jr_career_document_consents"]],
  );
  const found = new Set(rows.map((row) => row.table_name));
  return ["jr_career_documents", "jr_career_document_consents"].filter((name) => !found.has(name));
}

function missingTables(res, missing) {
  return res.status(409).json({
    error: "The secure career document tables are not installed. Back up the intended database, then run npm run db:migrate-career or apply docs/career-automation/sql/phase-5.sql after verifying the target environment.",
    missingTables: missing,
  });
}

function serviceError(res, error) {
  const message = String(error?.message ?? "");
  if (message.includes("SUPABASE_URL") || message.includes("SUPABASE_SERVICE_ROLE_KEY")) {
    res.status(503).json({ error: message });
    return true;
  }
  if (message.includes("DOC_ENCRYPTION_KEY")) {
    res.status(409).json({ error: message });
    return true;
  }
  if (message.includes("bucket must be private")) {
    res.status(503).json({ error: message });
    return true;
  }
  return false;
}

export function registerCareerDocumentRoutes(router, db, {
  requireSameOrigin, requireCsrfToken, service = createCareerDocumentService({ db }),
} = {}) {
  router.get("/documents", async (_req, res, next) => {
    try {
      const missing = await checkTables(db);
      if (missing.length) return missingTables(res, missing);
      res.json(await service.list());
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/documents",
    writeLimiter,
    requireSameOrigin,
    requireCsrfToken,
    (req, res, next) => upload.single("file")(req, res, (error) => {
      if (error instanceof multer.MulterError) {
        const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        return res.status(status).json({
          error: status === 413 ? "Career documents must be 10 MB or smaller." : "The upload was not accepted.",
        });
      }
      if (error) return next(error);
      next();
    }),
    async (req, res, next) => {
      const missing = await checkTables(db).catch(() => ["jr_career_documents", "jr_career_document_consents"]);
      if (missing.length) return missingTables(res, missing);
      if (!req.file) return res.status(400).json({ error: "Choose a PDF, PNG, or JPG file." });
      const parsed = parseRequest(uploadSchema, { title: req.body.title, kind: req.body.kind });
      if (parsed.error) return res.status(400).json({ error: "Check the document title and category.", details: parsed.error });
      const detected = await fileTypeFromBuffer(req.file.buffer);
      if (!detected || !["application/pdf", "image/png", "image/jpeg"].includes(detected.mime)) {
        return res.status(415).json({ error: "Only genuine PDF, PNG, and JPG files are accepted." });
      }
      try {
        const value = await service.upload({
          ...parsed.data,
          originalFilename: req.file.originalname,
          contentType: detected.mime,
          buffer: req.file.buffer,
        });
        res.status(201).json(value);
      } catch (error) {
        if (serviceError(res, error)) return;
        next(error);
      }
    },
  );

  router.get("/documents/:id/download", async (req, res, next) => {
    const id = uuidSchema.safeParse(req.params.id);
    if (!id.success) return res.status(404).json({ error: "Document was not found." });
    const missing = await checkTables(db).catch(() => ["jr_career_documents", "jr_career_document_consents"]);
    if (missing.length) return missingTables(res, missing);
    try {
      const value = await service.download(id.data);
      if (!value) return res.status(404).json({ error: "Document was not found." });
      res.set({
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Type": value.contentType,
        "Content-Length": String(value.buffer.length),
        "Content-Disposition": "attachment; filename=\"" + filenameForDownload(value.filename) + "\"",
      });
      res.send(value.buffer);
    } catch (error) {
      if (serviceError(res, error)) return;
      next(error);
    }
  });

  router.post(
    "/documents/:id/consents",
    writeLimiter,
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const id = uuidSchema.safeParse(req.params.id);
      const parsed = parseRequest(consentSchema, req.body);
      if (!id.success) return res.status(404).json({ error: "Document was not found." });
      if (parsed.error) return res.status(400).json({ error: "Explicit per-file application-email consent is required.", details: parsed.error });
      const missing = await checkTables(db).catch(() => ["jr_career_documents", "jr_career_document_consents"]);
      if (missing.length) return missingTables(res, missing);
      try {
        const result = await service.setConsent(id.data, {
          ...parsed.data,
          actor: req.adminSession?.email ?? "admin",
        });
        if (!result) return res.status(404).json({ error: "Document was not found." });
        res.status(201).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/documents/:id/archive",
    writeLimiter,
    requireSameOrigin,
    requireCsrfToken,
    async (req, res, next) => {
      const id = uuidSchema.safeParse(req.params.id);
      const parsed = parseRequest(archiveSchema, req.body);
      if (!id.success) return res.status(404).json({ error: "Document was not found." });
      if (parsed.error) return res.status(400).json({ error: "Confirm the archive action for this private document." });
      try {
        const result = await service.archive(id.data);
        if (!result) return res.status(404).json({ error: "Document was not found." });
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
}
