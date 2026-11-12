import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDirectory = path.resolve(scriptDirectory, "..");
const repoDirectory = path.resolve(clientDirectory, "..");
const terminalPath = path.join(clientDirectory, "src/content/terminal.ts");
const enginePath = path.join(clientDirectory, "src/lib/terminalEngine.ts");
const sessionPath = path.join(clientDirectory, "src/components/LiveTerminalSession.tsx");
const heroPath = path.join(clientDirectory, "src/components/HomeHero.tsx");
const profilePath = path.join(clientDirectory, "src/data/profile.ts");
const cssPath = path.join(clientDirectory, "src/app/globals.css");
const marqueePath = path.join(clientDirectory, "src/components/ServicesSkillsMarquee.tsx");
const errors = [];

function fail(message) {
  errors.push(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    fail("Missing required file: " + path.relative(repoDirectory, file));
    return "";
  }
}

const terminalSource = read(terminalPath);
const engineSource = read(enginePath);
const sessionSource = read(sessionPath);
const heroSource = read(heroPath);
const profileSource = read(profilePath);
const cssSource = read(cssPath);
const marqueeSource = read(marqueePath);

const sectionStart = terminalSource.indexOf("export const TERMINAL_SERVICES = [");
const sectionEnd = terminalSource.indexOf("] as const satisfies readonly TerminalService[]", sectionStart);
assert(sectionStart >= 0 && sectionEnd > sectionStart, "Could not locate the typed TERMINAL_SERVICES catalogue.");

const serviceSection = sectionStart >= 0 && sectionEnd > sectionStart
  ? terminalSource.slice(sectionStart, sectionEnd)
  : "";
const serviceChunks = serviceSection
  .split(/(?=^    id:\s*")/m)
  .slice(1)
  .map((chunk) => {
    const close = chunk.indexOf("\n  },");
    return close >= 0 ? chunk.slice(0, close) : chunk;
  });

assert(serviceChunks.length >= 2, "The terminal service catalogue must contain multiple services.");

function capture(block, expression) {
  const match = block.match(expression);
  return match?.[1];
}

function parseQuotedArray(block) {
  const match = block.match(/output:\s*\[([\s\S]*?)\]/);
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]*)"/g)].map((item) => item[1]);
}

const services = serviceChunks.map((block, index) => {
  const service = {
    id: capture(block, /id:\s*"([^"]+)"/),
    area: capture(block, /area:\s*"(pentesting|web)"/),
    command: (() => {
      const match = block.match(/command:\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')/);
      return match?.[1] ?? match?.[2];
    })(),
    output: parseQuotedArray(block),
    title: capture(block, /title:\s*"([^"]*)"/),
    summary: capture(block, /summary:\s*"([^"]*)"/),
    proofs: [...block.matchAll(/href:\s*"([^"]*)"/g)].map((match) => match[1]),
    labels: [...block.matchAll(/label:\s*"([^"]*)"/g)].map((match) => match[1]),
  };
  assert(Boolean(service.id), "Service " + (index + 1) + " is missing id.");
  assert(Boolean(service.title?.trim()), "Service " + (index + 1) + " is missing title.");
  assert(Boolean(service.summary?.trim()), "Service " + (index + 1) + " is missing summary.");
  assert(Boolean(service.command?.trim()), "Service " + (index + 1) + " is missing command.");
  assert(service.area === "pentesting" || service.area === "web", "Service " + service.id + " has invalid area.");
  assert(Array.isArray(service.output) && service.output.length >= 2 && service.output.length <= 4,
    "Service " + service.id + " must have 2–4 simulated output lines.");
  assert((service.command?.length ?? 0) <= 88, "Command exceeds 88 characters: " + service.id);
  assert((service.summary?.length ?? 0) <= 140, "Summary exceeds 140 characters: " + service.id);
  for (const line of service.output ?? []) {
    assert(line.length <= 56, "Output line exceeds 56 characters for " + service.id + ": " + line);
  }
  const safeText = [
    service.id, service.area, service.command, service.title, service.summary,
    ...(service.output ?? []), ...service.labels, ...service.proofs,
  ].join("\n");
  assert(!/\b(?:password|passwd|token|secret|exploit|payload|reverse\s+shell)\b|flag\{/i.test(safeText),
    "Unsafe word/pattern found in service fields: " + service.id);

  const targetText = [service.command, ...(service.output ?? [])].join(" ");
  const targets = targetText.match(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b|\b\d{1,3}(?:\.\d{1,3}){3}\b/gi) ?? [];
  for (const target of targets) {
    const host = target.toLowerCase();
    // These are technology names in output text, not target hostnames.
    if (host === "node.js" || host === "next.js") continue;
    const isAllowedHost = host === "lab.example.test"
      || host === "example.com"
      || (host.endsWith(".example.test") && host !== "example.test");
    const isAllowedDocumentationIp = /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/.test(host);
    const isLocalLoopback = host === "127.0.0.1";
    assert(isAllowedHost || isAllowedDocumentationIp || isLocalLoopback,
      "Disallowed target hostname/address in " + service.id + ": " + target);
  }

  for (const href of service.proofs) {
    assert(href.startsWith("https://"), "Proof link must use HTTPS: " + href);
    try {
      const parsed = new URL(href);
      assert(parsed.protocol === "https:", "Proof link must use HTTPS: " + href);
      assert(Boolean(parsed.hostname), "Proof link must have a hostname: " + href);
    } catch {
      fail("Invalid proof URL for " + service.id + ": " + href);
    }
  }
  return service;
});

