"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildChapterScript,
  buildStaticTranscript,
  clampTerminalRows,
  scaleTerminalDelay,
  TERMINAL_TIMING,
  typingDuration,
  type TerminalChapter,
  type TerminalStaticRow,
} from "@/lib/terminalEngine";
import { TERMINAL_AREAS, TERMINAL_SERVICES, type TerminalService } from "@/content/terminal";

type TerminalRow = TerminalStaticRow;
type ScheduledAction = "type-character" | "spinner-finished" | "print-line" | "advance" | "finish";

type LiveTerminalSessionProps = {
  chapter: TerminalChapter;
  active: boolean;
  paused: boolean;
  reducedMotion: boolean;
  manualPreview: boolean;
  serviceOffset: number;
  servicePositions: Readonly<{ pentesting: number; web: number }>;
  skills: readonly string[];
  identityLines: readonly string[];
  onServiceSeen: (area: "pentesting" | "web", index: number) => void;
  onPreviewConsumed: () => void;
  onComplete: () => void;
};

function TerminalCommand({ text }: { text: string }) {
  const parts = text.split(/\s+/);
  const command = parts.shift() ?? "";
  return (
    <>
      <span className="terminal-prompt">morgan@portfolio:~$</span>{" "}
      <span className="terminal-command-main">{command}</span>
      {parts.length > 0 && <span className="terminal-command-arguments">{" " + parts.join(" ")}</span>}
    </>
  );
}

