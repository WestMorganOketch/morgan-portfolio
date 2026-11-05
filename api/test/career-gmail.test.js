import assert from "node:assert/strict";
import test from "node:test";
import {
  beginGmailOAuth,
  completeGmailOAuth,
  decryptGmailRefreshToken,
  disconnectGmail,
  encryptGmailRefreshToken,
  encryptionKeyFromEnvironment,
  gmailConnectionStatus,
  sendGmailMessage,
} from "../src/careerGmail.js";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const ENCRYPTION_KEY = "3f".repeat(32);
const env = {
  DOC_ENCRYPTION_KEY: ENCRYPTION_KEY,
  GMAIL_OAUTH_CLIENT_ID: "client-id.apps.googleusercontent.com",
  GMAIL_OAUTH_CLIENT_SECRET: "test-client-secret",
  GMAIL_OAUTH_REDIRECT_URI: "https://api.example.test/api/admin/career/gmail/oauth/callback",
};
const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status,
  headers: { "Content-Type": "application/json" },
});

function oauthDb() {
  const stateRows = new Map();
  let credential = null;
  const writes = [];
  return {
    stateRows,
    writes,
    get credential() { return credential; },
    set credential(value) { credential = value; },
    async query(sql, values = []) {
      const statement = sql.replace(/\s+/g, " ").trim();
      if (statement.startsWith("DELETE FROM public.jr_gmail_oauth_states WHERE expires_at")) {
        for (const [key, value] of stateRows) if (value.expires_at <= values[0]) stateRows.delete(key);
        return { rows: [] };
      }
      if (statement.startsWith("INSERT INTO public.jr_gmail_oauth_states")) {
        stateRows.set(values[0], { state_hash: values[0], code_verifier: values[1], expires_at: values[2] });
        return { rows: [] };
      }
      if (statement.startsWith("DELETE FROM public.jr_gmail_oauth_states") && statement.includes("RETURNING code_verifier")) {
        const row = stateRows.get(values[0]);
        stateRows.delete(values[0]);
        return { rows: row && row.expires_at > values[1] ? [{ code_verifier: row.code_verifier }] : [] };
      }
      if (statement.startsWith("INSERT INTO public.jr_gmail_credentials")) {
        credential = {
          id: 1,
          email: values[0],
          encrypted_refresh_token: values[1],
          encryption_iv: values[2],
          encryption_tag: values[3],
          granted_scopes: values[4],
          connected_at: values[5],
        };
        writes.push({ statement, values });
        return { rows: [] };
      }
      if (statement.startsWith("SELECT email, granted_scopes, connected_at FROM public.jr_gmail_credentials")) {
        return { rows: credential ? [{
          email: credential.email,
          granted_scopes: credential.granted_scopes,
          connected_at: credential.connected_at,
        }] : [] };
      }
      if (statement.startsWith("SELECT encrypted_refresh_token, encryption_iv, encryption_tag FROM public.jr_gmail_credentials")) {
        return { rows: credential ? [credential] : [] };
      }
      if (statement.startsWith("DELETE FROM public.jr_gmail_credentials")) {
        credential = null;
        return { rows: [] };
      }
      if (statement.startsWith("SELECT email, encrypted_refresh_token, encryption_iv, encryption_tag, granted_scopes FROM public.jr_gmail_credentials")) {
        return { rows: credential ? [credential] : [] };
      }
      throw new Error(`Unexpected Gmail fake database query: ${statement}`);
    },
  };
}

test("AES-GCM refresh tokens round-trip, reject bad key lengths, and detect tampering", () => {
  const record = encryptGmailRefreshToken("refresh-token-example-123456", ENCRYPTION_KEY);
  assert.equal(decryptGmailRefreshToken(record, ENCRYPTION_KEY), "refresh-token-example-123456");
  assert.equal(encryptionKeyFromEnvironment(ENCRYPTION_KEY).length, 32);
  assert.throws(() => encryptionKeyFromEnvironment("short"), /32-byte key/i);
  assert.throws(() => decryptGmailRefreshToken({ ...record, encryption_tag: Buffer.alloc(16) }, ENCRYPTION_KEY), /could not be decrypted/i);
});