const duplicateIds = services.map((service) => service.id)
  .filter((id, index, all) => all.indexOf(id) !== index);
assert(duplicateIds.length === 0, "Duplicate service id(s): " + [...new Set(duplicateIds)].join(", "));
for (const area of ["pentesting", "web"]) {
  const count = services.filter((service) => service.area === area).length;
  assert(count > 0 && count <= 10, area + " service count must be between 1 and 10; got " + count + ".");
}

assert(terminalSource.includes("// # authorised targets only"), "Content source must include the authorised-targets footer comment.");
assert(engineSource.includes("// # authorised targets only"), "Terminal engine must include the authorised-targets footer comment.");
assert(engineSource.includes('text: "whoami"'), "Identity chapter must begin with whoami.");
assert(engineSource.includes('text: "stack --list"'), "Skills chapter must use stack --list.");
assert(engineSource.includes('"session complete"'), "Terminal loop must print session complete.");
assert(/TERMINAL_CHAPTERS[\s\S]*?"identity"[\s\S]*?"pentesting"[\s\S]*?"web"[\s\S]*?"skills"/.test(engineSource), "Chapter order must be Identity → Pentesting → Web → Skills.");
assert(engineSource.includes("clampTerminalRows") && engineSource.includes("maxRows = 14"),
  "Terminal row retention must be capped at 14 DOM rows.");
assert(engineSource.includes("typingMsPerCharacter: 32"), "Typing timing must remain 32 ms/character.");
assert(engineSource.includes("typingJitter: 0.4"), "Typing jitter must remain ±40%.");
assert(engineSource.includes("outputLineMs: 220"), "Output line timing must remain 220 ms.");
assert(engineSource.includes("spinnerMs: 900"), "Spinner duration must remain 900 ms.");
assert(engineSource.includes("servicePanelMs: 3000"), "Service dwell must remain 3000 ms.");
assert(engineSource.includes("commandPauseMs: 450"), "Command pause must remain 450 ms.");
assert(engineSource.includes("chapterOutroMs: 1200"), "Chapter outro must remain 1200 ms.");

assert(sessionSource.includes("window.cancelAnimationFrame(animationFrameRef.current)"),
  "Terminal scheduler must cancel its animation frame on cleanup.");
assert(sessionSource.includes("performance.now() - deadlineRef.current") || sessionSource.includes("deadlineRef.current - performance.now()"),
  "Pause/resume must retain remaining step time.");
