"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { MotionPreferenceProvider } from "@/components/MotionPreference";
import {
  m,
  useAnimationControls,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "framer-motion";
import {
  ArrowDown, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Code2, Mail, Pause, Play,
} from "lucide-react";
import { profile } from "@/data/profile";
import { skillGroups } from "@/data/site";
import { TERMINAL_AREAS, TERMINAL_CHAPTERS, TERMINAL_SERVICES } from "@/content/terminal";
import { chapterLabel, nextTerminalChapter, TERMINAL_TIMING, type TerminalChapter } from "@/lib/terminalEngine";
import LiveTerminalSession from "@/components/LiveTerminalSession";
import { useMotionPreference } from "@/components/MotionPreference";
import BadgesSection from "@/components/BadgesSection";
import GalaxyBackdrop from "@/components/GalaxyBackdrop";

const primaryRole = "Cybersecurity Analyst";

const SnowLayer = dynamic(() => import("@/components/SnowLayer"), {
  ssr: false,
  loading: () => null,
});

export const HERO_TIMING = {
  SWIRL_MS: 1500,
  CROSSFADE_MS: 400,
  CHIP_FLOAT_MS: 6000,
} as const;

const SCENES = TERMINAL_CHAPTERS;
type TransitionSource = "auto" | "manual";

const terminalSkillNames = skillGroups
  .flatMap((group) => group.skills.map(([name]) => name))
  .slice(0, 9);

const terminalIdentityLines = [
  profile.name,
  "ALERT REVIEW · In progress",
  "APPROACH · Evidence-led",
  "FOCUS · Defensive security",
] as const;

function supportsPreserve3D() {
  return typeof CSS !== "undefined"
    && typeof CSS.supports === "function"
    && CSS.supports("transform-style", "preserve-3d")
    && CSS.supports("perspective", "1200px");
}

function estimateChapterDuration(chapter: TerminalChapter): number {
  if (chapter === "identity") {
    return "whoami".length * TERMINAL_TIMING.typingMsPerCharacter
      + terminalIdentityLines.length * TERMINAL_TIMING.outputLineMs
      + TERMINAL_TIMING.identityDwellMs
      + TERMINAL_TIMING.chapterOutroMs;
  }
  if (chapter === "skills") {
    return "stack --list".length * TERMINAL_TIMING.typingMsPerCharacter
      + TERMINAL_TIMING.spinnerMs
      + terminalSkillNames.length * TERMINAL_TIMING.outputLineMs
      + TERMINAL_TIMING.chapterOutroMs;
  }
  return TERMINAL_AREAS[chapter].reduce((total, service) => total
    + service.command.length * TERMINAL_TIMING.typingMsPerCharacter
    + TERMINAL_TIMING.spinnerMs
    + (service.output.length + 1) * TERMINAL_TIMING.outputLineMs
    + TERMINAL_TIMING.servicePanelMs
    + TERMINAL_TIMING.commandPauseMs, 0) + TERMINAL_TIMING.chapterOutroMs;
}

function TerminalFace({
  chapter,
  active,
  paused,
  reducedMotion,
  manualPreview,
  manualPreviewMode,
  serviceOffset,
  servicePositions,
  onServiceSeen,
  onPreviewConsumed,
  onComplete,
  onPreviousService,
  onNextService,
}: {
  chapter: TerminalChapter;
  active: boolean;
  paused: boolean;
  reducedMotion: boolean;
  manualPreview: boolean;
  manualPreviewMode: "chapter" | "service";
  serviceOffset: number;
  servicePositions: Readonly<{ pentesting: number; web: number }>;
  onServiceSeen: (area: "pentesting" | "web", index: number) => void;
  onPreviewConsumed: () => void;
  onComplete: () => void;
  onPreviousService: () => void;
  onNextService: () => void;
}) {
  return (
    <>
      <div className="visual-window-header">
        <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
        <span>THREAT MONITORING</span>
        <span className="live-label"><span className="status-indicator" /> ACTIVE</span>
      </div>
      <div className="visual-window-body live-terminal-body">
        <LiveTerminalSession
          chapter={chapter}
          active={active && visible}
          paused={paused}
          reducedMotion={reducedMotion}
          manualPreview={manualPreview}
          manualPreviewMode={manualPreviewMode}
          serviceOffset={serviceOffset}
          servicePositions={servicePositions}
          skills={terminalSkillNames}
          identityLines={terminalIdentityLines}
          onServiceSeen={onServiceSeen}
          onPreviewConsumed={onPreviewConsumed}
          onComplete={onComplete}
        />
      </div>
      <div className="visual-window-footer terminal-window-footer">
        <span className="terminal-footer-location">NAIROBI, KE <span aria-hidden="true">·</span> EAT</span>
        <div className="terminal-service-navigation">
          <button type="button" aria-label="Previous service" title="Previous service" onClick={onPreviousService}>
            <ChevronLeft size={13} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Next service" title="Next service" onClick={onNextService}>
            <ChevronRight size={13} aria-hidden="true" />
          </button>
        </div>
        <span className="terminal-footer-tag">CLI // 2026</span>
      </div>
    </>
  );
}

function FocusVisualizer() {
  const { preference, setPreference, isSpinning, setIsSpinning } = useMotionPreference();
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [activeScene, setActiveScene] = useState<TerminalChapter>("identity");
  const [visibleFace, setVisibleFace] = useState<"front" | "back">("front");
  const [frontScene, setFrontScene] = useState<TerminalChapter>("identity");
  const [backScene, setBackScene] = useState<TerminalChapter>("pentesting");
  const [pointerPaused, setPointerPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [isIntersecting, setIsIntersecting] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [progressRevision, setProgressRevision] = useState(0);
  const [manualPreview, setManualPreview] = useState(false);
  const [manualPreviewMode, setManualPreviewMode] = useState<"chapter" | "service">("chapter");
  const [serviceOffsets, setServiceOffsets] = useState({ pentesting: 0, web: 0 });
  const [servicePositions, setServicePositions] = useState({ pentesting: 0, web: 0 });
  const [sessionRevision, setSessionRevision] = useState(0);

  const spinnerControls = useAnimationControls();
  const fadeControls = useAnimationControls();
  const glintControls = useAnimationControls();
  const transitionBusyRef = useRef(false);
  const transitionVersionRef = useRef(0);
  const angleRef = useRef(0);
  const swappedFaceRef = useRef(false);
  const spinTargetRef = useRef<TerminalChapter>("pentesting");
  const activeSceneRef = useRef<TerminalChapter>("identity");
  const visibleFaceRef = useRef<"front" | "back">("front");
  const pauseButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const perspectiveRef = useRef<HTMLDivElement>(null);
  const preferredServiceAreaRef = useRef<"pentesting" | "web">("pentesting");

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springRotateX = useSpring(pointerY, { stiffness: 180, damping: 24, mass: 0.5 });
  const springRotateY = useSpring(pointerX, { stiffness: 180, damping: 24, mass: 0.5 });

  const cardAutoPaused = preference === "paused"
    || prefersReducedMotion
    || pointerPaused
    || focusPaused
    || !documentVisible
    || !isIntersecting;
  const sessionPaused = preference === "paused"
    || pointerPaused
    || focusPaused
    || !documentVisible
    || !isIntersecting;
  const currentDwell = estimateChapterDuration(activeScene);

  const settleAt = useCallback((chapter: TerminalChapter) => {
    activeSceneRef.current = chapter;
    setActiveScene(chapter);
    setFrontScene(chapter);
    setBackScene(nextTerminalChapter(chapter));
    visibleFaceRef.current = "front";
    setVisibleFace("front");
    angleRef.current = 0;
    spinnerControls.set({ rotateY: 0, rotateX: 0, rotateZ: 0, scale: 1 });
    fadeControls.set({ opacity: 1 });
    transitionBusyRef.current = false;
    setIsTransitioning(false);
    setIsSpinning(false);
  }, [fadeControls, setIsSpinning, spinnerControls]);

  const transitionTo = useCallback(async (target: TerminalChapter, source: TransitionSource) => {
    if (transitionBusyRef.current || target === activeSceneRef.current) return;
    transitionBusyRef.current = true;
    setIsTransitioning(true);
    const version = ++transitionVersionRef.current;
    spinTargetRef.current = target;
    setProgressRevision((value) => value + 1);
    if (source === "auto") setManualPreview(false);

    const use3D = preference === "auto" && !prefersReducedMotion && supportsPreserve3D();
    if (use3D) {
      setBackScene(target);
      visibleFaceRef.current = "front";
      setVisibleFace("front");
      swappedFaceRef.current = false;
      angleRef.current = 0;
      setIsSpinning(true);
      spinnerControls.set({ rotateY: 0, rotateX: 0, rotateZ: 0, scale: 1 });

      const spin = spinnerControls.start(
        {
          rotateY: 360,
          rotateX: [0, -5, 0],
          rotateZ: [0, 1.2, 0],
          scale: [1, 0.965, 1],
        },
        {
          duration: HERO_TIMING.SWIRL_MS / 1000,
          ease: [0.65, 0, 0.35, 1],
        },
      );
      const glint = glintControls.start(
        { x: ["-115%", "115%"], opacity: [0, 0.48, 0] },
        {
          duration: HERO_TIMING.SWIRL_MS / 1000,
          ease: [0.65, 0, 0.35, 1],
        },
      );
      await Promise.all([spin, glint]);
      if (version !== transitionVersionRef.current) return;
      settleAt(target);
    } else {
      if (prefersReducedMotion) {
        fadeControls.set({ opacity: 1 });
      } else {
        await fadeControls.start({
          opacity: 0,
          transition: {
            duration: HERO_TIMING.CROSSFADE_MS / 1000,
            ease: [0.4, 0, 0.2, 1],
          },
        });
      }
      if (version !== transitionVersionRef.current) return;
      activeSceneRef.current = target;
      setActiveScene(target);
      setFrontScene(target);
      setBackScene(nextTerminalChapter(target));
      if (!prefersReducedMotion) {
        await fadeControls.start({
          opacity: 1,
          transition: {
            duration: HERO_TIMING.CROSSFADE_MS / 1000,
            ease: [0.4, 0, 0.2, 1],
          },
        });
      }
      if (version !== transitionVersionRef.current) return;
      transitionBusyRef.current = false;
      setIsTransitioning(false);
    }
  }, [
    fadeControls,
    glintControls,
    preference,
    prefersReducedMotion,
    setIsSpinning,
    settleAt,
    spinnerControls,
  ]);

  const handleServiceSeen = useCallback((area: "pentesting" | "web", index: number) => {
    preferredServiceAreaRef.current = area;
    setServicePositions((current) => current[area] === index
      ? current
      : { ...current, [area]: index });
  }, []);

  const consumeManualPreview = useCallback(() => {
    setManualPreview(false);
  }, []);

  const completeChapter = useCallback((chapter: TerminalChapter) => {
    if (
      chapter !== activeSceneRef.current
      || cardAutoPaused
      || isTransitioning
      || preference !== "auto"
      || prefersReducedMotion
    ) return;
    void transitionTo(nextTerminalChapter(chapter), "auto");
  }, [cardAutoPaused, isTransitioning, preference, prefersReducedMotion, transitionTo]);

  const navigateService = useCallback((direction: -1 | 1) => {
    const scene = activeSceneRef.current;
    const area = scene === "web"
      ? "web"
      : scene === "pentesting"
        ? "pentesting"
        : preferredServiceAreaRef.current;
    const services = TERMINAL_AREAS[area];
    if (!services.length) return;
    const currentIndex = servicePositions[area] ?? serviceOffsets[area];
    const nextIndex = (currentIndex + direction + services.length) % services.length;
    preferredServiceAreaRef.current = area;
    setServiceOffsets((current) => ({ ...current, [area]: nextIndex }));
    setServicePositions((current) => ({ ...current, [area]: nextIndex }));
    setManualPreview(true);
    setManualPreviewMode("service");
    setSessionRevision((value) => value + 1);
    if (scene !== area) void transitionTo(area, "manual");
  }, [serviceOffsets, servicePositions, transitionTo]);

  useEffect(() => {
    const onVisibilityChange = () => setDocumentVisible(!document.hidden);
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    const node = perspectiveRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setIsIntersecting(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      setIsIntersecting(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.05));
    }, { threshold: [0, 0.05] });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (preference !== "paused" || !isSpinning) return;
    transitionVersionRef.current += 1;
    spinnerControls.stop();
    glintControls.stop();
    const chapter = angleRef.current >= 180 ? spinTargetRef.current : activeSceneRef.current;
    settleAt(chapter);
  }, [glintControls, isSpinning, preference, settleAt, spinnerControls]);

  useEffect(() => {
    if (isSpinning || prefersReducedMotion) {
      pointerX.set(0);
      pointerY.set(0);
    }
  }, [isSpinning, pointerX, pointerY, prefersReducedMotion]);

  const selectScene = (scene: TerminalChapter) => {
    if (scene === activeSceneRef.current || transitionBusyRef.current) return;
    if (preference === "paused" && !prefersReducedMotion) {
      setManualPreview(true);
      setManualPreviewMode("chapter");
    } else {
      setManualPreview(false);
    }
    void transitionTo(scene, "manual");
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % SCENES.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + SCENES.length) % SCENES.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = SCENES.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    tabRefs.current[nextIndex]?.focus();
    selectScene(SCENES[nextIndex]);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || prefersReducedMotion || isSpinning || !window.matchMedia("(pointer: fine)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
    const vertical = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    pointerX.set((horizontal - 0.5) * 8);
    pointerY.set((0.5 - vertical) * 8);
  };

  const handlePointerLeave = () => {
    setPointerPaused(false);
    pointerX.set(0);
    pointerY.set(0);
  };

  const renderFace = (chapter: TerminalChapter, face: "front" | "back") => (
    <m.div
      className={"visual-face visual-face-" + face}
      animate={face === "front" ? fadeControls : undefined}
      id={visibleFace === face ? "security-showcase-panel" : undefined}
      role={visibleFace === face ? "tabpanel" : undefined}
      aria-labelledby={visibleFace === face ? "showcase-tab-" + chapter : undefined}
      aria-hidden={visibleFace !== face}
      inert={visibleFace !== face}
      key={face + "-" + chapter + "-" + serviceOffsets.pentesting + "-" + serviceOffsets.web + "-" + sessionRevision}
    >
      <TerminalFace
        chapter={chapter}
        active={visibleFace === face && isIntersecting && documentVisible}
        paused={sessionPaused}
        reducedMotion={prefersReducedMotion}
        manualPreview={manualPreview}
        manualPreviewMode={manualPreviewMode}
        serviceOffset={serviceOffsets[chapter === "web" ? "web" : "pentesting"] ?? 0}
        servicePositions={servicePositions}
        onServiceSeen={handleServiceSeen}
        onPreviewConsumed={consumeManualPreview}
        onComplete={() => completeChapter(chapter)}
        onPreviousService={() => navigateService(-1)}
        onNextService={() => navigateService(1)}
      />
    </m.div>
  );

  return (
    <div
      className={"hero-visual scene-" + activeScene + (preference === "paused" ? " motion-paused" : "")}
      role="group"
      aria-label="Live terminal simulation of cybersecurity services, web development, and technical skills. Commands and output are illustrative only and are never executed."
      aria-live="off"
      onPointerEnter={() => setPointerPaused(true)}
      onPointerLeave={handlePointerLeave}
      onFocusCapture={() => setFocusPaused(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setFocusPaused(false);
        }
      }}
    >
      <div className="visual-glow" aria-hidden="true" />
      <div className="visual-orbit orbit-one" aria-hidden="true" />
      <div className="visual-orbit orbit-two" aria-hidden="true" />
      <div className={"floating-chip chip-top " + (preference === "paused" ? "motion-paused" : "")} aria-hidden="true">
        <span className="status-indicator" /> Systems-minded
      </div>
      <div className={"floating-chip chip-bottom " + (preference === "paused" ? "motion-paused" : "")} aria-hidden="true">
        <span className="spark-icon">✳</span> Curious by nature
      </div>
      <m.div
        className="visual-tilt"
        style={{ rotateX: springRotateX, rotateY: springRotateY }}
        onPointerMove={handlePointerMove}
      >
        <div className="visual-perspective" ref={perspectiveRef}>
          <m.div
            className="visual-spinner"
            animate={spinnerControls}
            onUpdate={(latest) => {
              const angle = Number(latest.rotateY ?? 0);
              angleRef.current = angle;
              const nextVisibleFace: "front" | "back" =
                angle >= 90 && angle < 270 ? "back" : "front";
              if (visibleFaceRef.current !== nextVisibleFace) {
                visibleFaceRef.current = nextVisibleFace;
                setVisibleFace(nextVisibleFace);
              }
              if (!swappedFaceRef.current && angle >= 180 && angle <= 360) {
                swappedFaceRef.current = true;
                const target = spinTargetRef.current;
                setFrontScene(target);
                activeSceneRef.current = target;
                setActiveScene(target);
              }
            }}
          >
            {renderFace(frontScene, "front")}
            {renderFace(backScene, "back")}
          </m.div>
          <m.div className="visual-glint" animate={glintControls} aria-hidden="true" />
        </div>
      </m.div>
      <div className="showcase-controls">
        <button
          ref={pauseButtonRef}
          className="motion-toggle"
          type="button"
          aria-label={preference === "paused" ? "Play animations" : "Pause animations"}
          aria-pressed={preference === "paused"}
          onClick={() => {
            const nextPreference = preference === "paused" ? "auto" : "paused";
            setPreference(nextPreference);
            if (nextPreference === "auto") setFocusPaused(false);
          }}
          title={preference === "paused" ? "Play animations" : "Pause animations"}
        >
          {preference === "paused" ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
          <span>{preference === "paused" ? "PLAY" : "PAUSE"}</span>
        </button>
        <div className="visual-pagination" role="tablist" aria-label="Terminal chapters">
          {SCENES.map((chapter, index) => (
            <button
              ref={(element) => { tabRefs.current[index] = element; }}
              key={chapter}
              id={"showcase-tab-" + chapter}
              className={activeScene === chapter ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeScene === chapter}
              aria-controls="security-showcase-panel"
              tabIndex={activeScene === chapter ? 0 : -1}
              onClick={() => selectScene(chapter)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              title={chapterLabel(chapter)}
            >
              <span className="sr-only">{chapterLabel(chapter)}</span>
              <span className="visual-tab-track" aria-hidden="true">
                <span
                  className="visual-tab-fill"
                  key={chapter + "-" + progressRevision + "-" + activeScene}
                  style={{
                    animationDuration: estimateChapterDuration(chapter) + "ms",
                    animationPlayState: activeScene === chapter && !cardAutoPaused && !isTransitioning ? "running" : "paused",
                  }}
                />
              </span>
            </button>
          ))}
        </div>
      </div>
      <ul className="sr-only terminal-accessible-services" aria-label="Terminal service catalogue">
        {TERMINAL_SERVICES.map((service) => (
          <li key={service.id}>
            <strong>{service.title}</strong>
            <span>{service.summary}</span>
            {service.proof?.map((proof) => (
              <a key={proof.href} href={proof.href} target="_blank" rel="noopener noreferrer" tabIndex={-1}>
                {proof.label}
              </a>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnimatedRole() {
  return (
    <span className="animated-role">
      <span>{primaryRole}</span>
    </span>
  );
}

export default function HomeHero() {
  const [snowReady, setSnowReady] = useState(false);

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => setSnowReady(true));
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, []);

  return (
    <MotionPreferenceProvider>
      <section className="home-hero page-container" aria-labelledby="home-title">
        <GalaxyBackdrop />
        {snowReady && <SnowLayer />}
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-indicator" /> OPEN TO OPPORTUNITIES · NAIROBI, KENYA</p>
          <h1 id="home-title">Morgan West<br /><span>Oketch.</span></h1>
          <p className="hero-role-label">CYBERSECURITY <span>·</span> IT SUPPORT <span>·</span> DATA</p>
          <div className="role-line">I work as a <AnimatedRole /></div>
          <p className="hero-summary">{profile.summary}</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/resume">
              View résumé &amp; documents <ArrowDown size={15} aria-hidden="true" />
            </Link>
            <Link className="button button-quiet" href="/projects">Explore projects <ArrowRight size={15} aria-hidden="true" /></Link>
            <Link className="button button-quiet" href="/contact">Get in touch <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
          <nav className="hero-quicklinks" aria-label="Explore homepage sections">
            <a href="#services">Services <span aria-hidden="true">↘</span></a>
            <a href="#skills">Skills <span aria-hidden="true">↘</span></a>
          </nav>
          <nav className="hero-socials" aria-label="Professional profiles">
            <a href={profile.github} target="_blank" rel="noreferrer"><Code2 size={16} aria-hidden="true" /> GitHub <span className="sr-only">(opens in a new tab)</span></a>
            <a href={profile.linkedin} target="_blank" rel="noreferrer"><span className="social-brand-mark" aria-hidden="true">in</span> LinkedIn <span className="sr-only">(opens in a new tab)</span></a>
            <a href={"mailto:" + profile.email}><Mail size={16} aria-hidden="true" /> Email</a>
          </nav>
        </div>
        <FocusVisualizer />
        <a className="hero-scroll-hint" href="#services"><span className="scroll-line" /> DISCOVER THE WORK <ArrowDown size={13} aria-hidden="true" /></a>
      </section>
      <BadgesSection />
      <section className="snapshot-section" id="snapshot" aria-labelledby="snapshot-title">
        <div className="page-container">
          <div className="snapshot-heading">
            <div><p className="eyebrow">A GROUNDED STARTING POINT</p><h2 id="snapshot-title">Learning by doing.</h2></div>
            <p>Real experience, documented projects, and a steady commitment to growing in the security field.</p>
          </div>
          <div className="snapshot-grid">
            <article><span>01 / EXPERIENCE</span><strong>50+</strong><p>users supported in a volunteer IT lab</p></article>
            <article><span>02 / PROJECTS</span><strong>2</strong><p>hands-on security and development projects</p></article>
            <article><span>03 / TRAINING</span><strong>5</strong><p>completed professional learning programs</p></article>
            <article><span>04 / EDUCATION</span><strong>2026</strong><p>expected BSc graduation year</p></article>
          </div>
        </div>
      </section>
    </MotionPreferenceProvider>
  );
}
