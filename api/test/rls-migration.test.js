import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../migrations/003_enable_rls.sql", import.meta.url), "utf8");
const baseMigration = readFileSync(new URL("../scripts/migrate.js", import.meta.url), "utf8");
const featuresMigration = readFileSync(new URL("../migrations/002_features.sql", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
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
  assert.match(appSource, /tableName:\s*"admin_sessions",\s*createTableIfMissing:\s*false/);
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
