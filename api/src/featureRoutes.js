import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { fileTypeFromBuffer } from "file-type";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import leoProfanity from "leo-profanity";
import { z } from "zod";
import { pool } from "./db.js";

const contactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(3000),
  consent: z.literal(true),
});

const triageStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many new rounds. Please try again later." },
});

const triageSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many score submissions. Please try again later." },
});

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many messages were submitted. Please try again later." },
});

const documentWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many document changes. Please try again later." },
});

const triageSubmissionSchema = z.object({
  roundToken: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/),
  nickname: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/)
    .refine((value) => !value.includes("@"), "Use a nickname, not an email address."),
  answers: z.array(z.object({
    alertId: z.string().regex(/^[a-z0-9-]{1,80}$/),
    verdict: z.enum(["true_positive", "false_positive"]),
  }).strict()).length(10).refine(
    (answers) => new Set(answers.map((answer) => answer.alertId)).size === answers.length,
    "Each alert must be answered once.",
  ),
}).strict();

const documentCategory = z.enum(["Resume", "Certificates", "Lab Reports"]);
const verifyUrlSchema = z.union([z.literal(""), z.null(), z.string().url().max(500)])
  .refine((value) => value === null || value === "" || new URL(value).protocol === "https:", {
    message: "Verification links must use HTTPS.",
  })
  .transform((value) => value || null);
const documentSchema = z.object({
  title: z.string().trim().min(2).max(120)
    .refine((value) => !value.split("").some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }), "The title contains unsupported characters."),
  category: documentCategory,
  description: z.string().trim().max(800),
  issuedDate: z.union([
    z.literal(""),
    z.null(),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
    }, "Enter a valid issue date."),
  ]).transform((value) => value || null),
  verifyUrl: verifyUrlSchema,
  isPublished: z.boolean(),
}).strict();

const uuidSchema = z.string().uuid();
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const allowedFileTypes = new Map([
  ["application/pdf", "pdf"],
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_SIZE, files: 1, fields: 0 },
});

let storageClient;

function getStorageClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  if (!storageClient) {
    storageClient = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return storageClient;
}

function getBucketName() {
  return process.env.SUPABASE_DOCUMENT_BUCKET || "portfolio-documents";
}

async function ensurePrivateBucket(client) {
  const bucketName = getBucketName();
  const result = await client.storage.getBucket(bucketName);
  if (result.error) {
    if (String(result.error.statusCode) !== "404") throw result.error;
    const created = await client.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: MAX_DOCUMENT_SIZE,
      allowedMimeTypes: [...allowedFileTypes.keys()],
    });
    if (created.error) throw created.error;
    return;
  }
  if (result.data.public) {
    throw new Error("The document bucket must be private.");
  }
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function validId(value) {
  return uuidSchema.safeParse(value).success;
}

function invalidInput(res, error) {
  return res.status(400).json({ error: "Please check the submitted fields.", details: error.flatten() });
}

function uploadSingleFile(req, res, next) {
  upload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return res.status(status).json({
        error: status === 413 ? "Files must be 10 MB or smaller." : "The uploaded file was not accepted.",
      });
    }
    if (error) return next(error);
    next();
  });
}

