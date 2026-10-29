"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowRight, ArrowUpRight, Code2, Mail } from "lucide-react";
import { profile } from "@/data/profile";
import { motionDurations, motionEasing } from "@/lib/motion";

const primaryRole = "Cybersecurity Analyst";

const scenes = [
  {
    label: "THREAT MONITORING",
    title: "Signals into context.",
    code: "security.operations()",
    readout: [["ALERT REVIEW", "In progress"], ["APPROACH", "Evidence-led"], ["FOCUS", "Defensive security"]],
  },
  {
    label: "NETWORK DEFENSE",
    title: "Built with care.",
    code: "network.secure()",
    readout: [["ACCESS", "Least privilege"], ["TRAFFIC", "Monitored"], ["FOCUS", "Secure connectivity"]],
  },
  {
    label: "SYSTEMS & DATA",
    title: "Learn. Build. Improve.",
    code: "systems.improve()",
    readout: [["PLATFORM", "Web + data"], ["WORKFLOW", "Iterative"], ["FOCUS", "Useful solutions"]],
  },
];

function FocusVisualizer() {
  const [active, setActive] = useState(0);
  const prefersReducedMotion = useReducedMotion();
  const scene = scenes[active];
  return (
    <div className={`hero-visual scene-${active}`} aria-label={`Portfolio illustration: ${scene.label.toLowerCase()}`}>
      <div className="visual-orbit orbit-one" aria-hidden="true" />
      <div className="visual-orbit orbit-two" aria-hidden="true" />
      <div className="visual-glow" aria-hidden="true" />
      <div className="floating-chip chip-top"><span className="status-indicator" /> Systems-minded</div>
      <div className="visual-window">
        <div className="visual-window-header">
          <div className="window-dots" aria-hidden="true"><i /><i /><i /></div>
          <span>{scene.label}</span>
          <span className="live-label"><span className="status-indicator" /> ACTIVE</span>
        </div>
        <AnimatePresence mode="wait">
          <m.div
            className="visual-window-body"
            key={scene.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              y: -8,
              transition: {
                duration: prefersReducedMotion ? motionDurations.reduced : motionDurations.exit,
                ease: motionEasing.move,
              },
            }}
            transition={{
              duration: prefersReducedMotion ? motionDurations.reduced : motionDurations.base,
              ease: motionEasing.enter,
            }}
          >
            <div className="visual-kicker">// A PRACTICAL, CURIOUS APPROACH</div>
            <h2>{scene.title}</h2>
            <div className="visual-terminal">
              <div><span className="terminal-prompt">morgan@portfolio</span>:<span className="terminal-path">~</span>$ {scene.code}</div>
              <div className="terminal-line"><span aria-hidden="true">›</span> Observe carefully. Respond thoughtfully.</div>
              <div className="terminal-line"><span aria-hidden="true">›</span> Always learn, document, and improve.</div>
            </div>
            <div className="visual-readout">
              {scene.readout.map(([label, value]) => (
                <div key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
          </m.div>
        </AnimatePresence>
        <div className="visual-window-footer">
          <span>NAIROBI, KE <span aria-hidden="true">·</span> EAT</span>
          <span>PORTFOLIO // 2026</span>
        </div>
      </div>
      <div className="floating-chip chip-bottom"><span className="spark-icon" aria-hidden="true">✳</span> Curious by nature</div>
      <div className="visual-pagination" aria-label="Portfolio illustration">
        {scenes.map((item, index) => (
          <button
            key={item.label}
            className={index === active ? "active" : ""}
            type="button"
            onClick={() => setActive(index)}
            aria-label={`Show ${item.label.toLowerCase()} illustration`}
            aria-pressed={index === active}
          />
        ))}
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
  return (
    <>
      <section className="home-hero page-container" aria-labelledby="home-title">
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
