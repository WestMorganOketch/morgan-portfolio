import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { pool } from "./db.js";
import { analyticsSchema, contentCategories, contentSchema, parseInput, projectSchema, uuidSchema } from "./validation.js";
import { registerFeatureRoutes } from "./featureRoutes.js";
import { registerAdminAuth } from "./adminAuth.js";

const app = express();
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

if (webOrigins.size === 0) {
  throw new Error("Set WEB_ORIGINS to a comma-separated allow-list of website origins.");
}
if (invalidOrigin) {
  throw new Error("WEB_ORIGINS entries must be exact HTTP or HTTPS origins without paths.");
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" || process.env.NODE_ENV === "production" ? 1 : false);
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
    const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
    if (requestedMethod && !allowedMethods.has(requestedMethod.toUpperCase())) {
      return res.status(403).json({ error: "Request method was not accepted." });
    }
    const allowedHeaders = new Set(["content-type", "x-csrf-token"]);
    const requestedHeaders = (req.get("access-control-request-headers") ?? "")
      .split(",").map((header) => header.trim().toLowerCase()).filter(Boolean);
    if (requestedHeaders.some((header) => !allowedHeaders.has(header))) {
      return res.status(403).json({ error: "Request headers were not accepted." });
    }
    res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
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

const { requireAdmin, requireCsrfToken } = registerAdminAuth(app, pool, requireSameOrigin);

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
