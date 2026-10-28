import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const alerts = JSON.parse(readFileSync(new URL("../data/alerts.json", import.meta.url), "utf8"));

test("the seeded alert set contains exactly 20 balanced, anonymized scenarios", () => {
  assert.equal(alerts.length, 20);
  assert.equal(alerts.filter((alert) => alert.verdict === "true_positive").length, 10);
  assert.equal(alerts.filter((alert) => alert.verdict === "false_positive").length, 10);
  assert.equal(new Set(alerts.map((alert) => alert.id)).size, 20);
  const text = JSON.stringify(alerts);
  assert.equal(/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(text), false);
  assert.equal(/\bCS-SA11-[A-Z0-9-]+\b/i.test(text), false);
  assert.equal(/\b[A-Z0-9_]{2,}\{[^}\r\n]*\}/i.test(text), false);
  assert.equal(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/i.test(text), false);
});
