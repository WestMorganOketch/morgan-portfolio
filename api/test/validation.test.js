import assert from "node:assert/strict";
import test from "node:test";
import { analyticsSchema, contentSchema, parseInput, projectSchema, uuidSchema } from "../src/validation.js";

const validProject = {
  title: "Safe project",
  period: "2026",
  description: "A project summary.",
  tags: ["Research"],
  writeup: "",
  challenges: "",
  solutions: "",
  architecture: "",
  futureImprovements: "",
  url: "",
  demoUrl: "",
  published: false,
};

test("project validation normalizes an empty link and keeps drafts unpublished", () => {
  const result = parseInput(projectSchema, validProject);
  assert.equal(result.data.url, null);
  assert.equal(result.data.published, false);
});

test("project validation rejects unsafe protocols and oversized write-ups", () => {
  assert.ok(parseInput(projectSchema, { ...validProject, url: "javascript:alert(1)" }).error);
  assert.ok(parseInput(projectSchema, { ...validProject, demoUrl: "javascript:alert(1)" }).error);
  assert.ok(parseInput(projectSchema, { ...validProject, writeup: "x".repeat(12001) }).error);
});

test("portfolio content validation keeps drafts private and only accepts known categories", () => {
  const entry = {
    category: "writeups",
    title: "Defensive analysis notes",
    period: "2026",
    description: "A plain-text, authorized learning summary.",
    body: "",
    tags: ["defensive security"],
    url: "",
    published: false,
  };
  const parsed = parseInput(contentSchema, entry);
  assert.equal(parsed.data.url, null);
  assert.equal(parsed.data.published, false);
  assert.ok(parseInput(contentSchema, { ...entry, category: "admin" }).error);
  assert.ok(parseInput(contentSchema, { ...entry, url: "javascript:alert(1)" }).error);
});

test("analytics accepts only known aggregate events and page names", () => {
  assert.equal(parseInput(analyticsSchema, { event: "page_view", page: "home" }).data.event, "page_view");
  assert.equal(parseInput(analyticsSchema, { event: "page_view", page: "cheatsheets" }).data.page, "cheatsheets");
  assert.equal(parseInput(analyticsSchema, { event: "page_view", page: "ctfs" }).data.page, "ctfs");
  assert.ok(parseInput(analyticsSchema, { event: "page_view", page: "/?email=private" }).error);
  assert.ok(parseInput(analyticsSchema, { event: "identify_visitor", page: "home" }).error);
});

test("resource identifiers accept only UUID values", () => {
  assert.equal(parseInput(uuidSchema, "00000000-0000-4000-8000-000000000001").data, "00000000-0000-4000-8000-000000000001");
  assert.ok(parseInput(uuidSchema, "not-a-uuid").error);
});
