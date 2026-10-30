import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import test from "node:test";
import { hashAdminPassword, initializeAdminAuthSchema, registerAdminAuth } from "../src/adminAuth.js";

class FakeAdminDatabase {
  account = null;
  sessions = new Map();
  migrations = [];

  async query(sql, values = []) {
    const statement = sql.replace(/\s+/g, " ").trim();
    if (statement.startsWith("BEGIN;")) {
      this.migrations.push(statement);
      return { rows: [], rowCount: 0 };
    }
    if (statement.startsWith("SELECT EXISTS")) {
      return { rows: [{ claimed: Boolean(this.account) }], rowCount: 1 };
    }
    if (statement.startsWith("INSERT INTO public.admin_account")) {
      if (this.account) return { rows: [], rowCount: 0 };
      this.account = { email: values[0], password_hash: values[1] };
      return { rows: [{ email: this.account.email }], rowCount: 1 };
    }
    if (statement.startsWith("SELECT email, password_hash")) {
      return { rows: this.account ? [{ ...this.account }] : [], rowCount: this.account ? 1 : 0 };
    }
    if (statement.startsWith("INSERT INTO public.admin_sessions")) {
      const session = {
        token_hash: values[0],
        sess: JSON.parse(values[1]),
        created_at: values[3],
        expires_at: values[2],
        last_seen_at: values[3],
      };
      this.sessions.set(session.token_hash, session);
      return { rows: [], rowCount: 1 };
    }
    if (statement.startsWith("UPDATE public.admin_sessions")) {
      const session = this.sessions.get(values[0]);
      const now = Date.now();
      if (!session || !this.account
        || session.created_at.getTime() <= now - 8 * 60 * 60 * 1000
        || session.expires_at.getTime() <= now
        || session.last_seen_at.getTime() <= now - 2 * 60 * 60 * 1000) {
        return { rows: [], rowCount: 0 };
      }
      session.last_seen_at = new Date();
      return { rows: [{ email: this.account.email, sess: session.sess }], rowCount: 1 };
    }
    if (statement.startsWith("DELETE FROM public.admin_sessions WHERE token_hash =")) {
      const deleted = this.sessions.delete(values[0]);
      return { rows: [], rowCount: Number(deleted) };
    }
    if (statement.startsWith("SELECT password_hash")) {
      return { rows: this.account ? [{ password_hash: this.account.password_hash }] : [], rowCount: this.account ? 1 : 0 };
    }
    if (statement.startsWith("WITH changed AS")) {
      if (!this.account) return { rows: [], rowCount: 0 };
      this.account.email = values[0] ?? this.account.email;
      this.account.password_hash = values[1];
      for (const tokenHash of this.sessions.keys()) {
        if (tokenHash !== values[2]) this.sessions.delete(tokenHash);
      }
      return { rows: [{ email: this.account.email }], rowCount: 1 };
    }
    throw new Error(`Unexpected test query: ${statement}`);
  }
}

