import connectPgSimple from "connect-pg-simple";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import { OAuth2Client } from "google-auth-library";
import helmet from "helmet";
import { pool } from "./db.js";
import { analyticsSchema, contentCategories, contentSchema, parseInput, projectSchema, uuidSchema } from "./validation.js";
import { registerFeatureRoutes } from "./featureRoutes.js";

const PgSession = connectPgSimple(session);
const app = express();
const sessionSecret = process.env.SESSION_SECRET;
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim();
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
const googleRedirectUri = process.env.GOOGLE_REDIRECT_URI?.trim();
const frontendUrl = process.env.FRONTEND_URL?.trim();
const googleAuthClient = new OAuth2Client(googleClientId, googleClientSecret, googleRedirectUri);
const webOrigins = new Set(
  (process.env.WEB_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
);
const invalidOrigin = [...webOrigins].find((origin) => {
  try {
    const parsed = new URL(origin);
    return !["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin;
  } catch {
    return true;
  }
});

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}
if (webOrigins.size === 0) {
  throw new Error("Set WEB_ORIGINS to a comma-separated allow-list of website origins.");
}
if (invalidOrigin) {
  throw new Error("WEB_ORIGINS entries must be exact HTTP or HTTPS origins without paths.");
}
if (frontendUrl) {
  let frontendOrigin;
  try {
    const parsed = new URL(frontendUrl);
    if (
      !["http:", "https:"].includes(parsed.protocol)
      || parsed.origin !== frontendUrl
      || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
    ) {
      throw new Error();
    }
    frontendOrigin = parsed.origin;
  } catch {
    throw new Error("FRONTEND_URL must be an exact HTTP or HTTPS origin without a path.");
  }
  if (!webOrigins.has(frontendOrigin)) {
    throw new Error("FRONTEND_URL must also be included in WEB_ORIGINS.");
  }
}
if (googleRedirectUri) {
  try {
    const callback = new URL(googleRedirectUri);
    if (
      !["http:", "https:"].includes(callback.protocol)
      || callback.pathname !== "/api/admin/auth/google/callback"
      || callback.search
      || callback.hash
      || (frontendUrl && callback.origin !== frontendUrl)
      || (process.env.NODE_ENV === "production" && callback.protocol !== "https:")
    ) {
      throw new Error();
    }
  } catch {
    throw new Error("GOOGLE_REDIRECT_URI must use FRONTEND_URL with the /api/admin/auth/google/callback path.");
  }
}
const requiredGoogleConfig = [
  ["GOOGLE_CLIENT_ID", googleClientId],
  ["GOOGLE_CLIENT_SECRET", googleClientSecret],
  ["GOOGLE_REDIRECT_URI", googleRedirectUri],
  ["ADMIN_EMAIL", adminEmail],
  ["SESSION_SECRET", sessionSecret],
  ["FRONTEND_URL", frontendUrl],
];
const missingGoogleConfig = requiredGoogleConfig.filter(([, value]) => !value).map(([name]) => name);
if (process.env.NODE_ENV === "production" && missingGoogleConfig.length) {
  throw new Error(`Missing required Google admin sign-in environment variables: ${missingGoogleConfig.join(", ")}.`);
}
app.locals.googleOAuthClient = googleAuthClient;

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && !webOrigins.has(origin)) {
    return res.status(403).json({ error: "Request origin was not accepted." });
  }
  if (origin) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Access-Control-Allow-Credentials", "true");
    res.vary("Origin");
  }
  if (req.method === "OPTIONS") {
    const requestedMethod = req.get("access-control-request-method");
    const allowedMethods = new Set(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
    if (requestedMethod && !allowedMethods.has(requestedMethod.toUpperCase())) {
      return res.status(403).json({ error: "Request method was not accepted." });
    }
    const allowedHeaders = new Set(["content-type", "x-csrf-token"]);
    const requestedHeaders = (req.get("access-control-request-headers") ?? "")
      .split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
    if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
      return res.status(403).json({ error: "Request headers were not accepted." });
    }
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token");
    res.set("Access-Control-Max-Age", "600");
    return res.sendStatus(204);
  }
  next();
});
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});
app.use(globalLimiter);
app.use(express.json({ limit: "32kb", strict: true }));
app.use(session({
  name: "morgan_admin",
  secret: sessionSecret,
  store: process.env.NODE_ENV === "test"
    ? new session.MemoryStore()
    : new PgSession({
        pool,
        tableName: "admin_sessions",
        createTableIfMissing: false,
        pruneSessionInterval: 60 * 15,
      }),
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 8,
    path: "/",
  },
}));

const googleAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." },
});
const analyticsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many analytics events." },
});

function requireSameOrigin(req, res, next) {
  const origin = req.get("origin");
  if (!origin || !webOrigins.has(origin)) {
    return res.status(403).json({ error: "Request origin was not accepted." });
  }
  next();
}

function requireCsrfToken(req, res, next) {
  const token = req.get("x-csrf-token");
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: "Request verification failed. Refresh the page and try again." });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (
    !adminEmail
    || req.session.adminEmail !== adminEmail
    || !Number.isFinite(req.session.adminExpiresAt)
    || Date.now() >= req.session.adminExpiresAt
  ) {
    return res.status(401).json({ error: "Sign in to use the admin area." });
  }
  next();
}

function isGoogleConfigReady() {
  return missingGoogleConfig.length === 0;
}

function oauthErrorUrl(error) {
  const url = new URL("/admin/login", frontendUrl);
  url.searchParams.set("error", error);
  return url.href;
}

function rejectOAuthFlow(res, status, error) {
  const destination = oauthErrorUrl(error);
  res.set("Cache-Control", "no-store");
  res.set("Location", destination);
  res.set("Refresh", `0; url=${destination}`);
  return res.status(status).type("text/plain").send("Google sign-in could not be completed.");
}

function safeStateMatches(expected, actual) {
  if (typeof expected !== "string" || typeof actual !== "string") return false;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => error ? reject(error) : resolve());
  });
}

function invalidInput(res, parsed) {
  return res.status(400).json({ error: "Please check the submitted fields.", details: parsed.error });
}

function health(_req, res) {
  res.json({ status: "ok" });
}

app.get("/health", health);
app.get("/api/health", health);