test("OAuth start uses PKCE, hashed one-use state, a narrow send-only grant, and HTTPS Google", async () => {
  const db = oauthDb();
  const now = () => new Date("2026-11-05T08:00:00.000Z");
  const deterministicBytes = [Buffer.alloc(32, 1), Buffer.alloc(32, 2)];
  const randomBytesImpl = (size) => {
    assert.equal(size, 32);
    const next = deterministicBytes.shift();
    assert.ok(next, "only the OAuth state and PKCE verifier request random bytes");
    return next;
  };
  const result = await beginGmailOAuth({ db, env, now, randomBytesImpl });
  const authorization = new URL(result.authorization_url);
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.pathname, "/o/oauth2/v2/auth");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.get("code_challenge"), "bB1ju9q0N8VDaMu9iIaohqea2XcpfiZe6_H19fAVM7k");
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.equal(authorization.searchParams.get("prompt"), "consent");
  assert.deepEqual(authorization.searchParams.get("scope").split(" ").sort(), ["openid", "email", GMAIL_SEND_SCOPE].sort());
  assert.equal(authorization.searchParams.get("redirect_uri"), env.GMAIL_OAUTH_REDIRECT_URI);
  assert.equal(db.stateRows.size, 1);
  const [stateHash, stored] = [...db.stateRows.entries()][0];
  assert.equal(authorization.searchParams.get("state"), "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
  assert.equal(stateHash, "56d5fa7333f6d747db42c239407e5da4c32f4c79f35d092b134fd35a402d9c5c");
  assert.notEqual(stateHash, authorization.searchParams.get("state"));
  assert.equal(stored.code_verifier, "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI");
  assert.equal(deterministicBytes.length, 0);
});

test("OAuth callback verifies state and email and stores only an encrypted refresh token", async () => {
  const db = oauthDb();
  const now = () => new Date("2026-11-05T08:00:00.000Z");
  const start = await beginGmailOAuth({ db, env, now });
  const authorization = new URL(start.authorization_url);
  const calls = [];
  const result = await completeGmailOAuth({
    db,
    code: "provider-auth-code",
    state: authorization.searchParams.get("state"),
    env,
    now,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({
          access_token: "access-token-example",
          refresh_token: "refresh-token-example-123456",
          scope: `openid email ${GMAIL_SEND_SCOPE}`,
          token_type: "Bearer",
        });
      }
      if (String(url) === "https://openidconnect.googleapis.com/v1/userinfo") {
        assert.equal(init.headers.Authorization, "Bearer access-token-example");
        return jsonResponse({ email: "Morgan@example.test", email_verified: true });
      }
      throw new Error("Unexpected provider endpoint");
    },
  });
  assert.equal(result.email, "morgan@example.test");
  assert.ok(result.scopes.includes(GMAIL_SEND_SCOPE));
  assert.equal(calls.length, 2);
  assert.equal(db.stateRows.size, 0);
  assert.equal(db.credential.email, "morgan@example.test");
  assert.notEqual(db.credential.encrypted_refresh_token.toString("utf8"), "refresh-token-example-123456");
  assert.equal(decryptGmailRefreshToken(db.credential, ENCRYPTION_KEY), "refresh-token-example-123456");
  assert.equal((await gmailConnectionStatus(db)).connected, true);
});

test("OAuth one-use state cannot be replayed and wrong account is not saved", async () => {
  const db = oauthDb();
  const now = () => new Date("2026-11-05T08:00:00.000Z");
  const start = await beginGmailOAuth({ db, env, now });
  const state = new URL(start.authorization_url).searchParams.get("state");
  const fetchImpl = async (url) => String(url) === "https://oauth2.googleapis.com/token"
    ? jsonResponse({ access_token: "access-token-example", refresh_token: "refresh-token-example-123456", scope: GMAIL_SEND_SCOPE })
    : jsonResponse({ email: "someone-else@example.test", email_verified: true });
  await assert.rejects(
    completeGmailOAuth({ db, code: "code", state, env: { ...env, GMAIL_USER: "morgan@example.test" }, fetchImpl, now }),
    /does not match GMAIL_USER/i,
  );
  assert.equal(db.credential, null);
  await assert.rejects(completeGmailOAuth({ db, code: "code", state, env, fetchImpl, now }), /expired or was already used/i);
});

