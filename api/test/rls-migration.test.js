import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/003_enable_rls.sql", import.meta.url), "utf8");
const baseMigration = readFileSync(new URL("../scripts/migrate.js", import.meta.url), "utf8");
const featuresMigration = readFileSync(new URL("../migrations/002_features.sql", import.meta.url), "utf8");
const careerFoundationMigration = readFileSync(new URL("../migrations/004_career_foundation.sql", import.meta.url), "utf8");
const careerIntakeMigration = readFileSync(new URL("../migrations/005_career_intake.sql", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
const adminAuthSource = readFileSync(new URL("../src/adminAuth.js", import.meta.url), "utf8");
const applicationTables = [
  "portfolio_projects",
  "portfolio_analytics",
  "portfolio_content",
  "contact_messages",
  "soc_alerts",
  "triage_rounds",
  "triage_scores",
  "documents",
  "admin_sessions",
];

test("all application tables enable RLS in their creation migration", () => {
  for (const table of ["portfolio_projects", "portfolio_analytics", "portfolio_content"]) {
    const creation = baseMigration.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    const enableRls = baseMigration.indexOf(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    assert.ok(creation >= 0, `${table} must be created by the base migration`);
    assert.ok(enableRls > creation, `${table} must enable RLS after creation`);
  }

  for (const table of ["contact_messages", "soc_alerts", "triage_rounds", "triage_scores", "documents"]) {
    const creation = featuresMigration.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`);
    const enableRls = featuresMigration.indexOf(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    assert.ok(creation >= 0, `${table} must be created by the feature migration`);
    assert.ok(enableRls > creation, `${table} must enable RLS after creation`);
  }

  assert.match(migration, /CREATE TABLE IF NOT EXISTS admin_sessions[\s\S]*?ALTER TABLE admin_sessions ENABLE ROW LEVEL SECURITY/);
  assert.match(adminAuthSource, /CREATE TABLE IF NOT EXISTS public\.admin_account[\s\S]*?ENABLE ROW LEVEL SECURITY/);
  assert.match(adminAuthSource, /ADD COLUMN IF NOT EXISTS token_hash/);
  assert.match(appSource, /registerAdminAuth\(app, pool, requireSameOrigin\)/);
  for (const table of applicationTables) {
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  }
});

test("RLS migration revokes client access and creates no public policies", () => {
  assert.match(migration, /FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /ALTER DEFAULT PRIVILEGES IN SCHEMA public[\s\S]*?REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /ALTER DEFAULT PRIVILEGES IN SCHEMA public[\s\S]*?REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /CREATE\s+POLICY/i);
});

test("phase 2 intake tables enable RLS and do not alter or drop prior tables", () => {
  const sql = readFileSync(new URL("../../docs/career-automation/sql/phase-2.sql", import.meta.url), "utf8");
  assert.equal(sql, careerIntakeMigration);
  assert.match(sql, /^\s*BEGIN;/);
  assert.match(sql, /COMMIT;\s*$/);
  assert.doesNotMatch(sql, /\b(?:DROP|ALTER)\s+TABLE\s+public\.(?!jr_)[a-z_]+/i);
  assert.doesNotMatch(sql, /\b(?:DROP|ALTER)\s+TABLE\s+public\.jr_(?!jobs|ats_watchlist)[a-z_]+/i);
  assert.doesNotMatch(sql, /CREATE\s+POLICY/i);
  const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(jr_[a-z_]+)/gi)].map((match) => match[1]);
  assert.deepEqual(tables, ["jr_jobs", "jr_ats_watchlist"]);
  for (const table of tables) {
    const creation = sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${table}`);
    const rls = sql.indexOf(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    const revoke = sql.indexOf(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM PUBLIC, anon, authenticated;`);
    assert.ok(rls > creation, `${table} enables RLS`);
    assert.ok(revoke > rls, `${table} revokes public and client roles`);
  }
  assert.doesNotMatch(careerFoundationMigration, /DROP\s+TABLE\s+public\.(jr_jobs|jr_ats_watchlist)/i);
});
