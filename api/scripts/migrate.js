import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool } from "../src/db.js";

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS portfolio_projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      title text NOT NULL UNIQUE,
      period text NOT NULL,
      description text NOT NULL,
      tags text[] NOT NULL DEFAULT '{}',
      writeup text NOT NULL DEFAULT '',
      url text,
      published boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE portfolio_projects
      ADD COLUMN IF NOT EXISTS challenges text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS solutions text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS architecture text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS future_improvements text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS demo_url text;

    CREATE INDEX IF NOT EXISTS portfolio_projects_published_order_idx
      ON portfolio_projects (published, sort_order, created_at DESC);

    CREATE TABLE IF NOT EXISTS portfolio_analytics (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      event text NOT NULL CHECK (event IN ('page_view', 'github_click', 'linkedin_click', 'email_click')),
      page text NOT NULL CHECK (page IN (
        'home', 'about', 'skills', 'experience', 'projects', 'education',
        'certifications', 'timeline', 'achievements', 'blog', 'gallery',
        'services', 'writeups', 'inventions', 'cheatsheets', 'ctfs',
        'assignments', 'documents', 'triage', 'leaderboard', 'contact', 'privacy', 'work', 'credentials'
      )),
      created_at timestamptz NOT NULL DEFAULT now()
    );

    ALTER TABLE portfolio_analytics
      DROP CONSTRAINT IF EXISTS portfolio_analytics_page_check;

    ALTER TABLE portfolio_analytics
      ADD CONSTRAINT portfolio_analytics_page_check
      CHECK (page IN (
        'home', 'about', 'skills', 'experience', 'projects', 'education',
        'certifications', 'timeline', 'achievements', 'blog', 'gallery',
        'services', 'writeups', 'inventions', 'cheatsheets', 'ctfs',
        'assignments', 'documents', 'triage', 'leaderboard', 'contact', 'privacy', 'work', 'credentials'
      ));

    CREATE INDEX IF NOT EXISTS portfolio_analytics_created_at_idx
      ON portfolio_analytics (created_at DESC);

    CREATE TABLE IF NOT EXISTS portfolio_content (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      category text NOT NULL CHECK (category IN (
        'experience', 'education', 'certifications', 'achievements', 'blog',
        'gallery', 'services', 'writeups', 'inventions', 'cheatsheets', 'ctfs',
        'assignments', 'skills'
      )),
      title text NOT NULL,
      period text NOT NULL DEFAULT '',
      description text NOT NULL,
      body text NOT NULL DEFAULT '',
      tags text[] NOT NULL DEFAULT '{}',
      url text,
      published boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS portfolio_content_public_order_idx
      ON portfolio_content (category, published, sort_order, created_at DESC);

    INSERT INTO portfolio_projects (title, period, description, tags, published, sort_order)
    VALUES
      ('Secure VPN Deployment', 'Dec 2024',
       'Designed and deployed a VPN solution for secure remote access at a local organization, helping reduce exposure to unauthorized access.',
       ARRAY['VPN', 'Network security', 'Remote access'], true, 1),
      ('Secure Web Application Development', 'Apr 2025',
       'Developed web applications with authentication flows, JWT handling, and REST API security hardening using React and Node.js.',
       ARRAY['React', 'Node.js', 'JWT', 'REST APIs'], true, 2)
    ON CONFLICT DO NOTHING;
  `);
  await pool.query(readFileSync(new URL("../migrations/002_features.sql", import.meta.url), "utf8"));

  const alerts = JSON.parse(readFileSync(new URL("../data/alerts.json", import.meta.url), "utf8"));
  const alertValues = alerts.flatMap((alert) => [
    alert.id, alert.title, alert.source, alert.severity, alert.difficulty, alert.details,
    alert.verdict, alert.explanation, alert.mitre,
  ]);
  const alertRows = alerts.map((_, index) => {
    const first = index * 9 + 1;
    return `(${Array.from({ length: 9 }, (_value, offset) => `$${first + offset}`).join(", ")})`;
  }).join(", ");
  await pool.query(
    `INSERT INTO soc_alerts
      (id, title, source, severity, difficulty, details, verdict, explanation, mitre)
     VALUES ${alertRows}
     ON CONFLICT (id) DO NOTHING`,
    alertValues,
  );

  const documents = [
    ["Morgan West Oketch Resume", "Resume", "Professional resume; replace the current public PDF with a sanitized upload before publishing.", null],
    ["ALX Certificate 1", "Certificates", "", "https://savanna.alxafrica.com/certificates/p2JeFHfMCY"],
    ["ALX Certificate 2", "Certificates", "", "https://savanna.alxafrica.com/certificates/Hhnf27FYLs"],
  ];
  for (const [title, category, description, verifyUrl] of documents) {
    await pool.query(
      `INSERT INTO documents (title, category, description, verify_url, is_published)
       VALUES ($1, $2, $3, $4, false)
       ON CONFLICT (category, title) DO NOTHING`,
      [title, category, description, verifyUrl],
    );
  }
  console.info("Portfolio database tables are ready.");
} catch (error) {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