export function registerFeatureRoutes(app, { requireSameOrigin, requireCsrfToken, requireAdmin }) {
  app.post("/api/contact", contactLimiter, requireSameOrigin, async (req, res, next) => {
    const parsed = contactSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    try {
      await pool.query("DELETE FROM contact_messages WHERE expires_at <= now()");
      await pool.query(
        `INSERT INTO contact_messages (name, email, subject, message, consent_given_at, expires_at)
         VALUES ($1, $2, $3, $4, now(), now() + interval '90 days')`,
        [parsed.data.name, parsed.data.email, parsed.data.subject, parsed.data.message],
      );
      res.status(201).json({ message: "Your message has been received." });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/contact-messages", requireAdmin, async (_req, res, next) => {
    try {
      await pool.query("DELETE FROM contact_messages WHERE expires_at <= now()");
      const { rows } = await pool.query(
        `SELECT id, name, email, subject, message, created_at AS "createdAt"
         FROM contact_messages WHERE expires_at > now()
         ORDER BY created_at DESC LIMIT 100`,
      );
      res.set("Cache-Control", "no-store");
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/admin/contact-messages/:id", requireSameOrigin, requireCsrfToken, requireAdmin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: "Message ID is invalid." });
    try {
      const result = await pool.query("DELETE FROM contact_messages WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Message was not found." });
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/triage/round", triageStartLimiter, requireSameOrigin, async (_req, res, next) => {
    try {
      await pool.query(
        `DELETE FROM triage_rounds
         WHERE expires_at <= now()
            OR (submitted_at IS NOT NULL AND submitted_at < now() - interval '1 day')`,
      );
      const { rows } = await pool.query(
        `SELECT id, title, source, severity, difficulty, details
         FROM (
           (SELECT id, title, source, severity, difficulty, details
            FROM soc_alerts WHERE verdict = 'true_positive' ORDER BY random() LIMIT 5)
           UNION ALL
           (SELECT id, title, source, severity, difficulty, details
            FROM soc_alerts WHERE verdict = 'false_positive' ORDER BY random() LIMIT 5)
         ) AS balanced_alerts
         ORDER BY random()`,
      );
      if (rows.length !== 10) {
        return res.status(503).json({ error: "The alert triage game is not ready yet." });
      }
      const roundToken = randomBytes(32).toString("base64url");
      const { rows: savedRounds } = await pool.query(
        `INSERT INTO triage_rounds (token_hash, alert_ids)
         VALUES ($1, $2) RETURNING expires_at AS "expiresAt"`,
        [hashToken(roundToken), rows.map((row) => row.id)],
      );
      res.set("Cache-Control", "no-store");
      res.status(201).json({
        roundToken,
        expiresAt: savedRounds[0].expiresAt,
        alerts: rows.map(({ id, title, source, severity, difficulty, details }) => ({
          id, title, source, severity, difficulty, details,
        })),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/triage/submit", triageSubmitLimiter, requireSameOrigin, async (req, res, next) => {
    const parsed = triageSubmissionSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    const nickname = parsed.data.nickname.trim();
    if (leoProfanity.check(nickname)) {
      return res.status(400).json({ error: "Choose a different nickname." });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: rounds } = await client.query(
        `SELECT alert_ids AS "alertIds", created_at AS "createdAt", expires_at AS "expiresAt", submitted_at AS "submittedAt"
         FROM triage_rounds WHERE token_hash = $1 FOR UPDATE`,
        [hashToken(parsed.data.roundToken)],
      );
      const round = rounds[0];
      if (!round || new Date(round.expiresAt).getTime() <= Date.now()) {
        await client.query("ROLLBACK");
        return res.status(410).json({ error: "This round has expired. Start a new round." });
      }
      if (round.submittedAt) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "This round has already been submitted." });
      }
      const submittedIds = parsed.data.answers.map((answer) => answer.alertId);
      if (round.alertIds.length !== 10 || submittedIds.some((id) => !round.alertIds.includes(id))) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "Answers must match the alerts in this round." });
      }
      const { rows: alerts } = await client.query(
        `SELECT id, title, verdict, explanation, mitre
         FROM soc_alerts WHERE id = ANY($1::text[])`,
        [round.alertIds],
      );
      if (alerts.length !== 10) throw new Error("A triage round references missing alerts.");
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(round.createdAt).getTime()) / 1000));
      const speedBonus = Math.max(0, 50 - Math.floor(elapsedSeconds / 12));
      const answerMap = new Map(parsed.data.answers.map((answer) => [answer.alertId, answer.verdict]));
      const reviews = alerts.map((alert) => {
        const selectedVerdict = answerMap.get(alert.id);
        const correct = selectedVerdict === alert.verdict;
        return {
          id: alert.id,
          title: alert.title,
          selectedVerdict,
          correctVerdict: alert.verdict,
          correct,
          explanation: alert.explanation,
          mitre: alert.mitre,
          points: correct ? 100 + speedBonus : 0,
        };
      });
      const score = reviews.reduce((total, review) => total + review.points, 0);
      await client.query(
        "UPDATE triage_rounds SET submitted_at = now() WHERE token_hash = $1",
        [hashToken(parsed.data.roundToken)],
      );
      const { rows: scoreRows } = await client.query(
        `INSERT INTO triage_scores (nickname, score)
         VALUES ($1, $2)
         RETURNING id, nickname, score, created_at AS "createdAt"`,
        [nickname, score],
      );
      await client.query("COMMIT");
      res.set("Cache-Control", "no-store");
      res.status(201).json({
        score,
        correctCount: reviews.filter((review) => review.correct).length,
        speedBonusPerCorrectAnswer: speedBonus,
        maximumScore: 1500,
        leaderboardEntry: scoreRows[0],
        reviews,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      next(error);
    } finally {
      client.release();
    }
  });

  app.get("/api/leaderboard", async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, nickname, score, created_at AS "createdAt"
         FROM triage_scores ORDER BY score DESC, created_at ASC LIMIT 20`,
      );
      res.set("Cache-Control", "public, max-age=30");
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/triage/scores", requireAdmin, async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, nickname, score, created_at AS "createdAt"
         FROM triage_scores ORDER BY score DESC, created_at ASC`,
      );
      res.set("Cache-Control", "no-store");
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/admin/triage/scores/:id", requireSameOrigin, requireCsrfToken, requireAdmin, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: "Score ID is invalid." });
    try {
      const result = await pool.query("DELETE FROM triage_scores WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Score was not found." });
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/documents", async (req, res, next) => {
    const querySchema = z.object({
      q: z.string().trim().max(100).optional().default(""),
      category: z.union([z.literal(""), documentCategory]).optional().default(""),
    });
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return invalidInput(res, parsed.error);
    try {
      const { rows } = await pool.query(
        `SELECT id, title, category, description, issued_date AS "issuedDate",
                verify_url AS "verifyUrl", file_path IS NOT NULL AS "fileAvailable"
         FROM documents
         WHERE is_published = true
           AND ($1 = '' OR category = $1)
           AND ($2 = '' OR position(lower($2) in lower(title)) > 0)
         ORDER BY category, issued_date DESC NULLS LAST, created_at DESC`,
        [parsed.data.category, parsed.data.q],
      );
      res.set("Cache-Control", "public, max-age=30");
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/documents/:id/file", async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(404).json({ error: "Document was not found." });
    const parsedQuery = z.object({ download: z.enum(["0", "1"]).optional() }).strict().safeParse(req.query);
    if (!parsedQuery.success) return invalidInput(res, parsedQuery.error);
    const storage = getStorageClient();
    if (!storage) return res.status(503).json({ error: "Document storage is not configured." });
    try {
      await ensurePrivateBucket(storage);
      const { rows } = await pool.query(
        "SELECT file_path FROM documents WHERE id = $1 AND is_published = true",
        [req.params.id],
      );
      if (!rows[0]?.file_path) return res.status(404).json({ error: "Document was not found." });
      const download = parsedQuery.data.download === "1";
      const { data, error } = await storage.storage.from(getBucketName()).createSignedUrl(
        rows[0].file_path,
        60,
        download ? { download: `${req.params.id}.${rows[0].file_path.split(".").pop()}` } : undefined,
      );
      if (error) throw error;
      res.set("Cache-Control", "private, no-store");
      res.redirect(302, data.signedUrl);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/documents", requireAdmin, async (_req, res, next) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, title, category, description, issued_date AS "issuedDate",
                verify_url AS "verifyUrl", file_path IS NOT NULL AS "fileAvailable",
                is_published AS "isPublished"
         FROM documents ORDER BY category, created_at DESC`,
      );
      res.set("Cache-Control", "no-store");
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/documents", requireSameOrigin, requireCsrfToken, requireAdmin, documentWriteLimiter, async (req, res, next) => {
    const parsed = documentSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    if (parsed.data.isPublished) return res.status(400).json({ error: "Upload a file before publishing a document." });
    const document = parsed.data;
    try {
      const { rows } = await pool.query(
        `INSERT INTO documents (title, category, description, issued_date, verify_url, is_published)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING id, title, category, description, issued_date AS "issuedDate",
                   verify_url AS "verifyUrl", false AS "fileAvailable", is_published AS "isPublished"`,
        [document.title, document.category, document.description, document.issuedDate, document.verifyUrl],
      );
      res.status(201).json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/documents/:id", requireSameOrigin, requireCsrfToken, requireAdmin, documentWriteLimiter, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: "Document ID is invalid." });
    const parsed = documentSchema.safeParse(req.body);
    if (!parsed.success) return invalidInput(res, parsed.error);
    try {
      const { rows: existing } = await pool.query("SELECT file_path FROM documents WHERE id = $1", [req.params.id]);
      if (!existing[0]) return res.status(404).json({ error: "Document was not found." });
      if (parsed.data.isPublished && !existing[0].file_path) {
        return res.status(400).json({ error: "Upload a file before publishing a document." });
      }
      const document = parsed.data;
      const { rows } = await pool.query(
        `UPDATE documents
         SET title = $1, category = $2, description = $3, issued_date = $4,
             verify_url = $5, is_published = $6, updated_at = now()
         WHERE id = $7
         RETURNING id, title, category, description, issued_date AS "issuedDate",
                   verify_url AS "verifyUrl", file_path IS NOT NULL AS "fileAvailable",
                   is_published AS "isPublished"`,
        [document.title, document.category, document.description, document.issuedDate,
          document.verifyUrl, document.isPublished, req.params.id],
      );
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/admin/documents/:id/upload", documentWriteLimiter, requireSameOrigin, requireCsrfToken, requireAdmin, uploadSingleFile, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: "Document ID is invalid." });
    if (!req.file) return res.status(400).json({ error: "Choose a PDF, PNG, or JPG file to upload." });
    const detectedType = await fileTypeFromBuffer(req.file.buffer);
    const extension = detectedType && allowedFileTypes.get(detectedType.mime);
    if (!detectedType || !extension) {
      return res.status(415).json({ error: "Only genuine PDF, PNG, and JPG files are accepted." });
    }
    const storage = getStorageClient();
    if (!storage) return res.status(503).json({ error: "Document storage is not configured." });
    const filePath = `${randomUUID()}.${extension}`;
    try {
      await ensurePrivateBucket(storage);
      const { rows: existing } = await pool.query("SELECT file_path FROM documents WHERE id = $1", [req.params.id]);
      if (!existing[0]) return res.status(404).json({ error: "Document was not found." });
      const { error: uploadError } = await storage.storage.from(getBucketName()).upload(
        filePath,
        req.file.buffer,
        { contentType: detectedType.mime, cacheControl: "3600", upsert: false },
      );
      if (uploadError) throw uploadError;
      let document;
      try {
        const { rows } = await pool.query(
          `UPDATE documents
           SET file_path = $1, updated_at = now()
           WHERE id = $2
           RETURNING id, title, category, description, issued_date AS "issuedDate",
                     verify_url AS "verifyUrl", true AS "fileAvailable",
                     is_published AS "isPublished"`,
          [filePath, req.params.id],
        );
        document = rows[0];
      } catch (error) {
        const { error: cleanupError } = await storage.storage.from(getBucketName()).remove([filePath]);
        if (cleanupError) console.error("New document upload cleanup failed:", cleanupError.message);
        throw error;
      }
      let warning;
      if (existing[0].file_path) {
        const { error: removeError } = await storage.storage.from(getBucketName()).remove([existing[0].file_path]);
        if (removeError) {
          console.error("Previous document file cleanup failed:", removeError.message);
          warning = "The new file is saved, but the previous storage object could not be removed.";
        }
      }
      res.json({ document, ...(warning ? { warning } : {}) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/admin/documents/:id", requireSameOrigin, requireCsrfToken, requireAdmin, documentWriteLimiter, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: "Document ID is invalid." });
    try {
      const { rows } = await pool.query("SELECT file_path FROM documents WHERE id = $1", [req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: "Document was not found." });
      if (rows[0].file_path) {
        const storage = getStorageClient();
        if (!storage) return res.status(503).json({ error: "Document storage is not configured." });
        await ensurePrivateBucket(storage);
        const { error } = await storage.storage.from(getBucketName()).remove([rows[0].file_path]);
        if (error) throw error;
      }
      const result = await pool.query("DELETE FROM documents WHERE id = $1", [req.params.id]);
      if (result.rowCount === 0) return res.status(404).json({ error: "Document was not found." });
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });
}
