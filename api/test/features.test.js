import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import test from "node:test";

process.env.DATABASE_URL = "postgresql://127.0.0.1:1/test";
process.env.NODE_ENV = "test";
process.env.ADMIN_EMAIL = "admin@example.test";
process.env.SESSION_SECRET = "test-session-secret-with-more-than-thirty-two-characters";
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/admin/auth/google/callback";
process.env.FRONTEND_URL = "http://localhost:3000";
process.env.WEB_ORIGINS = "http://localhost:3000";

const [{ app }, { pool }] = await Promise.all([
  import("../src/app.js"),
  import("../src/db.js"),
]);

const alerts = JSON.parse(readFileSync(new URL("../data/alerts.json", import.meta.url), "utf8"));
const roundAlerts = [
  ...alerts.filter((alert) => alert.verdict === "true_positive").slice(0, 5),
  ...alerts.filter((alert) => alert.verdict === "false_positive").slice(0, 5),
];

test("round-start response never exposes the answer key", async () => {
  const originalQuery = pool.query.bind(pool);
  const originalConnect = pool.connect.bind(pool);
  let tokenHash;
  let submitted = false;
  pool.query = async (query, values) => {
    const sql = typeof query === "string" ? query : query.text;
    if (sql.includes("INSERT INTO triage_rounds")) {
      tokenHash = values[0];
      return { rows: [{ expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }] };
    }
    return { rows: roundAlerts };
  };
  pool.connect = async () => ({
    query: async (query, values = []) => {
      if (query === "BEGIN" || query === "COMMIT" || query === "ROLLBACK") return { rows: [] };
      if (query.includes("FROM triage_rounds")) {
        assert.equal(values[0], tokenHash);
        return { rows: [{
          alertIds: roundAlerts.map((alert) => alert.id),
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          submittedAt: submitted ? new Date().toISOString() : null,
        }] };
      }
      if (query.includes("FROM soc_alerts WHERE id")) return { rows: roundAlerts };
      if (query.includes("UPDATE triage_rounds SET submitted_at")) {
        submitted = true;
        return { rows: [] };
      }
      if (query.includes("INSERT INTO triage_scores")) {
        return { rows: [{
          id: "00000000-0000-4000-8000-000000000001",
          nickname: values[0],
          score: values[1],
          createdAt: new Date().toISOString(),
        }] };
      }
      throw new Error("Unexpected triage test query.");
    },
    release() {},
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/triage/round`, {
      method: "POST",
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.alerts.length, 10);
    assert.equal(typeof body.roundToken, "string");
    for (const alert of body.alerts) {
      assert.deepEqual(Object.keys(alert).sort(), ["details", "difficulty", "id", "severity", "source", "title"]);
      assert.equal(Object.hasOwn(alert, "verdict"), false);
      assert.equal(Object.hasOwn(alert, "explanation"), false);
      assert.equal(Object.hasOwn(alert, "mitre"), false);
    }
    assert.equal(/"verdict"|"explanation"|"mitre"/i.test(JSON.stringify(body)), false);
    const submission = {
      roundToken: body.roundToken,
      nickname: "Analyst-01",
      answers: roundAlerts.map((alert) => ({ alertId: alert.id, verdict: alert.verdict })),
    };
    const submittedResponse = await fetch(`http://127.0.0.1:${address.port}/api/triage/submit`, {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
    assert.equal(submittedResponse.status, 201);
    const result = await submittedResponse.json();
    assert.equal(result.score, 1500);
    assert.equal(result.correctCount, 10);
    assert.equal(result.reviews.length, 10);
    assert.ok(result.reviews.every((review) => typeof review.explanation === "string"));

    const replay = await fetch(`http://127.0.0.1:${address.port}/api/triage/submit`, {
      method: "POST",
      headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
    assert.equal(replay.status, 409);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    pool.query = originalQuery;
    pool.connect = originalConnect;
  }
});

test("private feature endpoints reject unsigned visitors before querying PostgreSQL", async () => {
  const originalQuery = pool.query.bind(pool);
  pool.query = async () => {
    throw new Error("Protected feature endpoint queried the database without an admin session.");
  };
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    for (const path of [
      "/api/admin/contact-messages",
      "/api/admin/triage/scores",
      "/api/admin/documents",
    ]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 401, path);
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    pool.query = originalQuery;
  }
});

test("document file requests reject unknown query parameters before storage access", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/documents/00000000-0000-4000-8000-000000000001/file?download=unknown`,
    );
    assert.equal(response.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("contact messages require consent and enforce their stricter rate limit", async () => {
  const originalQuery = pool.query.bind(pool);
  pool.query = async () => {
    throw new Error("Invalid contact data queried the database.");
  };
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const statuses = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/contact`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Test User", email: "test@example.test", subject: "A question", message: "This is a sufficiently detailed message." }),
      });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [400, 400, 400, 429]);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    pool.query = originalQuery;
  }
});

test("triage score submissions are rate limited even when validation fails", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const statuses = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/triage/submit`, {
        method: "POST",
        headers: {
          Origin: "http://localhost:3000",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ invalid: true }),
      });
      statuses.push(response.status);
    }
    const firstLimitedAttempt = statuses.indexOf(429);
    assert.ok(firstLimitedAttempt >= 0 && firstLimitedAttempt < 6);
    assert.ok(statuses.slice(0, firstLimitedAttempt).every((status) => status === 400));
    assert.ok(statuses.slice(firstLimitedAttempt).every((status) => status === 429));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
