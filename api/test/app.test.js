import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { once } from "node:events";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://127.0.0.1:1/test";
process.env.ADMIN_EMAIL = " Admin@Example.com ";
process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-to-run-tests";
const passwordSalt = randomBytes(16);
const testPasswordHash = `scrypt$${passwordSalt.toString("base64url")}$${scryptSync("correct horse battery staple", passwordSalt, 64).toString("base64url")}`;
process.env.ADMIN_PASSWORD_HASH = testPasswordHash;
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3000/api/admin/auth/google/callback";
process.env.FRONTEND_URL = "http://localhost:3000";
process.env.WEB_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,https://morgan-portfolio-delta.vercel.app";

const [{ app }, { pool }] = await Promise.all([
  import("../src/app.js"),
  import("../src/db.js"),
]);

test("production accepts password-only admin configuration without Google OAuth", () => {
  const environment = {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://127.0.0.1:1/test",
    ADMIN_EMAIL: "admin@example.com",
    ADMIN_PASSWORD_HASH: testPasswordHash,
    SESSION_SECRET: "production-password-only-test-session-secret",
    WEB_ORIGINS: "https://portfolio.example",
    DB_SSL: "true",
  };
  delete environment.GOOGLE_CLIENT_ID;
  delete environment.GOOGLE_CLIENT_SECRET;
  delete environment.GOOGLE_REDIRECT_URI;
  delete environment.FRONTEND_URL;

  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", `await import(${JSON.stringify(new URL("../src/app.js", import.meta.url).href)})`],
    { env: environment, encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0, result.stderr);
});

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

    const preflight = await fetch(`http://127.0.0.1:${address.port}/api/admin/auth/logout`, {
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

test("password admin sign-in validates origin and CSRF, verifies credentials, and creates a protected session", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  function sessionCookie(response) {
    const cookie = response.headers.get("set-cookie")?.match(/morgan_admin=[^;]+/)?.[0];
    assert.ok(cookie, "expected the API to set its session cookie");
    return cookie;
  }

  try {
    const csrfResponse = await fetch(`${baseUrl}/api/admin/csrf`);
    const csrfCookie = sessionCookie(csrfResponse);
    const { token } = await csrfResponse.json();
    const payload = JSON.stringify({ email: "ADMIN@example.com", password: "correct horse battery staple" });

    const missingCsrf = await fetch(`${baseUrl}/api/admin/auth/password`, {
      method: "POST",
      headers: { Cookie: csrfCookie, Origin: "http://localhost:3000", "Content-Type": "application/json" },
      body: payload,
    });
    assert.equal(missingCsrf.status, 403);

    const wrongPassword = await fetch(`${baseUrl}/api/admin/auth/password`, {
      method: "POST",
      headers: {
        Cookie: csrfCookie,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
      },
      body: JSON.stringify({ email: "admin@example.com", password: "incorrect password" }),
    });
    assert.equal(wrongPassword.status, 401);
    assert.deepEqual(await wrongPassword.json(), { error: "Email or password is incorrect." });

    const wrongEmail = await fetch(`${baseUrl}/api/admin/auth/password`, {
      method: "POST",
      headers: {
        Cookie: csrfCookie,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
      },
      body: JSON.stringify({ email: "other@example.com", password: "correct horse battery staple" }),
    });
    assert.equal(wrongEmail.status, 401);
    assert.deepEqual(await wrongEmail.json(), { error: "Email or password is incorrect." });

    const success = await fetch(`${baseUrl}/api/admin/auth/password`, {
      method: "POST",
      headers: {
        Cookie: csrfCookie,
        Origin: "http://localhost:3000",
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
      },
      body: payload,
    });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { email: "admin@example.com" });
    assert.match(success.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(success.headers.get("set-cookie") ?? "", /SameSite=Lax/i);
    const adminCookie = sessionCookie(success);
    assert.notEqual(adminCookie, csrfCookie, "sign-in should rotate the pre-authentication session");

    const oldSession = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: csrfCookie } });
    assert.equal(oldSession.status, 401);
    const authorized = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: adminCookie } });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { email: "admin@example.com" });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Google admin sign-in validates state and identity, creates a protected session, and logs out", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let authorizationOptions;
  let verifiedEmail = "admin@example.com";
  let emailVerified = true;
  app.locals.googleOAuthClient = {
    generateAuthUrl(options) {
      authorizationOptions = options;
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      for (const [key, value] of Object.entries(options)) {
        url.searchParams.set(key, Array.isArray(value) ? value.join(" ") : String(value));
      }
      return url.href;
    },
    async getToken({ code, codeVerifier }) {
      assert.equal(code, "mock-code");
      assert.equal(
        createHash("sha256").update(codeVerifier).digest("base64url"),
        authorizationOptions.code_challenge,
      );
      return { tokens: { id_token: "mock-id-token" } };
    },
    async verifyIdToken({ idToken, audience }) {
      assert.equal(idToken, "mock-id-token");
      assert.equal(audience, "test-google-client-id");
      return {
        getPayload: () => ({
          email: verifiedEmail,
          email_verified: emailVerified,
          nonce: authorizationOptions.nonce,
        }),
      };
    },
  };

  function sessionCookie(response) {
    const cookie = response.headers.get("set-cookie")?.match(/morgan_admin=[^;]+/)?.[0];
    assert.ok(cookie, "expected the API to set its session cookie");
    return cookie;
  }

  async function beginSignIn() {
    const response = await fetch(`${baseUrl}/api/admin/auth/google/start`, { redirect: "manual" });
    assert.equal(response.status, 302);
    const authorizationUrl = new URL(response.headers.get("location"));
    assert.equal(authorizationUrl.searchParams.get("prompt"), "select_account");
    assert.equal(authorizationUrl.searchParams.get("access_type"), "online");
    assert.equal(authorizationUrl.searchParams.get("max_age"), "0");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizationUrl.searchParams.get("scope"), "openid email profile");
    return { cookie: sessionCookie(response), state: authorizationUrl.searchParams.get("state") };
  }

  async function callback(cookie, query) {
    return fetch(`${baseUrl}/api/admin/auth/google/callback?${query}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
  }

  try {
    verifiedEmail = "admin@example.com";
    emailVerified = true;
    const allowedFlow = await beginSignIn();
    const allowedResponse = await callback(
      allowedFlow.cookie,
      new URLSearchParams({ state: allowedFlow.state, code: "mock-code" }),
    );
    assert.equal(allowedResponse.status, 302);
    assert.equal(allowedResponse.headers.get("location"), "http://localhost:3000/admin");
    const adminCookie = sessionCookie(allowedResponse);
    assert.match(allowedResponse.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(allowedResponse.headers.get("set-cookie") ?? "", /SameSite=Lax/i);
    const unauthorized = await fetch(`${baseUrl}/api/admin/me`);
    assert.equal(unauthorized.status, 401);
    const authorized = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: adminCookie } });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), { email: "admin@example.com" });

    const csrfResponse = await fetch(`${baseUrl}/api/admin/csrf`, { headers: { Cookie: adminCookie } });
    const { token } = await csrfResponse.json();
    const logout = await fetch(`${baseUrl}/api/admin/auth/logout`, {
      method: "POST",
      headers: { Cookie: adminCookie, Origin: "http://localhost:3000", "X-CSRF-Token": token },
    });
    assert.equal(logout.status, 204);
    const afterLogout = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: adminCookie } });
    assert.equal(afterLogout.status, 401);

    verifiedEmail = "other@example.com";
    const deniedFlow = await beginSignIn();
    const deniedResponse = await callback(
      deniedFlow.cookie,
      new URLSearchParams({ state: deniedFlow.state, code: "mock-code" }),
    );
    assert.equal(deniedResponse.status, 403);
    assert.match(deniedResponse.headers.get("refresh") ?? "", /error=not_allowed/);
    const deniedSession = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: deniedFlow.cookie } });
    assert.equal(deniedSession.status, 401);

    verifiedEmail = "admin@example.com";
    emailVerified = false;
    const unverifiedFlow = await beginSignIn();
    const unverifiedResponse = await callback(
      unverifiedFlow.cookie,
      new URLSearchParams({ state: unverifiedFlow.state, code: "mock-code" }),
    );
    assert.equal(unverifiedResponse.status, 400);
    const unverifiedSession = await fetch(`${baseUrl}/api/admin/me`, { headers: { Cookie: unverifiedFlow.cookie } });
    assert.equal(unverifiedSession.status, 401);

    emailVerified = true;
    const badStateFlow = await beginSignIn();
    const badStateResponse = await callback(
      badStateFlow.cookie,
      new URLSearchParams({ state: "incorrect-state", code: "mock-code" }),
    );
    assert.equal(badStateResponse.status, 400);
    const missingStateFlow = await beginSignIn();
    const missingStateResponse = await callback(missingStateFlow.cookie, "code=mock-code");
    assert.equal(missingStateResponse.status, 400);
  } finally {
    delete app.locals.googleOAuthClient;
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
