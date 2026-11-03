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
  ArrowDown, ArrowRight, ArrowUpRight, Code2, Mail, Pause, Play,
} from "lucide-react";
import { profile } from "@/data/profile";
import { skillGroups } from "@/data/site";
import { useMotionPreference } from "@/components/MotionPreference";

const primaryRole = "Cybersecurity Analyst";

const SnowLayer = dynamic(() => import("@/components/SnowLayer"), {
  ssr: false,
  loading: () => null,
});

export const HERO_TIMING = {
  FIRST_SPIN_MS: 6000,
  OVERVIEW_DWELL_MS: 4000,
  SERVICE_LINE_MS: 1800,
  SERVICE_BUFFER_MS: 600,
  SKILLS_DWELL_MS: 7000,
  SWIRL_MS: 1500,
  CROSSFADE_MS: 400,
  SKILL_STAGGER_MS: 80,
  CHIP_FLOAT_MS: 6000,
} as const;

const SCENES = ["overview", "services", "skills"] as const;
type ShowcaseScene = (typeof SCENES)[number];
type TransitionSource = "auto" | "manual";

const serviceItems = profile.services.slice(0, 5);
const skillItems = skillGroups
  .flatMap((group) =>
    group.skills.map(([name, description, level]) => ({
      name, description, level, category: group.name,
    })),
  )
  .slice(0, 9);

function nextScene(scene: ShowcaseScene): ShowcaseScene {
  return scene === "overview" ? "services" : scene === "services" ? "skills" : "overview";
}

function supportsPreserve3D() {
  return typeof CSS !== "undefined"
    && typeof CSS.supports === "function"
    && CSS.supports("transform-style", "preserve-3d")
    && CSS.supports("perspective", "1200px");
}

function OverviewFace() {
  return (
    <>
      <div className="visual-window-header">
        <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
        <span>THREAT MONITORING</span>
        <span className="live-label"><span className="status-indicator" /> ACTIVE</span>
      </div>
      <div className="visual-window-body overview-body">
        <div className="visual-kicker">// A PRACTICAL, CURIOUS APPROACH</div>
        <h2>Signals into context.</h2>
        <div className="visual-terminal">
          <div><span className="terminal-prompt">morgan@portfolio</span>:<span className="terminal-path">~</span>$ security.operations()</div>
          <div className="terminal-line"><span aria-hidden="true">›</span> Observe carefully. Respond thoughtfully.</div>
          <div className="terminal-line"><span aria-hidden="true">›</span> Always learn, document, and improve.</div>
        </div>
        <div className="visual-readout">
          <div><span>ALERT REVIEW</span><strong>In progress</strong></div>
          <div><span>APPROACH</span><strong>Evidence-led</strong></div>
          <div><span>FOCUS</span><strong>Defensive security</strong></div>
        </div>
      </div>
      <div className="visual-window-footer">
        <span>NAIROBI, KE <span aria-hidden="true">·</span> EAT</span>
        <span>PORTFOLIO // 2026</span>
      </div>
    </>
  );
}

function ServicesFace({ activeLine }: { activeLine: number }) {
  return (
    <>
      <div className="visual-window-header">
        <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
        <span>SERVICES</span>
        <span className="live-label"><span className="status-indicator" /> AVAILABLE</span>
      </div>
      <div className="visual-window-body services-body">
        <div className="visual-kicker">// PROFESSIONAL SUPPORT</div>
        <h2>What I can help with.</h2>
        <div className="service-terminal-list" aria-label="Services">
          {serviceItems.map((service, index) => (
            <div className={index === activeLine ? "service-terminal-line active" : "service-terminal-line"} key={service.number}>
              <span className="service-line-index">{service.number}</span>
              <span className="service-line-title">{service.title}</span>
              {index === activeLine ? <span className="service-line-caret" aria-hidden="true">▌</span> : <span className="service-line-spacer" aria-hidden="true" />}
            </div>
          ))}
        </div>
        <p className="service-terminal-note">Select Services below to explore the full scope.</p>
      </div>
      <div className="visual-window-footer">
        <span>SECURITY <span aria-hidden="true">·</span> SYSTEMS <span aria-hidden="true">·</span> WEB</span>
        <span>{String(serviceItems.length).padStart(2, "0")} SERVICES</span>
      </div>
    </>
  );
}

