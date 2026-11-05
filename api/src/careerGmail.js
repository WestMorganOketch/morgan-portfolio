import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const OIDC_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE];
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const SEND_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function requiredEnv(env, names) {
  const missing = names.filter((name) => typeof env[name] !== "string" || !env[name].trim());
  if (missing.length) {
    throw new Error(`Gmail is not configured. Missing server settings: ${missing.join(", ")}.`);
  }
}

export function encryptionKeyFromEnvironment(value) {
  const secret = String(value ?? "").trim();
  if (/^[a-f\d]{64}$/i.test(secret)) return Buffer.from(secret, "hex");
  const base64 = Buffer.from(secret, "base64");
  if (base64.length === 32 && base64.toString("base64").replace(/=+$/, "") === secret.replace(/=+$/, "")) {
    return base64;
  }
  throw new Error("DOC_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hexadecimal characters or base64.");
}

export function encryptGmailRefreshToken(refreshToken, keyValue) {
  if (typeof refreshToken !== "string" || refreshToken.length < 10 || refreshToken.length > 4096) {
    throw new TypeError("The Gmail refresh token is invalid.");
  }
  const key = encryptionKeyFromEnvironment(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  return { encrypted_refresh_token: encrypted, encryption_iv: iv, encryption_tag: cipher.getAuthTag() };
}

export function decryptGmailRefreshToken(record, keyValue) {
  if (!record?.encrypted_refresh_token || !record?.encryption_iv || !record?.encryption_tag) {
    throw new Error("The saved Gmail connection is incomplete.");
  }
  const key = encryptionKeyFromEnvironment(keyValue);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.encryption_iv));
    decipher.setAuthTag(Buffer.from(record.encryption_tag));
    return Buffer.concat([
      decipher.update(Buffer.from(record.encrypted_refresh_token)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("The saved Gmail connection could not be decrypted. Reconnect Gmail using the configured encryption key.");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  let result = {};
  if (text) {
    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(`${label} returned an unreadable response.`);
    }
  }
  if (!response.ok) {
    const status = response.status;
    if (status === 401 || status === 403) {
      throw new Error(`${label} denied the request. Check the Gmail OAuth grant and requested permissions.`);
    }
    throw new Error(`${label} failed (HTTP ${status}). Retry after checking the Gmail connection.`);
  }
  return result;
}

export async function beginGmailOAuth({ db, env = process.env, now = () => new Date() } = {}) {
  requiredEnv(env, ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REDIRECT_URI", "DOC_ENCRYPTION_KEY"]);
  encryptionKeyFromEnvironment(env.DOC_ENCRYPTION_KEY);
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  await db.query("DELETE FROM public.jr_gmail_oauth_states WHERE expires_at <= $1", [now()]);
  await db.query(
    `INSERT INTO public.jr_gmail_oauth_states (state_hash, code_verifier, expires_at)
     VALUES ($1, $2, $3)`,
    [sha256(state), verifier, new Date(now().getTime() + 10 * 60 * 1000)],
  );
  const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorization.searchParams.set("client_id", env.GMAIL_OAUTH_CLIENT_ID);
  authorization.searchParams.set("redirect_uri", env.GMAIL_OAUTH_REDIRECT_URI);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("scope", OIDC_SCOPES.join(" "));
  authorization.searchParams.set("access_type", "offline");
  authorization.searchParams.set("prompt", "consent");
  authorization.searchParams.set("include_granted_scopes", "false");
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("code_challenge", challenge);
  authorization.searchParams.set("code_challenge_method", "S256");
  return { authorization_url: authorization.toString() };
}

export async function completeGmailOAuth({
  db,
  code,
  state,
  env = process.env,
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  requiredEnv(env, ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "GMAIL_OAUTH_REDIRECT_URI", "DOC_ENCRYPTION_KEY"]);
  encryptionKeyFromEnvironment(env.DOC_ENCRYPTION_KEY);
  if (typeof code !== "string" || code.length < 1 || code.length > 4096
    || typeof state !== "string" || !/^[A-Za-z0-9_-]{40,100}$/.test(state)) {
    throw new Error("The Gmail authorization response is invalid. Start the connection again.");
  }
  const { rows } = await db.query(
    `DELETE FROM public.jr_gmail_oauth_states
     WHERE state_hash = $1 AND expires_at > $2
     RETURNING code_verifier`,
    [sha256(state), now()],
  );
  if (!rows[0]?.code_verifier) {
    throw new Error("The Gmail connection request expired or was already used. Start again from Job Radar.");
  }
  const tokenResponse = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GMAIL_OAUTH_CLIENT_ID,
      client_secret: env.GMAIL_OAUTH_CLIENT_SECRET,
      redirect_uri: env.GMAIL_OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
      code_verifier: rows[0].code_verifier,
    }),
  });
  const token = await readJsonResponse(tokenResponse, "Google OAuth token exchange");
  if (typeof token.access_token !== "string" || typeof token.refresh_token !== "string") {
    throw new Error("Google did not return a refresh token. Remove the existing app grant in Google Account permissions and connect again.");
  }
  const scopes = String(token.scope ?? "").split(/\s+/).filter(Boolean);
  if (!scopes.includes(GMAIL_SEND_SCOPE)) {
    throw new Error("The Gmail grant does not include the required send-only permission.");
  }
  const userResponse = await fetchImpl(USERINFO_ENDPOINT, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const user = await readJsonResponse(userResponse, "Google account verification");
  if (typeof user.email !== "string" || user.email.length > 254 || user.email_verified !== true) {
    throw new Error("Google did not confirm a verified sender email for this account.");
  }
  if (env.GMAIL_USER && env.GMAIL_USER.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw new Error("The connected Google account does not match GMAIL_USER. Connect the configured sender account.");
  }
  const encrypted = encryptGmailRefreshToken(token.refresh_token, env.DOC_ENCRYPTION_KEY);
  await db.query(
    `INSERT INTO public.jr_gmail_credentials
      (id, email, encrypted_refresh_token, encryption_iv, encryption_tag, granted_scopes, connected_at, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email,
       encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
       encryption_iv = EXCLUDED.encryption_iv,
       encryption_tag = EXCLUDED.encryption_tag,
       granted_scopes = EXCLUDED.granted_scopes,
       connected_at = EXCLUDED.connected_at,
       updated_at = EXCLUDED.updated_at`,
    [user.email.toLowerCase(), encrypted.encrypted_refresh_token, encrypted.encryption_iv,
      encrypted.encryption_tag, scopes, now()],
  );
  return { email: user.email.toLowerCase(), scopes, connected_at: now().toISOString() };
}

