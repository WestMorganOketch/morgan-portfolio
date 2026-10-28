"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, animate, motion, useInView, useMotionValue, useMotionValueEvent, useTransform } from "framer-motion";
import { ArrowDown, ArrowRight, ArrowUpRight, Code2, Mail } from "lucide-react";
import { profile } from "@/data/profile";

const roles = [
  "Cybersecurity Analyst",
  "SOC Analyst",
  "IT Support Specialist",
  "Network Security Enthusiast",
  "Data & Systems Professional",
  "Full-Stack Developer",
  "Problem Solver",
];

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

  useEffect(() => {
    const timer = window.setInterval(() => setActive((index) => (index + 1) % scenes.length), 6500);
    return () => window.clearInterval(timer);
  }, []);

  const scene = scenes[active];
  return (
    <div className={`hero-visual scene-${active}`} aria-label={`Animated portfolio illustration: ${scene.label.toLowerCase()}`}>
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
          <motion.div
            className="visual-window-body"
            key={scene.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
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
          </motion.div>
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
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % roles.length), 2800);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="animated-role" aria-label={roles[index]}>
      <AnimatePresence mode="wait">
        <motion.span
          key={roles[index]}
          initial={{ opacity: 0, y: 9 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -9 }}
          transition={{ duration: 0.2 }}
        >{roles[index]}</motion.span>
      </AnimatePresence>
      <span className="typing-caret" aria-hidden="true" />
    </span>
  );
}

function AnimatedCount({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref, { once: true });
  const count = useMotionValue(0);
  const rounded = useTransform(count, Math.round);
  const [displayed, setDisplayed] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(count, value, { duration: 1.2, ease: "easeOut" });
    return () => controls.stop();
  }, [count, inView, value]);

  useMotionValueEvent(rounded, "change", setDisplayed);

  return <strong ref={ref}>{displayed}{suffix}</strong>;
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
            <article><span>01 / EXPERIENCE</span><AnimatedCount value={50} suffix="+" /><p>users supported in a volunteer IT lab</p></article>
            <article><span>02 / PROJECTS</span><AnimatedCount value={2} /><p>hands-on security and development projects</p></article>
            <article><span>03 / TRAINING</span><AnimatedCount value={5} /><p>completed professional learning programs</p></article>
            <article><span>04 / EDUCATION</span><strong>2026</strong><p>expected BSc graduation year</p></article>
          </div>
        </div>
      </section>
    </>
  );
}
