"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { m, useMotionValue, useReducedMotion, useSpring } from "framer-motion";
import { Award, Check, X } from "lucide-react";
import type { CredentialBadge, PortfolioBadge } from "@/data/badges";
import { portfolioBadgeDrafts } from "@/data/badges";
import { useMotionPreference } from "@/components/MotionPreference";

const BADGE_REVEAL_STAGGER_MS = 60;
const BADGE_TILT_DEGREES = 6;
const BADGE_MEANING_MAX_LENGTH = 110;
const BADGE_REVEAL_THRESHOLD = 0.18;

type TechnologyLogo = {
  name: string;
  logo: string;
  category: string;
};

const TECHNOLOGY_LOGOS: TechnologyLogo[] = [
  { name: "JavaScript", logo: "javascript/javascript-original.svg", category: "Language" },
  { name: "TypeScript", logo: "typescript/typescript-original.svg", category: "Language" },
  { name: "Python", logo: "python/python-original.svg", category: "Language" },
  { name: "React", logo: "react/react-original.svg", category: "Frontend" },
  { name: "Node.js", logo: "nodejs/nodejs-original.svg", category: "Backend" },
  { name: "Next.js", logo: "nextjs/nextjs-original.svg", category: "Frontend" },
  { name: "HTML5", logo: "html5/html5-original.svg", category: "Web" },
  { name: "CSS3", logo: "css3/css3-original.svg", category: "Web" },
  { name: "Tailwind CSS", logo: "tailwindcss/tailwindcss-original.svg", category: "Frontend" },
  { name: "PostgreSQL", logo: "postgresql/postgresql-original.svg", category: "Database" },
  { name: "Supabase", logo: "supabase/supabase-original.svg", category: "Database" },
  { name: "Linux", logo: "linux/linux-original.svg", category: "Systems" },
  { name: "Git", logo: "git/git-original.svg", category: "Tools" },
  { name: "GitHub", logo: "github/github-original.svg", category: "Tools" },
  { name: "AWS", logo: "amazonwebservices/amazonwebservices-original.svg", category: "Cloud" },
  { name: "Vercel", logo: "vercel/vercel-original.svg", category: "Deployment" },
];

const DEVICON_BASE = "https://cdn.jsdelivr.net/gh/devicons/devicon@v2.16.0/icons/";

const BADGE_FILTERS = [
  { id: "all", label: "All" },
  { id: "specialization", label: "Specializations" },
  { id: "framework", label: "Frameworks" },
  { id: "credential", label: "Credentials" },
] as const;

type BadgeFilter = (typeof BADGE_FILTERS)[number]["id"];