export async function gmailConnectionStatus(db) {
  const { rows } = await db.query(
    "SELECT email, granted_scopes, connected_at FROM public.jr_gmail_credentials WHERE id = 1",
  );
  if (!rows[0]) return { connected: false, email: null, scopes: [], connected_at: null };
  return {
    connected: true,
    email: rows[0].email,
    scopes: Array.isArray(rows[0].granted_scopes) ? rows[0].granted_scopes : [],
    connected_at: rows[0].connected_at,
  };
}

export async function disconnectGmail(db, { env = process.env, fetchImpl = fetch } = {}) {
  const { rows } = await db.query(
    "SELECT encrypted_refresh_token, encryption_iv, encryption_tag FROM public.jr_gmail_credentials WHERE id = 1",
  );
  if (!rows[0]) return { connected: false };
  const refreshToken = decryptGmailRefreshToken(rows[0], env.DOC_ENCRYPTION_KEY);
  const response = await fetchImpl(REVOKE_ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  });
  if (!response.ok && response.status !== 400) {
    throw new Error("Google could not revoke the Gmail grant. The local connection was kept so you can retry safely.");
  }
  await db.query("DELETE FROM public.jr_gmail_credentials WHERE id = 1");
  return { connected: false };
}

async function freshAccessToken({ refreshToken, env, fetchImpl }) {
  requiredEnv(env, ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET"]);
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_OAUTH_CLIENT_ID,
      client_secret: env.GMAIL_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const result = await readJsonResponse(response, "Google OAuth refresh");
  if (typeof result.access_token !== "string" || result.access_token.length < 10) {
    throw new Error("Google did not return a valid Gmail access token. Reconnect Gmail.");
  }
  return result.access_token;
}

function wrapBase64(value, width = 76) {
  return String(value).match(new RegExp(`.{1,${width}}`, "g"))?.join("\r\n") ?? "";
}

function safeEmail(value) {
  return typeof value === "string"
    && value.length <= 254
    && /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(value);
}

function safeHeader(value) {
  // eslint-disable-next-line no-control-regex
  return String(value ?? "").replace(/[\r\n\u0000-\u001f\u007f]/g, " ").trim().slice(0, 250);
}

function buildMime({ sender, recipient, subject, body, attachments, messageId }) {
  const boundary = `career_${randomBytes(18).toString("hex")}`;
  const safeSubject = safeHeader(subject);
  const subjectEncoded = `=?UTF-8?B?${Buffer.from(safeSubject, "utf8").toString("base64")}?=`;
  const senderName = "Morgan West Oketch";
  const lines = [
    `From: ${senderName} <${sender}>`,
    `To: <${recipient}>`,
    `Subject: ${subjectEncoded}`,
    `Message-ID: <${messageId}@morgan-career-radar.local>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(Buffer.from(String(body ?? ""), "utf8").toString("base64")),
  ];
  for (const attachment of attachments) {
    const filename = String(attachment.filename ?? "document.pdf").replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 100);
    lines.push(
      "",
      `--${boundary}`,
      `Content-Type: ${attachment.contentType ?? "application/pdf"}; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      wrapBase64(Buffer.from(attachment.content).toString("base64")),
    );
  }
  lines.push("", `--${boundary}--`, "");
  return lines.join("\r\n");
}