assert(!/window\.set(?:Timeout|Interval)\s*\(/.test(sessionSource),
  "The live session should use one requestAnimationFrame scheduler, not extra timeout/interval loops.");
assert(!/\bfetch\s*\(|\beval\s*\(|new Function\s*\(/.test(sessionSource),
  "The hero terminal must not make network requests or evaluate commands.");
assert(/const visibleRows = reducedMotion\s*\?\s*completedTranscript/.test(sessionSource),
  "Reduced-motion mode must show the complete static transcript.");
assert(sessionSource.includes('rel="noopener noreferrer"') && sessionSource.includes('target="_blank"'),
  "Proof links must open safely in a new tab.");
assert(sessionSource.includes('aria-hidden="true"'),
  "Animated command/output rows must be decorative to assistive technology.");
assert(sessionSource.includes('process.env.NODE_ENV === "production"')
  && sessionSource.includes('new URLSearchParams(window.location.search).get("tspeed"'),
  "The ?tspeed development multiplier must be ignored in production.");

assert(heroSource.includes('role="group"') && heroSource.includes('aria-live="off"'),
  "Hero terminal must provide a labelled group with aria-live off.");
assert(heroSource.includes("new IntersectionObserver"),
  "The active face must be tied to viewport visibility.");
assert(heroSource.includes('document.addEventListener("visibilitychange"'),
  "The session must handle hidden-tab pause/resume.");
assert(heroSource.includes('aria-label="Previous service"') && heroSource.includes('aria-label="Next service"'),
  "Accessible Previous/Next service controls must be present.");
assert(!heroSource.includes("setPointerPaused") && !heroSource.includes("setFocusPaused"),
  "The live terminal must continue while visitors hover or focus the hero card.");
assert(heroSource.includes('onClick={() => selectScene(chapter)}')
  && heroSource.includes("onKeyDown={(event) => handleTabKeyDown(event, index)}")
  && heroSource.includes('setPreference(nextPreference)'),
  "Chapter tabs and the shared Pause/Play control must remain wired.");
assert(heroSource.includes("active={visibleFace === face && isIntersecting && documentVisible}"),
  "Only the visible, in-viewport face may run a session.");
assert(heroSource.includes('className={"visual-face visual-face-" + face}')
  && !heroSource.includes('className="visual-face visual-face-back" style={{ position: "absolute"'),
  "The two faces must be siblings, not nested/mirrored text containers.");
assert(heroSource.includes('setIsSpinning(true)') && heroSource.includes("HERO_TIMING.SWIRL_MS"),
  "The existing 3D swirl must remain between chapters.");
assert(profileSource.includes('import { PORTFOLIO_SERVICES } from "@/content/terminal"')
  && profileSource.includes("services: PORTFOLIO_SERVICES"),
  "The Services page must share the terminal services source.");
assert(cssSource.includes('html[data-theme="light"] .live-terminal[data-chapter="web"]')
  && cssSource.includes('html[data-theme="light"] .live-terminal[data-chapter="skills"]'),
  "Light-theme web and skills accents must be explicit.");
assert(cssSource.includes("@media (max-width: 600px)")
  && cssSource.includes("@media (prefers-reduced-motion: reduce)"),
  "Terminal styles must cover mobile and reduced-motion preferences.");
assert(cssSource.includes(".visual-perspective { position: relative; width: min(100%, 460px); height: 430px; perspective: 1200px; }")
  && cssSource.includes(".visual-face-front { transform: rotateY(0deg); }")
  && cssSource.includes(".visual-face-back { transform: rotateY(180deg); }")
  && cssSource.includes("backface-visibility: hidden;"),
  "The existing fixed-height, two-face 3D stage must remain intact.");
assert(cssSource.includes("font-size: 11.5px;") && cssSource.includes("height: 430px;"),
  "Terminal text sizing and fixed stage height must remain defined.");

// Verify the homepage services/skills ticker as a first-class production feature.
assert(heroSource.includes('import ServicesSkillsMarquee from "@/components/ServicesSkillsMarquee";')
  && heroSource.includes("<ServicesSkillsMarquee />"),
  "The homepage must render the services and skills marquee.");
assert(marqueeSource.includes("profile.services.map")
  && marqueeSource.includes("skillGroups.flatMap"),
  "The marquee must use the published services and complete skill groups as its source.");
assert(marqueeSource.includes("all.findIndex")
  && marqueeSource.includes('aria-hidden={duplicate || undefined}'),
  "The marquee must de-duplicate labels and hide its repeated visual copy from assistive technology.");
assert(cssSource.includes("animation: capability-marquee-right 54s linear infinite")
  && cssSource.includes("@keyframes capability-marquee-right")
  && cssSource.includes("from { transform: translateX(-50%); }")
  && cssSource.includes("to { transform: translateX(0); }"),
  "The marquee must run a seamless continuous left-to-right loop.");
assert(cssSource.includes("@media (prefers-reduced-motion: reduce)")
  && cssSource.includes(".capability-marquee-track { animation: none;"),
  "The marquee must respect reduced-motion preferences.");

const buildMarker = path.join(clientDirectory, ".next", "BUILD_ID");
assert(fs.existsSync(buildMarker), "Run the production build before verify:terminal; client/.next/BUILD_ID is missing.");

const engineTest = spawnSync(
  process.execPath,
  ["--experimental-strip-types", path.join(scriptDirectory, "test-terminal-engine.mjs")],
  { cwd: clientDirectory, encoding: "utf8", timeout: 30000 },
);
if (engineTest.error) {
  fail("Terminal engine test could not start: " + engineTest.error.message);
} else if (engineTest.status !== 0) {
  fail("Terminal engine tests failed:\n" + (engineTest.stdout ?? "") + (engineTest.stderr ?? ""));
} else if (engineTest.stdout.trim()) {
  console.log(engineTest.stdout.trim());
}

if (errors.length) {
  console.error("Terminal verification failed:");
  for (const error of errors) console.error(" - " + error);
  process.exitCode = 1;
} else {
  console.log("Terminal verification passed.");
  console.log("Services checked: " + services.length + " (" + services.filter((service) => service.area === "pentesting").length + " pentesting, " + services.filter((service) => service.area === "web").length + " web).");
  console.log("Homepage marquee checked: published services + skill groups, de-duplication, loop direction, and reduced-motion fallback.");
  console.log("Safety constraints: command/output lengths, target allowlist, banned strings and HTTPS proofs.");
  console.log("Structure checks: timing, chapter loop, static transcript, 14-row cap, shared service source, cleanup and controls.");
  console.log("Production build marker: present.");
  console.log("Note: this source verifier does not replace interactive browser/viewport testing.");
}