type PublishedCertificate = {
  id: string;
  title: string;
  category: "Certificates";
  description: string;
  issuedDate: string | null;
  verifyUrl: string | null;
  fileAvailable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCertificateList(value: unknown): value is PublishedCertificate[] {
  return Array.isArray(value) && value.every((item: unknown) =>
    isRecord(item)
    && typeof item.id === "string"
    && typeof item.title === "string"
    && item.category === "Certificates"
    && typeof item.description === "string"
    && (item.issuedDate === null || typeof item.issuedDate === "string")
    && (item.verifyUrl === null
      || (typeof item.verifyUrl === "string" && item.verifyUrl.startsWith("https://")))
    && typeof item.fileAvailable === "boolean",
  );
}

function clipMeaning(value: string) {
  const meaning = value.trim();
  return meaning.length > BADGE_MEANING_MAX_LENGTH
    ? `${meaning.slice(0, BADGE_MEANING_MAX_LENGTH - 1).trimEnd()}…`
    : meaning;
}

function toCredentialBadge(document: PublishedCertificate): CredentialBadge {
  return {
    id: `credential-${document.id}`,
    kind: "credential",
    title: document.title,
    meaning: clipMeaning(document.description || "Published certificate in the portfolio."),
    status: "earned",
    issuedDate: document.issuedDate,
    verifyUrl: document.verifyUrl,
    evidenceHref: document.fileAvailable
      ? `/api/documents/${encodeURIComponent(document.id)}/file`
      : "/documents",
    evidenceLabel: document.fileAvailable ? "View published certificate" : "View published certificates",
    icon: Award,
  };
}

function statusLabel(badge: PortfolioBadge) {
  if (badge.status === "earned") return "Earned";
  return badge.status === "applied" ? "Applied" : "Studying";
}

function BadgeCard({
  badge,
  index,
  unlocked,
  motionEnabled,
  onOpen,
  registerButton,
}: {
  badge: PortfolioBadge;
  index: number;
  unlocked: boolean;
  motionEnabled: boolean;
  onOpen: (badge: PortfolioBadge) => void;
  registerButton: (id: string, button: HTMLButtonElement | null) => void;
}) {
  const Icon = badge.icon;
  const tiltX = useMotionValue(0);
  const tiltY = useMotionValue(0);
  const springX = useSpring(tiltX, { stiffness: 220, damping: 24, mass: 0.45 });
  const springY = useSpring(tiltY, { stiffness: 220, damping: 24, mass: 0.45 });

  const resetTilt = useCallback(() => {
    tiltX.set(0);
    tiltY.set(0);
  }, [tiltX, tiltY]);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (!motionEnabled
      || event.pointerType !== "mouse"
      || !window.matchMedia("(pointer: fine)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
    const vertical = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    tiltX.set((0.5 - vertical) * BADGE_TILT_DEGREES * 2);
    tiltY.set((horizontal - 0.5) * BADGE_TILT_DEGREES * 2);
  }, [motionEnabled, tiltX, tiltY]);

  const unlockedStyle: CSSProperties = {
    animationDelay: `${Math.min(index, portfolioBadgeDrafts.length) * BADGE_REVEAL_STAGGER_MS}ms`,
  };

  return (
    <div
      className={`badge-card-shell${unlocked ? " is-unlocked" : ""}${motionEnabled ? "" : " motion-off"}`}
      data-badge-id={badge.id}
      data-badge-kind={badge.kind}
      style={unlockedStyle}
    >
      <m.button
        ref={(button) => registerButton(badge.id, button)}
        className="badge-card"
        type="button"
        aria-label={`${badge.title}, ${statusLabel(badge)}`}
        onClick={() => onOpen(badge)}
        onPointerMove={handlePointerMove}
        onPointerLeave={resetTilt}
        onPointerCancel={resetTilt}
        style={{ rotateX: springX, rotateY: springY }}
      >
        <span className="badge-art">
          <svg className="badge-emblem" viewBox="0 0 128 128" focusable="false" aria-hidden="true">
            <path d="M64 5 116 35v58l-52 30L12 93V35L64 5Z" />
            <path className="badge-emblem-inner" d="m64 16 42 24v48l-42 24-42-24V40l42-24Z" />
          </svg>
          <Icon className="badge-emblem-icon" size={34} strokeWidth={1.6} aria-hidden="true" />
          {badge.kind === "credential" ? (
            <span className="badge-emblem-check"><Check size={12} strokeWidth={2.5} aria-hidden="true" /></span>
          ) : null}
        </span>
        <span className="badge-title">{badge.title}</span>
        <span className="badge-status">{statusLabel(badge)}</span>
      </m.button>
    </div>
  );
}

export default function BadgesSection() {
  const { preference } = useMotionPreference();
  const reducedMotion = Boolean(useReducedMotion());
  const motionEnabled = preference === "auto" && !reducedMotion;
  const [credentials, setCredentials] = useState<CredentialBadge[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<BadgeFilter>("all");
  const [selectedBadge, setSelectedBadge] = useState<PortfolioBadge | null>(null);
  const [unlockedIds, setUnlockedIds] = useState<Set<string>>(() => new Set());
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const badgeButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const badges = useMemo<PortfolioBadge[]>(
    () => [...portfolioBadgeDrafts, ...credentials],
    [credentials],
  );
  const visibleBadges = selectedFilter === "all"
    ? badges
    : badges.filter((badge) => badge.kind === selectedFilter);
  const tabs = credentials.length
    ? BADGE_FILTERS
    : BADGE_FILTERS.filter((filter) => filter.id !== "credential");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/documents?category=Certificates", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Published certificates could not be loaded.");
        const data: unknown = await response.json();
        if (!isCertificateList(data)) throw new Error("The certificate service returned an unexpected response.");
        setCredentials(data.map(toCredentialBadge));
      })
      .catch(() => {
        if (!controller.signal.aborted) setCredentials([]);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    if (!motionEnabled) return;
    if (typeof IntersectionObserver === "undefined") {
      grid.dataset.revealFallback = "true";
      return () => { delete grid.dataset.revealFallback; };
    }
    delete grid.dataset.revealFallback;

    const observer = new IntersectionObserver((entries) => {
      const unlocked = entries
        .filter((entry) => entry.isIntersecting)
        .map((entry) => (entry.target as HTMLElement).dataset.badgeId)
        .filter((id): id is string => Boolean(id));
      if (!unlocked.length) return;
      setUnlockedIds((current) => new Set([...current, ...unlocked]));
      entries.forEach((entry) => {
        if (entry.isIntersecting) observer.unobserve(entry.target);
      });
    }, { threshold: BADGE_REVEAL_THRESHOLD });

    grid.querySelectorAll<HTMLElement>("[data-badge-id]").forEach((element) => {
      if (!unlockedIds.has(element.dataset.badgeId ?? "")) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [badges, motionEnabled, unlockedIds]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (selectedBadge && dialog && !dialog.open) dialog.showModal();
  }, [selectedBadge]);

  const registerButton = useCallback((id: string, button: HTMLButtonElement | null) => {
    if (button) badgeButtonRefs.current.set(id, button);
    else badgeButtonRefs.current.delete(id);
  }, []);

  const closeDialog = () => {
    const badgeId = selectedBadge?.id;
    setSelectedBadge(null);
    if (badgeId) window.requestAnimationFrame(() => badgeButtonRefs.current.get(badgeId)?.focus());
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    tabRefs.current[nextIndex]?.focus();
    setSelectedFilter(tabs[nextIndex].id);
  };

  const dialogTitleId = "badge-dialog-title";

  return (
    <section className="badge-section" id="badges" aria-labelledby="badges-title">
      <div className="page-container">
        <header className="badge-section-heading">
          <div>
            <p className="eyebrow">BADGES</p>
            <h2 id="badges-title">Focus areas and frameworks.</h2>
          </div>
          <p>Specializations, frameworks I study, and any published credentials.</p>
        </header>
        <section className="technology-logo-section" aria-labelledby="technology-logo-title">
          <div className="technology-logo-heading">
            <div>
              <p className="eyebrow">TECHNOLOGY STACK</p>
              <h3 id="technology-logo-title">Tools behind the work.</h3>
            </div>
            <p>Recognisable technology logos, with names for quick scanning.</p>
          </div>
          <div className="technology-logo-grid">
            {TECHNOLOGY_LOGOS.map((technology) => (
              <div className="technology-logo-card" key={technology.name} title={technology.category}>
                <span className="technology-logo-image">
                  <img
                    src={`${DEVICON_BASE}${technology.logo}`}
                    alt=""
                    width={40}
                    height={40}
                    loading="lazy"
                    decoding="async"
                  />
                </span>
                <span className="technology-logo-name">{technology.name}</span>
                <span className="technology-logo-category">{technology.category}</span>
              </div>
            ))}
          </div>
        </section>
        <div className="badge-tabs" role="tablist" aria-label="Filter badges">
          {tabs.map((tab, index) => (
            <button
              ref={(button) => { tabRefs.current[index] = button; }}
              key={tab.id}
              id={`badge-tab-${tab.id}`}
              className={selectedFilter === tab.id ? "badge-tab selected" : "badge-tab"}
              type="button"
              role="tab"
              aria-selected={selectedFilter === tab.id}
              aria-controls="badge-panel"
              tabIndex={selectedFilter === tab.id ? 0 : -1}
              onClick={() => setSelectedFilter(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div
          ref={gridRef}
          id="badge-panel"
          className="badge-grid"
          role="tabpanel"
          aria-labelledby={`badge-tab-${selectedFilter}`}
          tabIndex={0}
        >
          {visibleBadges.map((badge, index) => (
            <BadgeCard
              key={badge.id}
              badge={badge}
              index={index}
              unlocked={unlockedIds.has(badge.id)}
              motionEnabled={motionEnabled}
              onOpen={setSelectedBadge}
              registerButton={registerButton}
            />
          ))}
        </div>
        <p className="badge-framework-note">
          Framework badges show topics I study or apply. They are not certifications and are not affiliated with or endorsed by the organisations that publish these frameworks.
        </p>
      </div>
      <dialog
        ref={dialogRef}
        className="badge-dialog"
        aria-labelledby={dialogTitleId}
        onClose={closeDialog}
      >
        {selectedBadge ? (
          <div className="badge-dialog-content" data-badge-kind={selectedBadge.kind}>
            <button
              className="badge-dialog-close"
              type="button"
              aria-label="Close badge details"
              onClick={() => dialogRef.current?.close()}
            >
              <X size={18} aria-hidden="true" />
            </button>
            <p className="eyebrow">{selectedBadge.kind.toUpperCase()}</p>
            <h2 id={dialogTitleId}>{selectedBadge.title}</h2>
            <p className="badge-dialog-meaning">{selectedBadge.meaning}</p>
            <p className="badge-dialog-status"><span>Status</span><strong>{statusLabel(selectedBadge)}</strong></p>
            {selectedBadge.kind === "credential" && selectedBadge.issuedDate ? (
              <p className="badge-dialog-status"><span>Issued</span><strong>{selectedBadge.issuedDate}</strong></p>
            ) : null}
            {selectedBadge.evidenceHref ? (
              <a className="badge-dialog-link" href={selectedBadge.evidenceHref}>
                {selectedBadge.evidenceLabel}
              </a>
            ) : null}
            {selectedBadge.kind === "credential" && selectedBadge.verifyUrl ? (
              <a className="badge-dialog-link" href={selectedBadge.verifyUrl} target="_blank" rel="noopener noreferrer">
                Verify credential <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
