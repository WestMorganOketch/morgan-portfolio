import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required. Copy .env.example to .env and configure it.");
}
if (process.env.NODE_ENV === "production" && process.env.DB_SSL !== "true") {
  throw new Error("DB_SSL=true is required in production.");
}

const ssl = process.env.DB_SSL === "true"
  ? {
      rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA || process.env.DB_SSL_CA_PATH
        ? { ca: process.env.DB_SSL_CA || readFileSync(process.env.DB_SSL_CA_PATH, "utf8") }
        : {}),
    }
  : undefined;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});
