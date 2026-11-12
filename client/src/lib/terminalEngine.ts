import type { TerminalService } from "@/content/terminal";

export const TERMINAL_TIMING = {
  typingMsPerCharacter: 32,
  typingJitter: 0.4,
  outputLineMs: 220,
  spinnerMs: 900,
  servicePanelMs: 3000,
  commandPauseMs: 450,
  chapterOutroMs: 1200,
  identityDwellMs: 4500,
  scanlineMs: 8000,
} as const;

export type TerminalChapter = "identity" | "pentesting" | "web" | "skills";

export type TerminalStep =
  | { type: "clear" }
  | { type: "type"; text: string }
  | { type: "spinner"; text: string }
  | { type: "print"; lines: readonly string[] }
  | { type: "panel"; service: TerminalService }
  | { type: "wait"; ms: number }
  | { type: "outro"; text: string };

export type TerminalStaticRow = {
  id: string;
  type: "command" | "output" | "spinner" | "panel" | "outro";
  text?: string;
  lines?: readonly string[];
  service?: TerminalService;
};

export const TERMINAL_CHAPTERS: readonly TerminalChapter[] = [
  "identity",
  "pentesting",
  "web",
  "skills",
];

export function nextTerminalChapter(chapter: TerminalChapter): TerminalChapter {
  const index = TERMINAL_CHAPTERS.indexOf(chapter);
  return TERMINAL_CHAPTERS[(index + 1) % TERMINAL_CHAPTERS.length];
}

export function previousTerminalChapter(chapter: TerminalChapter): TerminalChapter {
  const index = TERMINAL_CHAPTERS.indexOf(chapter);
  return TERMINAL_CHAPTERS[(index - 1 + TERMINAL_CHAPTERS.length) % TERMINAL_CHAPTERS.length];
}

export function chapterLabel(chapter: TerminalChapter): string {
  if (chapter === "identity") return "Identity";
  if (chapter === "pentesting") return "Pentesting";
  if (chapter === "web") return "Web";
  return "Skills";
}

export function buildChapterScript(
  chapter: TerminalChapter,
  services: readonly TerminalService[],
  skills: readonly string[],
  identityLines: readonly string[],
  startServiceIndex = 0,
): readonly TerminalStep[] {
  if (chapter === "identity") {
    return [
      { type: "clear" },
      { type: "type", text: "whoami" },
      { type: "print", lines: identityLines.slice(0, 4) },
      { type: "wait", ms: TERMINAL_TIMING.identityDwellMs },
      { type: "outro", text: "session ready" },
    ];
  }

  if (chapter === "skills") {
    return [
      { type: "clear" },
      { type: "type", text: "stack --list" },
      { type: "spinner", text: "loading skills" },
      {
        type: "print",
        lines: skills.slice(0, 9).map((skill) => "• " + skill),
      },
      { type: "outro", text: "session complete" },
    ];
  }

  const chapterServices = services.filter((service) => service.area === chapter);
  const normalizedStart = chapterServices.length
    ? ((startServiceIndex % chapterServices.length) + chapterServices.length) % chapterServices.length
    : 0;
  const orderedServices = chapterServices.length
    ? [...chapterServices.slice(normalizedStart), ...chapterServices.slice(0, normalizedStart)]
    : [];
  const steps: TerminalStep[] = [{ type: "clear" }];

  orderedServices.forEach((service) => {
    steps.push(
      { type: "type", text: service.command },
      { type: "spinner", text: "checking scope" },
      { type: "print", lines: service.output },
      { type: "print", lines: ["# authorised targets only"] },
      { type: "panel", service },
      { type: "wait", ms: TERMINAL_TIMING.servicePanelMs },
      { type: "wait", ms: TERMINAL_TIMING.commandPauseMs },
    );
  });

  steps.push({ type: "outro", text: "chapter complete" });
  return steps;
}

/** Complete, non-animated transcript for reduced-motion mode and test tooling. */
export function buildStaticTranscript(
  script: readonly TerminalStep[],
): readonly TerminalStaticRow[] {
  const rows: TerminalStaticRow[] = [];
  let id = 0;
  for (const step of script) {
    id += 1;
    if (step.type === "clear" || step.type === "wait") continue;
    if (step.type === "type") {
      rows.push({ id: String(id), type: "command", text: step.text });
    } else if (step.type === "spinner") {
      rows.push({ id: String(id), type: "output", text: "✓ " + step.text });
    } else if (step.type === "print") {
      rows.push({ id: String(id), type: "output", lines: step.lines });
    } else if (step.type === "panel") {
      rows.push({ id: String(id), type: "panel", service: step.service });
    } else {
      rows.push({ id: String(id), type: "outro", text: step.text });
    }
  }
  return rows;
}

export function clampTerminalRows<T>(rows: readonly T[], maxRows = 14): readonly T[] {
  return rows.length <= maxRows ? rows : rows.slice(rows.length - maxRows);
}

export function typingDuration(text: string, jitterFactor: number): number {
  const boundedJitter = Math.max(
    1 - TERMINAL_TIMING.typingJitter,
    Math.min(1 + TERMINAL_TIMING.typingJitter, jitterFactor),
  );
  return Math.max(1, text.length * TERMINAL_TIMING.typingMsPerCharacter * boundedJitter);
}

export function scaleTerminalDelay(milliseconds: number, multiplier: number): number {
  const speed = Number.isFinite(multiplier) ? Math.max(1, Math.min(multiplier, 8)) : 1;
  return Math.max(8, Math.round(milliseconds / speed));
}

// # authorised targets only