export async function getGmailSendAccessToken({ db, env = process.env, fetchImpl = fetch } = {}) {
  if (env.JR_SEND_MODE !== "live") {
    throw new Error("Email sending is disabled. Set JR_SEND_MODE=live only after checking the Gmail OAuth connection and send limits.");
  }
  requiredEnv(env, ["GMAIL_OAUTH_CLIENT_ID", "GMAIL_OAUTH_CLIENT_SECRET", "DOC_ENCRYPTION_KEY"]);
  const { rows } = await db.query(
    "SELECT email, encrypted_refresh_token, encryption_iv, encryption_tag, granted_scopes FROM public.jr_gmail_credentials WHERE id = 1",
  );
  const credential = rows[0];
  if (!credential) throw new Error("Connect a Gmail account in Sources & Setup before sending.");
  if (!Array.isArray(credential.granted_scopes) || !credential.granted_scopes.includes(GMAIL_SEND_SCOPE)) {
    throw new Error("The saved Gmail connection lacks the send-only permission. Reconnect Gmail.");
  }
  if (env.GMAIL_USER && env.GMAIL_USER.trim().toLowerCase() !== credential.email.toLowerCase()) {
    throw new Error("GMAIL_USER does not match the connected sender. Update it or reconnect Gmail.");
  }
  const refreshToken = decryptGmailRefreshToken(credential, env.DOC_ENCRYPTION_KEY);
  const accessToken = await freshAccessToken({ refreshToken, env, fetchImpl });
  return { accessToken, senderEmail: credential.email };
}

export async function sendGmailMessage({
  db,
  to,
  subject,
  body,
  attachments = [],
  messageId,
  accessToken: suppliedAccessToken,
  senderEmail: suppliedSenderEmail,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  if (env.JR_SEND_MODE !== "live") {
    throw new Error("Email sending is disabled. Set JR_SEND_MODE=live only after checking the Gmail OAuth connection and send limits.");
  }
  if (!safeEmail(to)) throw new TypeError("Enter a valid recipient email address from the employer's official advert.");
  if (typeof subject !== "string" || !subject.trim() || /[\r\n]/.test(subject) || subject.length > 200) {
    throw new TypeError("The application email subject is invalid.");
  }
  if (typeof body !== "string" || body.trim().length < 10 || body.length > 20_000) {
    throw new TypeError("The application email body is invalid.");
  }
  if (!Array.isArray(attachments) || attachments.length < 1 || attachments.length > 3) {
    throw new TypeError("An application email must include its reviewed PDF attachments.");
  }
  let totalBytes = 0;
  for (const attachment of attachments) {
    if (!attachment?.content || !Buffer.isBuffer(attachment.content)) throw new TypeError("An email attachment is invalid.");
    totalBytes += attachment.content.length;
    if (!String(attachment.filename ?? "").toLowerCase().endsWith(".pdf")) throw new TypeError("Only reviewed PDF attachments are accepted.");
  }
  if (totalBytes > MAX_ATTACHMENT_BYTES) throw new TypeError("Combined application attachments exceed 5 MB.");
  const credentials = suppliedAccessToken && suppliedSenderEmail
    ? { accessToken: suppliedAccessToken, senderEmail: suppliedSenderEmail }
    : await getGmailSendAccessToken({ db, env, fetchImpl });
  const raw = base64Url(buildMime({
    sender: credentials.senderEmail,
    recipient: to.trim(),
    subject,
    body,
    attachments,
    messageId,
  }));
  const response = await fetchImpl(SEND_ENDPOINT, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${credentials.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  const result = await readJsonResponse(response, "Gmail send");
  if (typeof result.id !== "string" || !result.id) {
    throw new Error("Gmail did not confirm a message ID. The send outcome needs manual review; do not retry blindly.");
  }
  return { id: result.id, threadId: typeof result.threadId === "string" ? result.threadId : null };
}