app.get("/api/projects", async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, period, description, tags, writeup, challenges, solutions,
              architecture, future_improvements AS "futureImprovements", url, demo_url AS "demoUrl"
       FROM portfolio_projects
       WHERE published = true
       ORDER BY sort_order, created_at DESC`,
    );
    res.set("Cache-Control", "public, max-age=60");
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get("/api/content/:category", async (req, res, next) => {
  if (!contentCategories.includes(req.params.category)) {
    return res.status(404).json({ error: "Portfolio section was not found." });
  }
  try {
    const { rows } = await pool.query(
      `SELECT id, category, title, period, description, body, tags, url
       FROM portfolio_content
       WHERE category = $1 AND published = true
       ORDER BY sort_order, created_at DESC`,
      [req.params.category],
    );
    res.set("Cache-Control", "public, max-age=60");
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/analytics", analyticsLimiter, requireSameOrigin, async (req, res, next) => {
  const parsed = parseInput(analyticsSchema, req.body);
  if (parsed.error) return invalidInput(res, parsed);
  try {
    await pool.query(
      "INSERT INTO portfolio_analytics (event, page) VALUES ($1, $2)",
      [parsed.data.event, parsed.data.page],
    );
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/csrf", (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomUUID();
  }
  res.set("Cache-Control", "no-store");
  res.json({ token: req.session.csrfToken });
});

app.get("/api/admin/auth/google/start", googleAuthLimiter, (req, res) => {
  if (!isGoogleConfigReady()) {
    return res.status(503).json({ error: "Google admin sign-in is not configured." });
  }
  try {
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    req.session.googleAuth = { state, nonce, codeVerifier, expiresAt: Date.now() + 10 * 60 * 1000 };
    req.session.cookie.maxAge = 10 * 60 * 1000;
    const authorizationUrl = app.locals.googleOAuthClient.generateAuthUrl({
      access_type: "online",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      max_age: 0,
      nonce,
      prompt: "select_account",
      redirect_uri: googleRedirectUri,
      response_type: "code",
      scope: ["openid", "email", "profile"],
      state,
    });
    res.set("Cache-Control", "no-store");
    return res.redirect(authorizationUrl);
  } catch {
    console.warn("Google admin sign-in could not be started.");
    return res.status(500).json({ error: "Google sign-in could not be started." });
  }
});

app.get("/api/admin/auth/google/callback", googleAuthLimiter, async (req, res) => {
  if (!isGoogleConfigReady()) {
    return res.status(503).json({ error: "Google admin sign-in is not configured." });
  }
  const flow = req.session.googleAuth;
  if (
    !flow
    || !safeStateMatches(flow.state, req.query.state)
    || !Number.isFinite(flow.expiresAt)
    || Date.now() >= flow.expiresAt
  ) {
    return rejectOAuthFlow(res, 400, "invalid_state");
  }
  delete req.session.googleAuth;
  try {
    await saveSession(req);
    if (typeof req.query.error === "string" || typeof req.query.code !== "string") {
      return rejectOAuthFlow(res, 400, "sign_in_failed");
    }
    const { tokens } = await app.locals.googleOAuthClient.getToken({
      code: req.query.code,
      codeVerifier: flow.codeVerifier,
    });
    if (!tokens.id_token) return rejectOAuthFlow(res, 400, "sign_in_failed");
    const ticket = await app.locals.googleOAuthClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: googleClientId,
    });
    const payload = ticket.getPayload();
    if (
      !payload
      || payload.nonce !== flow.nonce
      || payload.email_verified !== true
      || typeof payload.email !== "string"
    ) {
      return rejectOAuthFlow(res, 400, "sign_in_failed");
    }
    if (payload.email.trim().toLowerCase() !== adminEmail) {
      console.warn("Google admin sign-in rejected: account is not allow-listed.");
      await destroySession(req);
      res.clearCookie("morgan_admin", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
      return rejectOAuthFlow(res, 403, "not_allowed");
    }
    await regenerateSession(req);
    req.session.adminEmail = adminEmail;
    req.session.adminExpiresAt = Date.now() + 8 * 60 * 60 * 1000;
    req.session.csrfToken = randomUUID();
    req.session.cookie.maxAge = 8 * 60 * 60 * 1000;
    await saveSession(req);
    res.set("Cache-Control", "no-store");
    return res.redirect(`${frontendUrl}/admin`);
  } catch {
    console.warn("Google admin sign-in could not be completed.");
    if (res.headersSent) return res.end();
    return rejectOAuthFlow(res, 400, "sign_in_failed");
  }
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ email: req.session.adminEmail });
});

app.post("/api/admin/auth/logout", requireSameOrigin, requireCsrfToken, requireAdmin, async (req, res, next) => {
  try {
    await destroySession(req);
    res.clearCookie("morgan_admin", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/projects", requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, period, description, tags, writeup, challenges, solutions,
              architecture, future_improvements AS "futureImprovements", url, demo_url AS "demoUrl", published
       FROM portfolio_projects
       ORDER BY sort_order, created_at DESC`,
    );
    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/projects", requireSameOrigin, requireCsrfToken, requireAdmin, async (req, res, next) => {
  const parsed = parseInput(projectSchema, req.body);
  if (parsed.error) return invalidInput(res, parsed);
  const project = parsed.data;
  try {
    const { rows } = await pool.query(
      `INSERT INTO portfolio_projects
        (title, period, description, tags, writeup, challenges, solutions, architecture, future_improvements, url, demo_url, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, title, period, description, tags, writeup, challenges, solutions,
                 architecture, future_improvements AS "futureImprovements", url, demo_url AS "demoUrl", published`,
      [project.title, project.period, project.description, project.tags, project.writeup, project.challenges,
        project.solutions, project.architecture, project.futureImprovements, project.url, project.demoUrl, project.published],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/projects/:id", requireSameOrigin, requireCsrfToken, requireAdmin, async (req, res, next) => {
  const parsedId = parseInput(uuidSchema, req.params.id);
  if (parsedId.error) return res.status(400).json({ error: "Project ID is invalid." });
  const id = parsedId.data;
  const parsed = parseInput(projectSchema, req.body);
  if (parsed.error) return invalidInput(res, parsed);
  const project = parsed.data;
  try {
    const { rows } = await pool.query(
      `UPDATE portfolio_projects
       SET title = $1, period = $2, description = $3, tags = $4, writeup = $5,
           challenges = $6, solutions = $7, architecture = $8, future_improvements = $9,
           url = $10, demo_url = $11, published = $12, updated_at = now()
       WHERE id = $13
       RETURNING id, title, period, description, tags, writeup, challenges, solutions,
                 architecture, future_improvements AS "futureImprovements", url, demo_url AS "demoUrl", published`,
      [project.title, project.period, project.description, project.tags, project.writeup, project.challenges,
        project.solutions, project.architecture, project.futureImprovements, project.url, project.demoUrl, project.published, id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Project was not found." });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/projects/:id", requireSameOrigin, requireCsrfToken, requireAdmin, async (req, res, next) => {
  const parsedId = parseInput(uuidSchema, req.params.id);
  if (parsedId.error) return res.status(400).json({ error: "Project ID is invalid." });
  try {
    const result = await pool.query("DELETE FROM portfolio_projects WHERE id = $1", [parsedId.data]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Project was not found." });
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/content", requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, category, title, period, description, body, tags, url, published
       FROM portfolio_content ORDER BY category, sort_order, created_at DESC`,
    );
    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/content", requireSameOrigin, requireCsrfToken, requireAdmin, async (req, res, next) => {
  const parsed = parseInput(contentSchema, req.body);
  if (parsed.error) return invalidInput(res, parsed);
  const entry = parsed.data;
  try {
    const { rows } = await pool.query(
      `INSERT INTO portfolio_content (category, title, period, description, body, tags, url, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, category, title, period, description, body, tags, url, published`,
      [entry.category, entry.title, entry.period, entry.description, entry.body, entry.tags, entry.url, entry.published],
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/content/:id", requireSameOrigin, requireCsrfToken, requireAdmin, async (req, res, next) => {
  const parsedId = parseInput(uuidSchema, req.params.id);
  if (parsedId.error) return res.status(400).json({ error: "Content ID is invalid." });
  const id = parsedId.data;
  const parsed = parseInput(contentSchema, req.body);
  if (parsed.error) return invalidInput(res, parsed);
  const entry = parsed.data;
  try {
    const { rows } = await pool.query(
      `UPDATE portfolio_content
       SET category = $1, title = $2, period = $3, description = $4, body = $5,
           tags = $6, url = $7, published = $8, updated_at = now()
       WHERE id = $9
       RETURNING id, category, title, period, description, body, tags, url, published`,
      [entry.category, entry.title, entry.period, entry.description, entry.body, entry.tags, entry.url, entry.published, id],
    );
    if (!rows[0]) return res.status(404).json({ error: "Content entry was not found." });
    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/admin/content/:id", requireSameOrigin, requireCsrfToken, requireAdmin, async (req, res, next) => {
  const parsedId = parseInput(uuidSchema, req.params.id);
  if (parsedId.error) return res.status(400).json({ error: "Content ID is invalid." });
  try {
    const result = await pool.query("DELETE FROM portfolio_content WHERE id = $1", [parsedId.data]);
    if (result.rowCount === 0) return res.status(404).json({ error: "Content entry was not found." });
    res.sendStatus(204);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/analytics", requireAdmin, async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT date_trunc('day', created_at)::date AS day, event, count(*)::int AS count
       FROM portfolio_analytics
       WHERE created_at >= now() - interval '30 days'
       GROUP BY day, event
       ORDER BY day DESC, event`,
    );
    res.set("Cache-Control", "no-store");
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

registerFeatureRoutes(app, { requireSameOrigin, requireCsrfToken, requireAdmin });

app.use((error, _req, res, _next) => {
  if (process.env.NODE_ENV === "production") console.error("API request failed.");
  else console.error("API request failed:", error.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "The request could not be completed." });
});

export { app };
