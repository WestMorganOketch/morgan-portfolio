import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pool } from "../src/db.js";

const confirmationPhrase = "CLEAR ALL ADMIN SESSIONS";

if (!stdin.isTTY || !stdout.isTTY) {
  console.error("Run this command in an interactive terminal. No sessions were deleted.");
  await pool.end();
  process.exitCode = 1;
} else {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    console.warn("This invalidates every active admin session in the database configured for this API.");
    const answer = await prompt.question(`Type "${confirmationPhrase}" to continue: `);
    if (answer !== confirmationPhrase) {
      console.info("Canceled. No sessions were deleted.");
    } else {
      const { rowCount } = await pool.query("DELETE FROM admin_sessions");
      console.info(`Deleted ${rowCount ?? 0} admin session(s).`);
    }
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "unknown";
    console.error(`Admin session cleanup failed (${code}). No database details were logged.`);
    process.exitCode = 1;
  } finally {
    prompt.close();
    await pool.end();
  }
}