async function createFixture() {
  const db = new FakeAdminDatabase();
  const app = express();
  app.use(express.json());
  const requireSameOrigin = (req, res, next) => {
    if (req.get("origin") !== "http://localhost:3000") {
      return res.status(403).json({ error: "Request origin was not accepted." });
    }
    next();
  };
  const { requireAdmin } = registerAdminAuth(app, db, requireSameOrigin);
  app.get("/api/admin/protected", requireAdmin, (req, res) => res.json({ email: req.adminSession.email }));
  app.use((error, _req, res, _next) => res.status(500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    db,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    request: (path, { body, cookie, csrf, forwardedProto } = {}) => {
      const headers = { Origin: "http://localhost:3000" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (cookie) headers.Cookie = cookie;
      if (csrf) headers["X-CSRF-Token"] = csrf;
      if (forwardedProto) headers["X-Forwarded-Proto"] = forwardedProto;
      return fetch(`http://127.0.0.1:${address.port}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
  };
}

function sessionCookie(response) {
  const header = response.headers.get("set-cookie");
  assert.ok(header);
  assert.match(header, /^morgan_admin=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=28800/);
  return header.split(";")[0];
}

async function claim(fixture, email = "owner@example.test", password = "correct horse battery", forwardedProto) {
  return fixture.request("/api/admin/claim", {
    body: { email, password, confirmPassword: password },
    forwardedProto,
  });
}

test("admin setup status, claim, login, protected routes, and logout", async () => {
  const fixture = await createFixture();
  try {
    assert.deepEqual(await (await fixture.request("/api/admin/status")).json(), { claimed: false });
    const beforeClaimLogin = await fixture.request("/api/admin/login", {
      body: { email: "owner@example.test", password: "correct horse battery" },
    });
    assert.equal(beforeClaimLogin.status, 409);
    assert.deepEqual(await beforeClaimLogin.json(), { error: "Not set up yet", claimed: false });

    const claimResponse = await claim(fixture, " Owner@Example.Test ");
    assert.equal(claimResponse.status, 201);
    assert.deepEqual(await claimResponse.json(), { email: "owner@example.test" });
    const cookie = sessionCookie(claimResponse);
    const rawToken = cookie.slice("morgan_admin=".length);
    const storedTokenHash = [...fixture.db.sessions.keys()][0];
    assert.equal(storedTokenHash.length, 64);
    assert.notEqual(storedTokenHash, rawToken);

    assert.deepEqual(await (await fixture.request("/api/admin/status")).json(), { claimed: true });
    assert.equal((await fixture.request("/api/admin/protected")).status, 401);
    assert.equal((await fixture.request("/api/admin/protected", { cookie })).status, 200);
    assert.equal((await claim(fixture)).status, 409);

    const csrf = await fixture.request("/api/admin/csrf", { cookie });
    const csrfToken = (await csrf.json()).token;
    const logout = await fixture.request("/api/admin/logout", { body: {}, cookie, csrf: csrfToken });
    assert.equal(logout.status, 204);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await fixture.request("/api/admin/me", { cookie })).status, 401);
  } finally {
    await fixture.close();
  }
});

test("concurrent first claims create exactly one admin", async () => {
  const fixture = await createFixture();
  try {
    const results = await Promise.all([
      claim(fixture, "one@example.test"),
      claim(fixture, "two@example.test"),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
    assert.equal(fixture.db.account.email === "one@example.test" || fixture.db.account.email === "two@example.test", true);
  } finally {
    await fixture.close();
  }
});

test("login checks email and password, rate limits failures, then accepts the owner", async () => {
  const fixture = await createFixture();
  try {
    await claim(fixture);
    const wrongEmail = await fixture.request("/api/admin/login", {
      body: { email: "other@example.test", password: "correct horse battery" },
    });
    assert.equal(wrongEmail.status, 401);
    assert.deepEqual(await wrongEmail.json(), { error: "Invalid email or password" });
    const wrongPassword = await fixture.request("/api/admin/login", {
      body: { email: "owner@example.test", password: "incorrect password" },
    });
    assert.equal(wrongPassword.status, 401);

    const limitEmail = "limit@example.test";
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fixture.request("/api/admin/login", {
        body: { email: limitEmail, password: "incorrect password" },
      });
      assert.equal(response.status, 401);
    }
    const limited = await fixture.request("/api/admin/login", {
      body: { email: limitEmail, password: "incorrect password" },
    });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);

    const success = await fixture.request("/api/admin/login", {
      body: { email: " OWNER@EXAMPLE.TEST ", password: "correct horse battery" },
    });
    assert.equal(success.status, 200);
    const cookie = sessionCookie(success);
    assert.deepEqual(await (await fixture.request("/api/admin/me", { cookie })).json(), { email: "owner@example.test" });
  } finally {
    await fixture.close();
  }
});

test("credential changes require the current password and invalidate other sessions", async () => {
  const fixture = await createFixture();
  try {
    const claimResponse = await claim(fixture);
    const ownerCookie = sessionCookie(claimResponse);
    const secondLogin = await fixture.request("/api/admin/login", {
      body: { email: "owner@example.test", password: "correct horse battery" },
    });
    const secondCookie = sessionCookie(secondLogin);
    const csrfToken = (await (await fixture.request("/api/admin/csrf", { cookie: ownerCookie })).json()).token;

    const wrongPassword = await fixture.request("/api/admin/change-credentials", {
      body: { currentPassword: "wrong current password", newEmail: "new@example.test" },
      cookie: ownerCookie,
      csrf: csrfToken,
    });
    assert.equal(wrongPassword.status, 401);

    const changed = await fixture.request("/api/admin/change-credentials", {
      body: {
        currentPassword: "correct horse battery",
        newEmail: " NEW@EXAMPLE.TEST ",
        newPassword: "a different correct password",
      },
      cookie: ownerCookie,
      csrf: csrfToken,
    });
    assert.equal(changed.status, 200);
    assert.deepEqual(await changed.json(), { email: "new@example.test" });
    assert.deepEqual(await (await fixture.request("/api/admin/me", { cookie: ownerCookie })).json(), { email: "new@example.test" });
    assert.equal((await fixture.request("/api/admin/me", { cookie: secondCookie })).status, 401);

    const oldPassword = await fixture.request("/api/admin/login", {
      body: { email: "new@example.test", password: "correct horse battery" },
    });
    assert.equal(oldPassword.status, 401);
    const newPassword = await fixture.request("/api/admin/login", {
      body: { email: "new@example.test", password: "a different correct password" },
    });
    assert.equal(newPassword.status, 200);
  } finally {
    await fixture.close();
  }
});

test("expired idle sessions are rejected", async () => {
  const fixture = await createFixture();
  try {
    const response = await claim(fixture);
    const cookie = sessionCookie(response);
    const session = [...fixture.db.sessions.values()][0];
    session.last_seen_at = new Date(Date.now() - 2 * 60 * 60 * 1000 - 1000);
    assert.equal((await fixture.request("/api/admin/me", { cookie })).status, 401);
  } finally {
    await fixture.close();
  }
});

test("session cookies are secure behind HTTPS and schema migration is idempotent", async () => {
  const fixture = await createFixture();
  try {
    const response = await claim(fixture, "secure@example.test", "secure testing password", "https");
    assert.equal(response.status, 201);
    assert.match(response.headers.get("set-cookie") ?? "", /; Secure/);
  } finally {
    await fixture.close();
  }

  const db = new FakeAdminDatabase();
  await initializeAdminAuthSchema(db);
  await initializeAdminAuthSchema(db);
  assert.equal(db.migrations.length, 2);
  for (const migration of db.migrations) {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.admin_account/);
    assert.match(migration, /CHECK \(id = 1\)/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS token_hash/);
    assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  }
});

test("password hashing uses the configured scrypt format", async () => {
  const hash = await hashAdminPassword("a valid test password");
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
});
