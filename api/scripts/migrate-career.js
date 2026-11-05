import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool } from "../src/db.js";

// Run only when explicitly invoked by the owner against the intended database.
// Each file is transactional and designed to be re-runnable; this is never
// imported by the API server and never runs automatically at startup.
const migrationFiles = Object.freeze([
  "004_career_foundation.sql",
  "005_career_intake.sql",
  "006_career_assessments.sql",
  "007_career_applications.sql",
  "008_career_preparation.sql",
]);

let activeMigration = "connection check";
try {
  await pool.query("SELECT 1");
  for (const filename of migrationFiles) {
    activeMigration = filename;
    const sql = readFileSync(new URL(`../migrations/${filename}`, import.meta.url), "utf8");
    if (!sql.trim()) throw new Error("Migration file is empty.");
    await pool.query(sql);
    console.info(`Career Radar migration applied: ${filename}`);
  }
  console.info("Career Radar schema sequence completed. Secrets, OAuth, schedules, and deployment are not configured by this command.");
} catch (error) {
  console.error(`Career Radar migration failed at ${activeMigration}: ${String(error?.message ?? "unknown database error")}`);
  console.error("Earlier files may already have committed. Correct the reported issue, verify the target database, and rerun the idempotent sequence; no automatic rollback was attempted.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