function SkillsFace({ reducedMotion, visible }: { reducedMotion: boolean; visible: boolean }) {
  return (
    <>
      <div className="visual-window-header">
        <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
        <span>SKILLS</span>
        <span className="live-label skills-live-label"><span className="status-indicator" /> TOOLKIT</span>
      </div>
      <div className="visual-window-body skills-body">
        <div className="visual-kicker">// TECHNICAL SKILLS · SELECTED</div>
        <h2>What I work with.</h2>
        <div className="showcase-skill-grid" aria-label="Selected technical skills">
          {skillItems.map((skill, index) => (
            <m.span
              className="showcase-skill-chip"
              key={skill.name}
              initial={false}
              animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
              transition={{
                duration: reducedMotion ? 0.1 : 0.32,
                delay: reducedMotion ? 0 : index * (HERO_TIMING.SKILL_STAGGER_MS / 1000),
                ease: [0.22, 1, 0.36, 1],
              }}
              title={skill.category}
            >
              <span className="skill-chip-dot" aria-hidden="true" />
              <span>{skill.name}</span>
              {skill.level === "Learning" && <small>LEARNING</small>}
            </m.span>
          ))}
        </div>
        <p className="skills-terminal-note">A selected view of the skills documented in my portfolio.</p>
      </div>
      <div className="visual-window-footer skills-window-footer">
        <span>SECURITY <span aria-hidden="true">·</span> NETWORKS <span aria-hidden="true">·</span> SYSTEMS</span>
        <span>{String(skillItems.length).padStart(2, "0")} SKILLS</span>
      </div>
    </>
  );
}

function ShowcaseFace({
  scene,
  activeServiceLine,
  reducedMotion,
  visible,
}: {
  scene: ShowcaseScene;
  activeServiceLine: number;
  reducedMotion: boolean;
  visible: boolean;
}) {
  if (scene === "overview") return <OverviewFace />;
  if (scene === "services") return <ServicesFace activeLine={activeServiceLine} />;
  return <SkillsFace reducedMotion={reducedMotion} visible={visible} />;
}

