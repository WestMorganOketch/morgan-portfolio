"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight, ArrowUpRight, Code2, Mail } from "lucide-react";
import { profile } from "@/data/profile";
import { motionDurations, motionEasing } from "@/lib/motion";

const primaryRole = "Cybersecurity Analyst";

type FocusScene = {
  kind: "service" | "skills";
  label: string;
  title: string;
  code: string;
  terminalLines: [string, string];
  readout: [string, string][];
};

const scenes: FocusScene[] = [
  {
    kind: "service",
    label: "THREAT MONITORING",
    title: "Signals into context.",
    code: "security.operations()",
    terminalLines: [
      "Review alerts with evidence.",
      "Separate meaningful signals from noise.",
    ],
    readout: [["REVIEW", "Alert triage"], ["METHOD", "Evidence-led"], ["FOCUS", "Threat detection"]],
  },
  {
    kind: "service",
    label: "INCIDENT RESPONSE",
    title: "Respond with clarity.",
    code: "incident.respond()",
    terminalLines: [
      "Triage events and establish scope.",
      "Document findings for the next action.",
    ],
    readout: [["PRIORITY", "Containment"], ["PRACTICE", "Clear documentation"], ["FOCUS", "Response lifecycle"]],
  },
  {
    kind: "service",
    label: "NETWORK DEFENSE",
    title: "Protect the connections.",
    code: "network.secure()",
    terminalLines: [
      "Review traffic and access patterns.",
      "Apply firewall, VPN, and access controls.",
    ],
    readout: [["TOOLS", "Wireshark · Firewall"], ["PRINCIPLE", "Least privilege"], ["FOCUS", "Secure connectivity"]],
  },
  {
    kind: "service",
    label: "VULNERABILITY REVIEW",
    title: "Find the weak points.",
    code: "risk.assess()",
    terminalLines: [
      "Review configurations and exposures.",
      "Prioritize findings by practical risk.",
    ],
    readout: [["METHOD", "Evidence-led"], ["PRIORITY", "Risk reduction"], ["FOCUS", "Vulnerability review"]],
  },
  {
    kind: "skills",
    label: "SECURITY TOOLKIT",
    title: "Tools. Technique. Judgement.",
    code: "skills.security()",
    terminalLines: [
      "SIEM fundamentals · Wireshark",
      "VPN · Firewall · Access control",
    ],
    readout: [["PRACTICE", "Threat detection"], ["TOOLS", "Network security"], ["FOCUS", "Defensive operations"]],
  },
  {
    kind: "skills",
    label: "SYSTEMS & SUPPORT",
    title: "Reliable by design.",
    code: "systems.support()",
    terminalLines: [
      "Windows Server · Linux lab support",
      "Infrastructure support for 50+ users",
    ],
    readout: [["SYSTEMS", "Windows + Linux"], ["SUPPORT", "Tier 1 · Tier 2"], ["FOCUS", "Reliable operations"]],
  },
  {
    kind: "skills",
    label: "DATA & ANALYTICS",
    title: "Make the data useful.",
    code: "data.analyze()",
    terminalLines: [
      "SQL · Power BI · Excel",
      "Python · Pandas · Scikit-learn",
    ],
    readout: [["WORKFLOW", "ETL + reporting"], ["ANALYSIS", "Predictive modelling"], ["FOCUS", "Practical insight"]],
  },
];

