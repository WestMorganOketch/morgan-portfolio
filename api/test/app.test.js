import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

process.env.DATABASE_URL = "postgresql://127.0.0.1:1/test";
process.env.NODE_ENV = "test";
process.env.WEB_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,https://morgan-portfolio-delta.vercel.app";

const [{ app }, { pool }] = await Promise.all([
  import("../src/app.js"),
  import("../src/db.js"),
]);

test("health check responds without requiring a database query", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.ok(response.headers.has("content-security-policy"));
    const publicHealth = await fetch(`http://127.0.0.1:${address.port}/health`);
    assert.equal(publicHealth.status, 200);
    assert.deepEqual(await publicHealth.json(), { status: "ok" });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.end();
  }
});

test("CORS accepts only configured origins and supports admin preflights", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const allowed = await fetch(`http://127.0.0.1:${address.port}/api/health`, {
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:3000");
    assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");

    const productionContact = await fetch(`http://127.0.0.1:${address.port}/api/contact`, {
      method: "POST",
      headers: {
        Origin: "https://morgan-portfolio-delta.vercel.app",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    assert.equal(productionContact.status, 400);
    assert.equal(productionContact.headers.get("access-control-allow-origin"), "https://morgan-portfolio-delta.vercel.app");

    const denied = await fetch(`http://127.0.0.1:${address.port}/api/health`, {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(denied.status, 403);

    const preflight = await fetch(`http://127.0.0.1:${address.port}/api/admin/login`, {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:3000",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-csrf-token",
      },
    });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /x-csrf-token/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("analytics rejects requests without a same-origin browser request", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/analytics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "page_view", page: "home" }),
    });
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("public content rejects unknown categories before querying PostgreSQL", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/content/not-a-portfolio-section`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Portfolio section was not found." });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("the global rate limit covers API routes", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    let response;
    for (let attempt = 0; attempt < 130; attempt++) {
      response = await fetch(`http://127.0.0.1:${address.port}/health`);
      if (response.status === 429) break;
    }
    assert.equal(response?.status, 429);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
