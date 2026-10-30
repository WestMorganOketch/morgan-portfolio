import "dotenv/config";
import { app } from "./app.js";
import { initializeAdminAuthSchema } from "./adminAuth.js";
import { pool } from "./db.js";

const port = Number(process.env.PORT || 3001);
let server;
try {
  await initializeAdminAuthSchema(pool);
  server = app.listen(port, () => {
    console.info(`Portfolio API listening on http://localhost:${port}`);
  });
} catch {
  process.exitCode = 1;
  await pool.end();
}

async function purgeExpiredContactMessages() {
  try {
    await pool.query("DELETE FROM contact_messages WHERE expires_at <= now()");
  } catch (error) {
    console.error("Contact message retention cleanup failed:", error.message);
  }
}

void purgeExpiredContactMessages();
const retentionCleanup = setInterval(() => void purgeExpiredContactMessages(), 6 * 60 * 60 * 1000);
retentionCleanup.unref();

async function shutdown(signal) {
  console.info(`${signal} received; shutting down the portfolio API.`);
  clearInterval(retentionCleanup);
  if (!server) return;
  server.close(async (serverError) => {
    try {
      await pool.end();
      if (serverError) {
        console.error("API server shutdown failed:", serverError.message);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error("PostgreSQL shutdown failed:", error.message);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