function FocusVisualizer() {
  const [active, setActive] = useState(0);
  const [pointerPaused, setPointerPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const scene = scenes[active];
  const sceneNumber = scenes.slice(0, active + 1).filter((item) => item.kind === scene.kind).length;
  const sceneCount = scenes.filter((item) => item.kind === scene.kind).length;
  const isPaused = pointerPaused || focusPaused || Boolean(prefersReducedMotion);

  useEffect(() => {
    if (isPaused) return;
    const timer = window.setInterval(() => {
      setActive((current) => (current + 1) % scenes.length);
    }, 6800);
    return () => window.clearInterval(timer);
  }, [active, isPaused]);

  return (
    <div
      className={`hero-visual scene-${active}`}
      data-scene-kind={scene.kind}
      role="region"
      aria-roledescription="carousel"
      aria-label="Cybersecurity services and skills showcase"
      onPointerEnter={() => setPointerPaused(true)}
      onPointerLeave={() => setPointerPaused(false)}
      onFocusCapture={() => setFocusPaused(true)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          setFocusPaused(false);
        }
      }}
    >
      <div className="visual-orbit orbit-one" aria-hidden="true" />
      <div className="visual-orbit orbit-two" aria-hidden="true" />
      <div className="visual-glow" aria-hidden="true" />
      <div className="floating-chip chip-top"><span className="status-indicator" /> Systems-minded</div>
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          className="visual-window"
          id="security-showcase-panel"
          key={scene.label}
          aria-live="polite"
          aria-atomic="true"
          initial={prefersReducedMotion
            ? { opacity: 0 }
            : { opacity: 0, rotate: -12, rotateY: 8, scale: 0.92, y: 10 }}
          animate={{ opacity: 1, rotate: 0, rotateY: 0, scale: 1, y: 0 }}
          exit={prefersReducedMotion
            ? { opacity: 0, transition: { duration: motionDurations.reduced } }
            : {
                opacity: [1, 1, 0.78, 0],
                rotate: [0, 120, 250, 360],
                rotateY: [0, -8, 8, 0],
                scale: [1, 1.035, 0.97, 0.92],
                y: [0, -5, 2, -5],
                transition: { duration: 1.15, ease: motionEasing.enter },
              }}
          transition={{
            duration: prefersReducedMotion ? motionDurations.reduced : 0.48,
            ease: motionEasing.enter,
          }}
        >
          <div className="visual-window-header">
            <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
            <span>{scene.label}</span>
            <span className="live-label"><span className="status-indicator" /> {scene.kind === "service" ? "SERVICE" : "SKILLS"}</span>
          </div>
          <div className="visual-window-body">
            <div className="visual-kicker">
              // {scene.kind === "service" ? "SECURITY SERVICE" : "TECHNICAL SKILLS"} · {String(sceneNumber).padStart(2, "0")} / {String(sceneCount).padStart(2, "0")}
            </div>
            <h2>{scene.title}</h2>
            <div className="visual-terminal">
              <div><span className="terminal-prompt">morgan@portfolio</span>:<span className="terminal-path">~</span>$ {scene.code}</div>
              {scene.terminalLines.map((line) => (
                <div className="terminal-line" key={line}><span aria-hidden="true">›</span> {line}</div>
              ))}
            </div>
            <div className="visual-readout">
              {scene.readout.map(([label, value]) => (
                <div key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
          </div>
          <div className="visual-window-footer">
            <span>NAIROBI, KE <span aria-hidden="true">·</span> EAT</span>
            <span>SHOWCASE // {String(active + 1).padStart(2, "0")} OF {String(scenes.length).padStart(2, "0")}</span>
          </div>
        </m.div>
      </AnimatePresence>
      <div className="floating-chip chip-bottom"><span className="spark-icon" aria-hidden="true">✳</span> Curious by nature</div>
      <nav className="visual-pagination" aria-label="Choose a showcase panel">
        {scenes.map((item, index) => (
          <button
            key={item.label}
            className={index === active ? "active" : ""}
            type="button"
            onClick={() => setActive(index)}
            aria-label={`Show ${item.label.toLowerCase()} ${item.kind} panel`}
            aria-controls="security-showcase-panel"
            aria-pressed={index === active}
            title={item.label}
          />
        ))}
      </nav>
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
  return (
    <>
      <section className="home-hero page-container" aria-labelledby="home-title">
        <div className="snowfall" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => <span key={index} />)}
        </div>
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
          <nav className="hero-socials" aria-label="Professional profiles">
            <a href={profile.github} target="_blank" rel="noreferrer"><Code2 size={16} aria-hidden="true" /> GitHub <span className="sr-only">(opens in a new tab)</span></a>
            <a href={profile.linkedin} target="_blank" rel="noreferrer"><span className="social-brand-mark" aria-hidden="true">in</span> LinkedIn <span className="sr-only">(opens in a new tab)</span></a>
            <a href={`mailto:${profile.email}`}><Mail size={16} aria-hidden="true" /> Email</a>
          </nav>
        </div>
        <FocusVisualizer />
        <a className="hero-scroll-hint" href="#snapshot"><span className="scroll-line" /> DISCOVER THE WORK <ArrowDown size={13} aria-hidden="true" /></a>
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
    </>
  );
}