function FocusVisualizer() {
  const { preference, setPreference, isSpinning, setIsSpinning } = useMotionPreference();
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [activeScene, setActiveScene] = useState<ShowcaseScene>("overview");
  const [visibleFace, setVisibleFace] = useState<"front" | "back">("front");
  const [frontScene, setFrontScene] = useState<ShowcaseScene>("overview");
  const [backScene, setBackScene] = useState<ShowcaseScene>("services");
  const [activeServiceLine, setActiveServiceLine] = useState(0);
  const [pointerPaused, setPointerPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [announceManually, setAnnounceManually] = useState(false);
  const [progressRevision, setProgressRevision] = useState(0);
  const [hasLeftFirstOverview, setHasLeftFirstOverview] = useState(false);

  const spinnerControls = useAnimationControls();
  const fadeControls = useAnimationControls();
  const glintControls = useAnimationControls();
  const transitionBusyRef = useRef(false);
  const transitionVersionRef = useRef(0);
  const angleRef = useRef(0);
  const swappedFaceRef = useRef(false);
  const spinTargetRef = useRef<ShowcaseScene>("services");
  const activeSceneRef = useRef<ShowcaseScene>("overview");
  const visibleFaceRef = useRef<"front" | "back">("front");
  const pauseButtonRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const springRotateX = useSpring(pointerY, { stiffness: 180, damping: 24, mass: 0.5 });
  const springRotateY = useSpring(pointerX, { stiffness: 180, damping: 24, mass: 0.5 });

  const cardAutoPaused = preference === "paused"
    || prefersReducedMotion
    || pointerPaused
    || focusPaused
    || !documentVisible;

  const currentDwell = activeScene === "overview"
    ? (hasLeftFirstOverview ? HERO_TIMING.OVERVIEW_DWELL_MS : HERO_TIMING.FIRST_SPIN_MS)
    : activeScene === "services"
      ? serviceItems.length * HERO_TIMING.SERVICE_LINE_MS + HERO_TIMING.SERVICE_BUFFER_MS
      : HERO_TIMING.SKILLS_DWELL_MS;

  const settleAt = useCallback((scene: ShowcaseScene) => {
    activeSceneRef.current = scene;
    setActiveScene(scene);
    setFrontScene(scene);
    setBackScene(nextScene(scene));
    visibleFaceRef.current = "front";
    setVisibleFace("front");
    setActiveServiceLine(0);
    angleRef.current = 0;
    spinnerControls.set({ rotateY: 0, rotateX: 0, rotateZ: 0, scale: 1 });
    fadeControls.set({ opacity: 1 });
    transitionBusyRef.current = false;
    setIsTransitioning(false);
    setIsSpinning(false);
  }, [fadeControls, setIsSpinning, spinnerControls]);

  const transitionTo = useCallback(async (target: ShowcaseScene, source: TransitionSource) => {
    if (transitionBusyRef.current || target === activeSceneRef.current) return;
    transitionBusyRef.current = true;
    setIsTransitioning(true);
    const version = ++transitionVersionRef.current;
    spinTargetRef.current = target;
    if (source === "manual") {
      setAnnounceManually(true);
      setProgressRevision((value) => value + 1);
    } else {
      setAnnounceManually(false);
    }
    if (activeSceneRef.current === "overview" && target !== "overview") {
      setHasLeftFirstOverview(true);
    }

    const use3D = preference === "auto" && !prefersReducedMotion && supportsPreserve3D();
    if (use3D) {
      setBackScene(target);
      visibleFaceRef.current = "front";
      setVisibleFace("front");
      swappedFaceRef.current = false;
      angleRef.current = 0;
      setActiveServiceLine(0);
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
      await fadeControls.start({
        opacity: 0,
        transition: {
          duration: HERO_TIMING.CROSSFADE_MS / 2000,
          ease: [0.4, 0, 0.2, 1],
        },
      });
      if (version !== transitionVersionRef.current) return;
      activeSceneRef.current = target;
      setActiveScene(target);
      setFrontScene(target);
      setBackScene(nextScene(target));
      setActiveServiceLine(0);
      await fadeControls.start({
        opacity: 1,
        transition: {
          duration: HERO_TIMING.CROSSFADE_MS / 2000,
          ease: [0.4, 0, 0.2, 1],
        },
      });
      if (version !== transitionVersionRef.current) return;
      transitionBusyRef.current = false;
      setIsTransitioning(false);
    }
  }, [
    fadeControls, glintControls, preference, prefersReducedMotion, setIsSpinning, settleAt, spinnerControls,
  ]);

  useEffect(() => {
    const onVisibilityChange = () => setDocumentVisible(!document.hidden);
    onVisibilityChange();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (preference !== "paused" || !isSpinning) return;
    transitionVersionRef.current += 1;
    spinnerControls.stop();
    glintControls.stop();
    const scene = angleRef.current >= 180 ? spinTargetRef.current : activeSceneRef.current;
    settleAt(scene);
  }, [glintControls, isSpinning, preference, settleAt, spinnerControls]);

  useEffect(() => {
    if (cardAutoPaused || isTransitioning || transitionBusyRef.current) return;
    const target = nextScene(activeScene);
    const timer = window.setTimeout(() => {
      void transitionTo(target, "auto");
    }, currentDwell);
    return () => window.clearTimeout(timer);
  }, [activeScene, cardAutoPaused, currentDwell, isTransitioning, transitionTo]);

  useEffect(() => {
    if (activeScene !== "services" || cardAutoPaused || isTransitioning) return;
    const timer = window.setInterval(() => {
      setActiveServiceLine((current) => Math.min(current + 1, serviceItems.length - 1));
    }, HERO_TIMING.SERVICE_LINE_MS);
    return () => window.clearInterval(timer);
  }, [activeScene, cardAutoPaused, isTransitioning]);

  useEffect(() => {
    if (isSpinning || prefersReducedMotion) {
      pointerX.set(0);
      pointerY.set(0);
    }
  }, [isSpinning, pointerX, pointerY, prefersReducedMotion]);

  const selectScene = (scene: ShowcaseScene) => {
    if (scene === activeSceneRef.current || transitionBusyRef.current) return;
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

  return (
    <div
      className={"hero-visual scene-" + activeScene}
      role="region"
      aria-roledescription="interactive showcase"
      aria-label="Cybersecurity services and skills showcase"
      aria-live={announceManually ? "polite" : "off"}
      onPointerEnter={() => setPointerPaused(true)}
      onPointerLeave={handlePointerLeave}
      onFocusCapture={() => setFocusPaused(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget === pauseButtonRef.current || !(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
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
        <div className="visual-perspective">
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
            <m.div
              className="visual-face visual-face-front"
              animate={fadeControls}
              id={visibleFace === "front" ? "security-showcase-panel" : undefined}
              role={visibleFace === "front" ? "tabpanel" : undefined}
              aria-labelledby={visibleFace === "front" ? "showcase-tab-" + frontScene : undefined}
              aria-hidden={visibleFace !== "front"}
              inert={visibleFace !== "front"}
            >
              <ShowcaseFace
                scene={frontScene}
                activeServiceLine={activeServiceLine}
                reducedMotion={prefersReducedMotion}
                visible={visibleFace === "front"}
              />
            </m.div>
            <div
              className="visual-face visual-face-back"
              id={visibleFace === "back" ? "security-showcase-panel" : undefined}
              role={visibleFace === "back" ? "tabpanel" : undefined}
              aria-labelledby={visibleFace === "back" ? "showcase-tab-" + backScene : undefined}
              aria-hidden={visibleFace !== "back"}
              inert={visibleFace !== "back"}
            >
              <ShowcaseFace
                scene={backScene}
                activeServiceLine={0}
                reducedMotion={prefersReducedMotion}
                visible={visibleFace === "back"}
              />
            </div>
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
        <div className="visual-pagination" role="tablist" aria-label="Showcase scenes">
          {SCENES.map((scene, index) => (
            <button
              ref={(element) => { tabRefs.current[index] = element; }}
              key={scene}
              id={"showcase-tab-" + scene}
              className={activeScene === scene ? "active" : ""}
              type="button"
              role="tab"
              aria-selected={activeScene === scene}
              aria-controls="security-showcase-panel"
              tabIndex={activeScene === scene ? 0 : -1}
              onClick={() => selectScene(scene)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              title={scene === "overview" ? "Overview" : scene === "services" ? "Services" : "Skills"}
            >
              <span className="sr-only">{scene === "overview" ? "Overview" : scene === "services" ? "Services" : "Skills"}</span>
              <span className="visual-tab-track" aria-hidden="true">
                <span
                  className="visual-tab-fill"
                  key={scene + "-" + progressRevision + "-" + activeScene}
                  style={{
                    animationDuration: currentDwell + "ms",
                    animationPlayState: activeScene === scene && !cardAutoPaused && !isTransitioning ? "running" : "paused",
                  }}
                />
              </span>
            </button>
          ))}
        </div>
      </div>
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
    setSnowReady(true);
  }, []);

  return (
    <MotionPreferenceProvider>
      <section className="home-hero page-container" aria-labelledby="home-title">
        {snowReady && <SnowLayer />}
        <div className="hero-copy">
          <p className="eyebrow"><span className="status-indicator" /> OPEN TO OPPORTUNITIES · NAIROBI, KENYA</p>
          <h1 id="home-title">Morgan West<br /><span>Oketch.</span></h1>
          <p className="hero-role-label">CYBERSECURITY <span>·</span> IT SUPPORT <span>·</span> DATA</p>
          <div className="role-line">I work as a <AnimatedRole /></div>
          <p className="hero-summary">{profile.summary}</p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/documents">
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
