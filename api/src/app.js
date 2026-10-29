import bcrypt from "bcryptjs";
import connectPgSimple from "connect-pg-simple";
import { randomUUID } from "node:crypto";
import express from "express";
import { rateLimit } from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import { pool } from "./db.js";
import { analyticsSchema, contentCategories, contentSchema, loginSchema, parseInput, projectSchema, uuidSchema } from "./validation.js";
import { registerFeatureRoutes } from "./featureRoutes.js";

const PgSession = connectPgSimple(session);
const app = express();
const sessionSecret = process.env.SESSION_SECRET;
const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
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
if (!adminEmail || !adminPasswordHash) {
  throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD_HASH in api/.env before starting the API.");
}
if (webOrigins.size === 0) {
  throw new Error("Set WEB_ORIGINS to a comma-separated allow-list of website origins.");
}
if (invalidOrigin) {
  throw new Error("WEB_ORIGINS entries must be exact HTTP or HTTPS origins without paths.");
}

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
  store: new PgSession({
    pool,
    tableName: "admin_sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 60 * 15,
  }),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 1000 * 60 * 60 * 8,
    path: "/",
  },
}));

const loginLimiter = rateLimit({
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
  if (req.session.adminEmail !== adminEmail) {
    return res.status(401).json({ error: "Sign in to use the admin area." });
  }
  next();
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

app.post("/api/admin/login", loginLimiter, requireSameOrigin, requireCsrfToken, async (req, res, next) => {
  const parsed = parseInput(loginSchema, req.body);
  if (parsed.error) return invalidInput(res, parsed);
  try {
    const passwordMatches = await bcrypt.compare(parsed.data.password, adminPasswordHash);
    if (parsed.data.email.toLowerCase() !== adminEmail || !passwordMatches) {
      return res.status(401).json({ error: "Email or password was not accepted." });
    }
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.adminEmail = adminEmail;
      req.session.csrfToken = randomUUID();
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.set("Cache-Control", "no-store");
        res.json({ email: adminEmail, csrfToken: req.session.csrfToken });
      });
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ email: req.session.adminEmail });
});

app.post("/api/admin/logout", requireSameOrigin, requireCsrfToken, requireAdmin, (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("morgan_admin", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/" });
    res.sendStatus(204);
  });
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
