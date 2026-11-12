import assert from "node:assert/strict";
import {
  buildChapterScript,
  buildStaticTranscript,
  clampTerminalRows,
  nextTerminalChapter,
  previousTerminalChapter,
  scaleTerminalDelay,
  TERMINAL_CHAPTERS,
  TERMINAL_TIMING,
  typingDuration,
} from "../src/lib/terminalEngine.ts";
import { TERMINAL_AREAS, TERMINAL_SERVICES } from "../src/content/terminal.ts";

const expectedChapters = ["identity", "pentesting", "web", "skills"];
const skills = [
  "Threat analysis",
  "SIEM fundamentals",
  "Incident response",
  "Vulnerability assessment",
  "Security hardening",
  "Digital forensics",
  "TCP/IP",
  "DNS & DHCP",
  "VPNs & firewalls",
];
const identityLines = [
  "Morgan West Oketch",
  "ALERT REVIEW · In progress",
  "APPROACH · Evidence-led",
  "FOCUS · Defensive security",
];

assert.deepEqual([...TERMINAL_CHAPTERS], expectedChapters, "Chapter order must be Identity → Pentesting → Web → Skills.");

let chapter = "identity";
const twoLoops = [];
for (let index = 0; index < expectedChapters.length * 2; index += 1) {
  twoLoops.push(chapter);
  chapter = nextTerminalChapter(chapter);
}
assert.deepEqual(twoLoops, [...expectedChapters, ...expectedChapters], "The chapter cycle must complete twice.");
assert.equal(chapter, "identity", "Two complete cycles must restart at Identity.");
assert.equal(previousTerminalChapter("identity"), "skills");
assert.equal(nextTerminalChapter("skills"), "identity");

assert.equal(TERMINAL_TIMING.typingMsPerCharacter, 32);
assert.equal(TERMINAL_TIMING.typingJitter, 0.4);
assert.equal(TERMINAL_TIMING.outputLineMs, 220);
assert.equal(TERMINAL_TIMING.spinnerMs, 900);
assert.equal(TERMINAL_TIMING.servicePanelMs, 3000);
assert.equal(TERMINAL_TIMING.commandPauseMs, 450);
assert.equal(TERMINAL_TIMING.chapterOutroMs, 1200);
assert.ok(typingDuration("x", 0.6) >= 19.1 && typingDuration("x", 0.6) <= 19.3);
assert.equal(scaleTerminalDelay(800, 8), 100);
assert.equal(scaleTerminalDelay(800, 1), 800);

const identity = buildChapterScript("identity", TERMINAL_SERVICES, skills, identityLines);
assert.equal(identity.find((step) => step.type === "type")?.text, "whoami");
assert.deepEqual(buildStaticTranscript(identity).filter((row) => row.type === "panel"), []);

for (const area of ["pentesting", "web"]) {
  const areaServices = TERMINAL_AREAS[area];
  assert.ok(areaServices.length > 0 && areaServices.length <= 6);
  const script = buildChapterScript(area, TERMINAL_SERVICES, skills, identityLines);
  const commands = script.filter((step) => step.type === "type").map((step) => step.text);
  assert.deepEqual(commands, areaServices.map((service) => service.command), area + " commands must follow the service catalogue.");
  const panels = buildStaticTranscript(script).filter((row) => row.type === "panel");
  assert.deepEqual(panels.map((row) => row.service?.id), areaServices.map((service) => service.id));
  assert.ok(buildStaticTranscript(script).length <= 14, area + " static transcript must fit the row cap.");
  assert.ok(script.some((step) => step.type === "print" && step.lines.includes("# authorised targets only")));
  assert.ok(script.some((step) => step.type === "wait" && step.ms === TERMINAL_TIMING.servicePanelMs));
  const rotated = buildChapterScript(area, TERMINAL_SERVICES, skills, identityLines, 1);
  const rotatedCommands = rotated.filter((step) => step.type === "type").map((step) => step.text);
  assert.deepEqual(rotatedCommands, [...commands.slice(1), ...commands.slice(0, 1)], "Previous/Next service offsets must rotate service order.");
}

const skillScript = buildChapterScript("skills", TERMINAL_SERVICES, skills, identityLines);
assert.equal(skillScript.find((step) => step.type === "type")?.text, "stack --list");
const skillTranscript = buildStaticTranscript(skillScript);
assert.ok(skillTranscript.some((row) => row.type === "output" && row.lines?.length === 9));
assert.equal(skillTranscript.at(-1)?.text, "session complete");

const rows = Array.from({ length: 100 }, (_, index) => index);
assert.equal(clampTerminalRows(rows, 14).length, 14, "DOM transcript retention must stay bounded.");
assert.deepEqual(clampTerminalRows(rows, 14), rows.slice(-14));

console.log("Terminal engine tests passed: two chapter loops, service ordering, complete static transcripts, timing, reduced-motion transcript source, and row cap.");