test("sending fails closed in draft mode and rejects an invalid recipient before provider calls", async () => {
  const db = oauthDb();
  let providerCalls = 0;
  const fetchImpl = async () => { providerCalls++; return jsonResponse({}); };
  await assert.rejects(
    sendGmailMessage({ db, to: "person@example.com", subject: "Application", body: "Please review", attachments: [{ filename: "cv.pdf", content: Buffer.from("%PDF-1.4") }], messageId: "packet", env: { ...env, JR_SEND_MODE: "draft" }, fetchImpl }),
    /disabled/i,
  );
  await assert.rejects(
    sendGmailMessage({ db, to: "not-an-email", subject: "Application", body: "Please review", attachments: [{ filename: "cv.pdf", content: Buffer.from("%PDF-1.4") }], messageId: "packet", env: { ...env, JR_SEND_MODE: "live" }, fetchImpl }),
    /valid recipient email/i,
  );
  assert.equal(providerCalls, 0);
});

test("send path refreshes tokens, attaches only bounded PDF files, and records provider confirmation", async () => {
  const db = oauthDb();
  const encrypted = encryptGmailRefreshToken("refresh-token-example-123456", ENCRYPTION_KEY);
  db.credential = {
    id: 1,
    email: "morgan@example.test",
    ...encrypted,
    granted_scopes: ["openid", "email", GMAIL_SEND_SCOPE],
  };
  const calls = [];
  const result = await sendGmailMessage({
    db,
    to: "hr@example.test",
    subject: "Application — Security Analyst",
    body: "Dear Hiring Team,\nPlease consider my application.",
    attachments: [
      { filename: "Morgan-CV.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.4 CV") },
      { filename: "Morgan-Cover-Letter.pdf", contentType: "application/pdf", content: Buffer.from("%PDF-1.4 letter") },
    ],
    messageId: "packet-123",
    env: { ...env, JR_SEND_MODE: "live" },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url) === "https://oauth2.googleapis.com/token") {
        return jsonResponse({ access_token: "fresh-access-token-example" });
      }
      if (String(url) === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
        assert.equal(init.headers.Authorization, "Bearer fresh-access-token-example");
        const raw = JSON.parse(init.body).raw;
        const mime = Buffer.from(raw, "base64url").toString("utf8");
        assert.match(mime, /To: <hr@example\.test>/);
        assert.match(mime, /Morgan-CV\.pdf/);
        assert.match(mime, /Morgan-Cover-Letter\.pdf/);
        return jsonResponse({ id: "gmail-message-123", threadId: "gmail-thread-123" });
      }
      throw new Error("Unexpected provider endpoint");
    },
  });
  assert.deepEqual(result, { id: "gmail-message-123", threadId: "gmail-thread-123" });
  assert.deepEqual(calls.map((call) => call.url), [
    "https://oauth2.googleapis.com/token",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
  ]);
});

test("disconnect revokes the OAuth grant before deleting the stored credential", async () => {
  const db = oauthDb();
  db.credential = {
    id: 1,
    email: "morgan@example.test",
    ...encryptGmailRefreshToken("refresh-token-example-123456", ENCRYPTION_KEY),
    granted_scopes: ["openid", "email", GMAIL_SEND_SCOPE],
  };
  let requestBody = null;
  const result = await disconnectGmail(db, {
    env,
    fetchImpl: async (url, init) => {
      assert.equal(String(url), "https://oauth2.googleapis.com/revoke");
      requestBody = new URLSearchParams(init.body);
      return new Response(null, { status: 200 });
    },
  });
  assert.deepEqual(result, { connected: false });
  assert.equal(requestBody.get("token"), "refresh-token-example-123456");
  assert.equal(db.credential, null);
});
