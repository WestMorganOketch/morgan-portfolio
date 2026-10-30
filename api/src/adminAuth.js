import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { claimAdminSchema, changeAdminCredentialsSchema, loginSchema } from "./validation.js";

const scrypt = promisify(scryptCallback);
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const sessionIdleMs = 2 * 60 * 60 * 1000;
const failureWindowMs = 15 * 60 * 1000;
const failedAttempts = new Map();
const passwordParams = { N: 16384, r: 8, p: 1 };

export async function hashAdminPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { ...passwordParams, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${passwordParams.N}$${passwordParams.r}$${passwordParams.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyAdminPassword(password, encodedHash) {
  const match = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/.exec(encodedHash);
  if (!match) return false;
  const [, n, r, p, saltValue, hashValue] = match;
  const salt = Buffer.from(saltValue, "base64");
  const expected = Buffer.from(hashValue, "base64");
  if (Number(n) !== passwordParams.N || Number(r) !== passwordParams.r || Number(p) !== passwordParams.p
    || salt.length !== 16 || expected.length !== 64) return false;
  const actual = await scrypt(password, salt, expected.length, { ...passwordParams, maxmem: 64 * 1024 * 1024 });
  return timingSafeEqual(actual, expected);
}

export async function initializeAdminAuthSchema(db) {
  try {
    await db.query(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS public.admin_account (
        id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        email text NOT NULL,
        password_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS public.admin_sessions (
        sid varchar NOT NULL PRIMARY KEY,
        sess json NOT NULL DEFAULT '{}'::json,
        expire timestamp(6) NOT NULL DEFAULT now(),
        token_hash text,
        created_at timestamptz NOT NULL DEFAULT now(),
        expires_at timestamptz NOT NULL DEFAULT now(),
        last_seen_at timestamptz NOT NULL DEFAULT now()
      );
      ALTER TABLE public.admin_sessions ADD COLUMN IF NOT EXISTS token_hash text;
      ALTER TABLE public.admin_sessions ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE public.admin_sessions ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT now();
      ALTER TABLE public.admin_sessions ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
      CREATE UNIQUE INDEX IF NOT EXISTS admin_sessions_token_hash_idx
        ON public.admin_sessions (token_hash) WHERE token_hash IS NOT NULL;
      ALTER TABLE public.admin_account ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
      REVOKE ALL PRIVILEGES ON TABLE public.admin_account, public.admin_sessions
        FROM PUBLIC, anon, authenticated;
      COMMIT;
    `);
    console.info("Admin account and session schema is ready.");
  } catch (error) {
    console.error("Admin account/session schema initialization failed.", error?.code ?? "database error");
    throw error;
  }
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function cookieToken(req) {
  const cookie = req.get("cookie") ?? "";
  const entry = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("morgan_admin="));
  const value = entry?.slice("morgan_admin=".length);
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function isSecureRequest(req) {
  return process.env.NODE_ENV === "production"
    || req.secure
    || req.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
}

function setSessionCookie(req, res, token) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  res.set("Set-Cookie", `morgan_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetimeMs / 1000}${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = isSecureRequest(req) ? "; Secure" : "";
  res.set("Set-Cookie", `morgan_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`);
}

function logFailure(reason) {
  console.warn(`Admin authentication failed: ${reason}.`);
}

function attemptKey(req, email) {
  return createHash("sha256").update(`${req.ip ?? req.socket.remoteAddress ?? "unknown"}:${email}`).digest("hex");
}

function clearExpiredAttempts(now) {
  for (const [key, state] of failedAttempts) {
    if (now >= state.expiresAt) failedAttempts.delete(key);
  }
}

function checkAttemptLimit(req, email, res) {
  const now = Date.now();
  clearExpiredAttempts(now);
  const key = attemptKey(req, email);
  const state = failedAttempts.get(key);
  if (state && state.count >= 5) {
    logFailure("rate_limited");
    res.set("Retry-After", String(Math.max(1, Math.ceil((state.expiresAt - now) / 1000))));
    res.status(429).json({ error: "Too many sign-in attempts. Try again in 15 minutes." });
    return null;
  }
  failedAttempts.set(key, {
    count: state ? state.count + 1 : 1,
    expiresAt: state?.expiresAt ?? now + failureWindowMs,
  });
  return key;
}

function rateLimiter(limit, message) {
  return rateLimit({
    windowMs: failureWindowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: message },
  });
}

export function registerAdminAuth(app, db, requireSameOrigin) {
  const router = express.Router();

  async function authenticate(req, _res, next) {
    const token = cookieToken(req);
    if (!token) return next();
    try {
      const { rows } = await db.query(
        `UPDATE public.admin_sessions AS sessions
         SET last_seen_at = now()
         FROM public.admin_account AS account
         WHERE sessions.token_hash = $1
           AND sessions.created_at > now() - interval '8 hours'
           AND sessions.expires_at > now()
           AND sessions.last_seen_at > now() - ($2::double precision * interval '1 millisecond')
         RETURNING account.email, sessions.sess`,
        [hashToken(token), sessionIdleMs],
      );
      if (rows[0]) {
        req.adminSession = {
          tokenHash: hashToken(token),
          email: rows[0].email,
          csrfToken: rows[0].sess?.csrfToken,
        };
      }
      next();
    } catch (error) {
      logFailure("db_error");
      next(error);
    }
  }

  function requireAdmin(req, res, next) {
    if (!req.adminSession) return res.status(401).json({ error: "Sign in to use the admin area." });
    next();
  }

  function requireCsrfToken(req, res, next) {
    if (!req.adminSession?.csrfToken || req.get("x-csrf-token") !== req.adminSession.csrfToken) {
      return res.status(403).json({ error: "Request verification failed. Refresh the page and try again." });
    }
    next();
  }

  async function createSession(req, res, email) {
    const token = randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const csrfToken = randomBytes(32).toString("hex");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionLifetimeMs);
    await db.query(
      `INSERT INTO public.admin_sessions
        (sid, sess, expire, token_hash, created_at, expires_at, last_seen_at)
       VALUES ($1, $2::json, $3, $1, $4, $3, $4)`,
      [tokenHash, JSON.stringify({ csrfToken }), expiresAt, now],
    );
    setSessionCookie(req, res, token);
    res.set("Cache-Control", "no-store");
    return { email };
  }

  router.use(authenticate);
  router.get("/status", async (_req, res) => {
    try {
      const { rows } = await db.query("SELECT EXISTS (SELECT 1 FROM public.admin_account WHERE id = 1) AS claimed");
      res.set("Cache-Control", "no-store");
      res.json({ claimed: rows[0].claimed });
    } catch {
      logFailure("db_error");
      res.status(503).json({ error: "Admin setup status is temporarily unavailable." });
    }
  });

  router.post("/claim", rateLimiter(5, "Too many setup attempts. Try again later."), requireSameOrigin, async (req, res) => {
    const parsed = claimAdminSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and matching passwords of at least 10 characters." });
    try {
      const passwordHash = await hashAdminPassword(parsed.data.password);
      const { rows } = await db.query(
        `INSERT INTO public.admin_account (id, email, password_hash)
         VALUES (1, $1, $2)
         ON CONFLICT (id) DO NOTHING
         RETURNING email`,
        [parsed.data.email, passwordHash],
      );
      if (!rows[0]) {
        res.status(409).json({ error: "Admin already set up" });
        return;
      }
      const session = await createSession(req, res, rows[0].email);
      res.status(201).json(session);
    } catch {
      logFailure("db_error");
      res.status(503).json({ error: "Admin setup is temporarily unavailable." });
    }
  });

  router.post("/login", requireSameOrigin, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
    try {
      const { rows } = await db.query("SELECT email, password_hash FROM public.admin_account WHERE id = 1");
      const account = rows[0];
      if (!account) {
        logFailure("not_claimed");
        res.status(409).json({ error: "Not set up yet", claimed: false });
        return;
      }
      const key = checkAttemptLimit(req, parsed.data.email, res);
      if (!key) return;
      const passwordMatches = await verifyAdminPassword(parsed.data.password, account.password_hash);
      const emailMatches = parsed.data.email === account.email;
      if (!emailMatches || !passwordMatches) {
        logFailure(emailMatches ? "password_mismatch" : "email_mismatch");
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }
      failedAttempts.delete(key);
      res.json(await createSession(req, res, account.email));
    } catch {
      logFailure("db_error");
      res.status(503).json({ error: "Sign-in is temporarily unavailable." });
    }
  });

  router.get("/csrf", requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ token: req.adminSession.csrfToken });
  });

  router.get("/me", requireAdmin, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ email: req.adminSession.email });
  });

  router.post("/logout", requireSameOrigin, requireAdmin, requireCsrfToken, async (req, res) => {
    try {
      await db.query("DELETE FROM public.admin_sessions WHERE token_hash = $1", [req.adminSession.tokenHash]);
      clearSessionCookie(req, res);
      res.sendStatus(204);
    } catch {
      logFailure("db_error");
      res.status(503).json({ error: "Sign-out is temporarily unavailable." });
    }
  });

  router.post(
    "/change-credentials",
    rateLimiter(5, "Too many account changes. Try again later."),
    requireSameOrigin,
    requireAdmin,
    requireCsrfToken,
    async (req, res) => {
      const parsed = changeAdminCredentialsSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Enter your current password and a valid new email or password." });
      try {
        const { rows } = await db.query("SELECT password_hash FROM public.admin_account WHERE id = 1");
        const account = rows[0];
        if (!account || !await verifyAdminPassword(parsed.data.currentPassword, account.password_hash)) {
          res.status(401).json({ error: "Current password is incorrect." });
          return;
        }
        const newHash = parsed.data.newPassword
          ? await hashAdminPassword(parsed.data.newPassword)
          : account.password_hash;
        const { rows: updated } = await db.query(
          `WITH changed AS (
             UPDATE public.admin_account
             SET email = COALESCE($1, email), password_hash = $2, updated_at = now()
             WHERE id = 1
             RETURNING email
           ), invalidated AS (
             DELETE FROM public.admin_sessions WHERE token_hash IS DISTINCT FROM $3
             RETURNING token_hash
           )
           SELECT email FROM changed`,
          [parsed.data.newEmail ?? null, newHash, req.adminSession.tokenHash],
        );
        res.set("Cache-Control", "no-store");
        res.json({ email: updated[0].email });
      } catch {
        logFailure("db_error");
        res.status(503).json({ error: "Account settings are temporarily unavailable." });
      }
    },
  );

  app.use("/api/admin", router);
  return { requireAdmin, requireCsrfToken };
}