function ServicePanel({
  service,
  current,
}: {
  service: TerminalService;
  current: boolean;
}) {
  return (
    <article className={"terminal-service-panel" + (current ? " is-current" : " is-previous")}>
      <strong className="terminal-service-title">{service.title}</strong>
      <p className="terminal-service-summary">{service.summary}</p>
      <div className="terminal-service-meta">
        <span className="terminal-service-chip">{service.area === "pentesting" ? "pentest" : "web"}</span>
        {service.proof?.map((proof) => (
          <a
            className="terminal-proof-link"
            key={proof.href}
            href={proof.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            ↗ {proof.label}
          </a>
        ))}
      </div>
    </article>
  );
}

function TerminalRowView({
  row,
  older,
  currentPanel,
  paused,
  spinnerActive,
}: {
  row: TerminalRow;
  older: boolean;
  currentPanel: boolean;
  paused: boolean;
  spinnerActive: boolean;
}) {
  const rowClass = [
    "terminal-row",
    "terminal-row-" + row.type,
    older ? "is-older" : "",
    paused ? "is-paused" : "",
  ].filter(Boolean).join(" ");

  if (row.type === "panel" && row.service) {
    return (
      <div className={rowClass} key={row.id}>
        <ServicePanel service={row.service} current={currentPanel} />
      </div>
    );
  }

  if (row.type === "command") {
    return (
      <div className={rowClass} aria-hidden="true" key={row.id}>
        <TerminalCommand text={row.text ?? ""} />
        {!paused && <span className="live-terminal-caret" />}
      </div>
    );
  }

  if (row.type === "spinner") {
    return (
      <div className={rowClass} aria-hidden="true" key={row.id}>
        <span className="terminal-spinner-glyph" aria-hidden="true">
          {spinnerActive ? <span className="terminal-braille-strip">⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏</span> : "✓"}
        </span>
        <span>{row.text}</span>
      </div>
    );
  }

  if (row.type === "output" && row.lines) {
    return (
      <div className={rowClass} aria-hidden="true" key={row.id}>
        {row.lines.map((line, index) => (
          <div className="terminal-output-line" key={row.id + "-" + index}>{line}</div>
        ))}
      </div>
    );
  }

  const text = row.text ?? "";
  const comment = text.startsWith("#");
  const success = text.startsWith("✓");
  return (
    <div className={rowClass + (comment ? " is-comment" : "")} aria-hidden="true" key={row.id}>
      {success ? <span className="terminal-success">{text}</span> : text}
    </div>
  );
}

function staticPreview(service: TerminalService | undefined): readonly TerminalRow[] {
  if (!service) return [];
  return [
    { id: "preview-command", type: "command", text: service.command },
    { id: "preview-scope", type: "output", lines: ["✓ checking scope"] },
    { id: "preview-output", type: "output", lines: [...service.output, "# authorised targets only"] },
    { id: "preview-panel", type: "panel", service },
    { id: "preview-paused", type: "outro", text: "paused · service selected" },
  ];
}

export default function LiveTerminalSession({
  chapter,
  active,
  paused,
  reducedMotion,
  manualPreview,
  serviceOffset,
  servicePositions,
  skills,
  identityLines,
  onServiceSeen,
  onPreviewConsumed,
  onComplete,
}: LiveTerminalSessionProps) {
  const script = useMemo(
    () => buildChapterScript(chapter, TERMINAL_SERVICES, skills, identityLines, serviceOffset),
    [chapter, identityLines, serviceOffset, skills],
  );
  const completedTranscript = useMemo(() => buildStaticTranscript(script), [script]);
  const chapterServices = chapter === "pentesting" || chapter === "web"
    ? TERMINAL_AREAS[chapter]
    : [];
  const previewService = chapterServices[serviceOffset % Math.max(1, chapterServices.length)];
  const pausedPreview = useMemo(() => staticPreview(previewService), [previewService]);

  const [rows, setRows] = useState<readonly TerminalRow[]>([]);
  const [activePanelRowId, setActivePanelRowId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [isSpinnerActive, setIsSpinnerActive] = useState(false);
  const rowsRef = useRef<readonly TerminalRow[]>([]);
  const nextRowIdRef = useRef(0);
  const stepIndexRef = useRef(0);
  const printLinesRef = useRef<readonly string[]>([]);
  const printLineIndexRef = useRef(0);
  const commandRowIdRef = useRef<string | null>(null);
  const commandTextRef = useRef("");
  const targetCommandRef = useRef("");
  const typeCharacterIndexRef = useRef(0);
  const spinnerRowIdRef = useRef<string | null>(null);
  const activePanelRowIdRef = useRef<string | null>(null);
  const pendingActionRef = useRef<ScheduledAction | null>(null);
  const deadlineRef = useRef(0);
  const remainingDelayRef = useRef(0);
  const animationFrameRef = useRef(0);
  const speedMultiplierRef = useRef(1);
  const finishedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  const onServiceSeenRef = useRef(onServiceSeen);
  const onPreviewConsumedRef = useRef(onPreviewConsumed);

  onCompleteRef.current = onComplete;
  onServiceSeenRef.current = onServiceSeen;
  onPreviewConsumedRef.current = onPreviewConsumed;

  const visibleRows = reducedMotion
    ? completedTranscript
    : manualPreview && paused
      ? pausedPreview
      : rows;

  const currentService = [...visibleRows].reverse().find((row) => row.type === "panel")?.service;
  const currentServiceIndex = currentService && (currentService.area === "pentesting" || currentService.area === "web")
    ? TERMINAL_AREAS[currentService.area].findIndex((service) => service.id === currentService.id) + 1
    : 0;
  const statusArea = chapter === "pentesting" || chapter === "web" ? chapter : null;
  const currentPosition = statusArea
    ? (currentServiceIndex || servicePositions[statusArea] + 1)
    : 0;
  const statusText = paused
    ? "paused"
    : reducedMotion
      ? "static"
      : "live";
  const statusDetail = statusArea
    ? `${statusArea} ${currentPosition}/${TERMINAL_AREAS[statusArea].length}`
    : chapter;

  useEffect(() => {
    // Every chapter or explicit service jump starts a fresh transcript. No scheduler
    // is created by this reset effect; hidden faces stay idle.
    rowsRef.current = [];
    setRows([]);
    stepIndexRef.current = 0;
    printLinesRef.current = [];
    printLineIndexRef.current = 0;
    commandRowIdRef.current = null;
    commandTextRef.current = "";
    targetCommandRef.current = "";
    typeCharacterIndexRef.current = 0;
    spinnerRowIdRef.current = null;
    activePanelRowIdRef.current = null;
    pendingActionRef.current = null;
    deadlineRef.current = 0;
    remainingDelayRef.current = 0;
    finishedRef.current = false;
    nextRowIdRef.current = 0;
    setActivePanelRowId(null);
    setIsTyping(false);
    setIsSpinnerActive(false);
  }, [chapter, script]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      speedMultiplierRef.current = 1;
      return;
    }
    try {
      const requested = Number(new URLSearchParams(window.location.search).get("tspeed") ?? "1");
      speedMultiplierRef.current = Number.isFinite(requested) && requested >= 1
        ? Math.min(8, requested)
        : 1;
    } catch {
      speedMultiplierRef.current = 1;
    }
  }, []);

  useEffect(() => {
    if (reducedMotion || !active || paused || manualPreview) return;
    let disposed = false;
    const speed = () => speedMultiplierRef.current;
    const appendRow = (row: Omit<TerminalRow, "id">): string => {
      const id = String(++nextRowIdRef.current);
      const next = clampTerminalRows([...rowsRef.current, { ...row, id }], 14);
      rowsRef.current = next;
      setRows(next);
      return id;
    };
    const updateRow = (id: string, change: (row: TerminalRow) => TerminalRow) => {
      const next = clampTerminalRows(
        rowsRef.current.map((row) => row.id === id ? change(row) : row),
        14,
      );
      rowsRef.current = next;
      setRows(next);
    };
    const schedule = (action: ScheduledAction, milliseconds: number) => {
      pendingActionRef.current = action;
      const requestedDelay = scaleTerminalDelay(milliseconds, speed());
      const delay = remainingDelayRef.current > 0
        ? remainingDelayRef.current
        : requestedDelay;
      remainingDelayRef.current = 0;
      deadlineRef.current = performance.now() + delay;
    };
    const nextCharacterDelay = () => scaleTerminalDelay(
      typingDuration("x", 0.6 + Math.random() * 0.8),
      speed(),
    );

    const processNextStep = () => {
      let immediateSteps = 0;
      while (!disposed && pendingActionRef.current === null && immediateSteps < script.length + 2) {
        immediateSteps += 1;
        const step = script[stepIndexRef.current];
        if (!step) {
          if (!finishedRef.current) {
            finishedRef.current = true;
            disposed = true;
            onCompleteRef.current();
          }
          return;
        }

        if (step.type === "clear") {
          rowsRef.current = [];
          setRows([]);
          activePanelRowIdRef.current = null;
          setActivePanelRowId(null);
          stepIndexRef.current += 1;
          continue;
        }

        if (step.type === "type") {
          targetCommandRef.current = step.text;
          commandTextRef.current = "";
          typeCharacterIndexRef.current = 0;
          activePanelRowIdRef.current = null;
          setActivePanelRowId(null);
          setIsTyping(true);
          commandRowIdRef.current = appendRow({ type: "command", text: "" });
          stepIndexRef.current += 1;
          schedule("type-character", nextCharacterDelay());
          return;
        }

        if (step.type === "spinner") {
          setIsSpinnerActive(true);
          spinnerRowIdRef.current = appendRow({ type: "spinner", text: step.text });
          stepIndexRef.current += 1;
          schedule("spinner-finished", TERMINAL_TIMING.spinnerMs);
          return;
        }

        if (step.type === "print") {
          printLinesRef.current = step.lines;
          printLineIndexRef.current = 0;
          stepIndexRef.current += 1;
          schedule("print-line", TERMINAL_TIMING.outputLineMs);
          return;
        }

        if (step.type === "panel") {
          const rowId = appendRow({ type: "panel", service: step.service });
          activePanelRowIdRef.current = rowId;
          setActivePanelRowId(rowId);
          const areaServices = TERMINAL_AREAS[step.service.area];
          const index = areaServices.findIndex((service) => service.id === step.service.id);
          onServiceSeenRef.current(step.service.area, Math.max(0, index));
          stepIndexRef.current += 1;
          continue;
        }

        if (step.type === "wait") {
          stepIndexRef.current += 1;
          schedule("advance", step.ms);
          return;
        }

        if (step.type === "outro") {
          appendRow({ type: "outro", text: step.text });
          stepIndexRef.current += 1;
          schedule("finish", TERMINAL_TIMING.chapterOutroMs);
          return;
        }
      }
    };

    const executeScheduledAction = () => {
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      deadlineRef.current = 0;
      remainingDelayRef.current = 0;
      if (action === null) return;

      if (action === "type-character") {
        typeCharacterIndexRef.current += 1;
        commandTextRef.current = targetCommandRef.current.slice(0, typeCharacterIndexRef.current);
        const rowId = commandRowIdRef.current;
        if (rowId) updateRow(rowId, (row) => ({ ...row, text: commandTextRef.current }));
        if (typeCharacterIndexRef.current < targetCommandRef.current.length) {
          schedule("type-character", nextCharacterDelay());
        } else {
          setIsTyping(false);
          commandRowIdRef.current = null;
          processNextStep();
        }
        return;
      }

      if (action === "spinner-finished") {
        const rowId = spinnerRowIdRef.current;
        if (rowId) updateRow(rowId, (row) => ({ type: "output", id: row.id, text: "✓ " + (row.text ?? "scope checked") }));
        spinnerRowIdRef.current = null;
        setIsSpinnerActive(false);
        processNextStep();
        return;
      }

      if (action === "print-line") {
        const lines = printLinesRef.current;
        const line = lines[printLineIndexRef.current];
        if (line !== undefined) {
          appendRow({ type: "output", text: line });
          printLineIndexRef.current += 1;
        }
        if (printLineIndexRef.current < lines.length) {
          schedule("print-line", TERMINAL_TIMING.outputLineMs);
        } else {
          printLinesRef.current = [];
          printLineIndexRef.current = 0;
          processNextStep();
        }
        return;
      }

      if (action === "advance") {
        processNextStep();
        return;
      }

      if (action === "finish") {
        if (!finishedRef.current) {
          finishedRef.current = true;
          disposed = true;
          onCompleteRef.current();
        }
      }
    };

    onCompleteRef.current = onCompleteRef.current;

    function tick(now: number) {
      if (disposed) return;
      if (pendingActionRef.current !== null && now >= deadlineRef.current) {
        executeScheduledAction();
      }
      if (!disposed) animationFrameRef.current = window.requestAnimationFrame(tick);
    }

    if (pendingActionRef.current !== null) {
      const remaining = remainingDelayRef.current;
      deadlineRef.current = performance.now() + remaining;
      remainingDelayRef.current = 0;
    } else {
      processNextStep();
    }
    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrameRef.current);
      if (pendingActionRef.current !== null) {
        remainingDelayRef.current = Math.max(0, deadlineRef.current - performance.now());
      }
    };
  }, [
    active,
    chapter,
    manualPreview,
    paused,
    reducedMotion,
    script,
    serviceOffset,
  ]);

  useEffect(() => {
    if (active && !paused && !reducedMotion && manualPreview) onPreviewConsumed();
  }, [active, manualPreview, onPreviewConsumed, paused, reducedMotion]);

  const lastVisibleService = currentService?.id ?? null;
  const chosenStaticIndex = statusArea ? servicePositions[statusArea] : -1;

  return (
    <div
      className={"live-terminal" + (paused || reducedMotion ? " is-paused" : "")}
      data-chapter={chapter}
      style={{ "--terminal-scanline-duration": TERMINAL_TIMING.scanlineMs + "ms" } as React.CSSProperties}
    >
      <div className="terminal-status-line">
        <span className="terminal-live-dot" aria-hidden="true">●</span>
        <span>{statusText}</span>
        <span aria-hidden="true">·</span>
        <span>{statusDetail}</span>
      </div>
      <div className="live-terminal-log" aria-label={chapterLabelForAria(chapter) + " terminal transcript"}>
        {visibleRows.map((row, index) => {
          const older = index < visibleRows.length - 5;
          const currentPanel = row.type === "panel" && (
            manualPreview || reducedMotion
              ? row.service?.id === (TERMINAL_AREAS.pentesting[chosenStaticIndex]?.id ?? lastVisibleService)
                || row.service?.id === lastVisibleService
              : row.id === activePanelRowId
          );
          return (
            <TerminalRowView
              row={row}
              key={row.id}
              older={older}
              currentPanel={Boolean(currentPanel)}
              paused={paused || reducedMotion}
              spinnerActive={isSpinnerActive && row.id === spinnerRowIdRef.current}
            />
          );
        })}
      </div>
      <div className="live-terminal-scanline" aria-hidden="true" />
    </div>
  );
}

function chapterLabelForAria(chapter: TerminalChapter) {
  if (chapter === "identity") return "Identity";
  if (chapter === "pentesting") return "Pentesting";
  if (chapter === "web") return "Web development";
  return "Skills";
}
