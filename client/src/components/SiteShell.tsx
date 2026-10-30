"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { ArrowUp, Command, Menu, Search, SunMoon, X } from "lucide-react";
import { publicPages } from "@/data/site";
import { profile } from "@/data/profile";

const analyticsPages = new Set([
  "home", "about", "skills", "experience", "projects", "education", "certifications",
  "timeline", "achievements", "blog", "gallery", "services", "writeups", "inventions",
  "cheatsheets", "ctfs", "assignments", "documents", "triage", "leaderboard", "contact", "privacy",
]);
let analyticsWarningShown = false;

function recordAnalytics(event: "page_view" | "github_click" | "linkedin_click" | "email_click", page: string) {
  void fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, page }),
    keepalive: true,
  }).then((response) => {
    if (!response.ok) throw new Error(`Analytics request failed (${response.status}).`);
  }).catch((error: unknown) => {
    if (!analyticsWarningShown) {
      console.warn("Aggregate portfolio analytics were not recorded.", error);
      analyticsWarningShown = true;
    }
  });
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isLight = resolvedTheme === "light";

  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      onClick={() => setTheme(isLight ? "dark" : "light")}
      aria-label="Toggle light and dark theme"
      title="Toggle light and dark theme"
    >
      <SunMoon size={16} aria-hidden="true" />
    </button>
  );
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? publicPages.filter((page) => `${page.label} ${page.description} ${page.href}`.toLowerCase().includes(normalized))
      : publicPages.slice(0, 8);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href]");
        const first = focusable.item(0);
        const last = focusable.item(focusable.length - 1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="palette-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby="palette-title">
        <div className="palette-search">
          <Search size={19} aria-hidden="true" />
          <label className="sr-only" id="palette-title" htmlFor="palette-input">Search portfolio pages</label>
          <input
            id="palette-input"
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages, projects, and topics…"
            autoComplete="off"
          />
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close search">
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <p className="palette-caption">{query ? `${results.length} matching pages` : "QUICK NAVIGATION"}</p>
        <ul className="palette-results">
          {results.map((page) => (
            <li key={page.href}>
              <Link href={page.href} onClick={onClose}>
                <span>{page.label}</span>
                <small>{page.description}</small>
                <span className="palette-shortcut" aria-hidden="true">↵</span>
              </Link>
            </li>
          ))}
          {results.length === 0 && <li className="palette-empty">No matching pages. Try a different search.</li>}
        </ul>
        <div className="palette-hint"><kbd>ESC</kbd> to close <span><kbd>Ctrl</kbd> <kbd>K</kbd> to search</span></div>
      </section>
    </div>
  );
}

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [compact, setCompact] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [showTop, setShowTop] = useState(false);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const exploreRef = useRef<HTMLDivElement>(null);
  const exploreButtonRef = useRef<HTMLButtonElement>(null);
  const drawerStartRef = useRef<{ x: number; y: number; time: number; lastX: number; lastY: number; lastTime: number } | null>(null);
  const closeExplore = useCallback((restoreFocus = false) => {
    setExploreOpen(false);
    if (restoreFocus) requestAnimationFrame(() => exploreButtonRef.current?.focus());
  }, []);
  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    requestAnimationFrame(() => searchButtonRef.current?.focus());
  }, []);
  const finishDrawerSwipe = (x: number, y: number, time: number) => {
    const start = drawerStartRef.current;
    drawerStartRef.current = null;
    if (!start) return;
    const horizontalDistance = Math.abs(x - start.x);
    const verticalDistance = Math.abs(y - start.y);
    const elapsed = time - start.time;
    const fastFlick = Math.abs(x - start.lastX) >= 20 && time - start.lastTime <= 120;
    if (horizontalDistance > verticalDistance
      && (horizontalDistance >= 60 || (horizontalDistance >= 30 && elapsed <= 180) || fastFlick)) closeExplore(true);
  };

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const progress = scrollable > 0 ? window.scrollY / scrollable : 0;
        document.documentElement.style.setProperty("--scroll-progress", String(Math.min(1, progress)));
        setCompact(window.scrollY > 36);
        setShowTop(window.scrollY > 420);
      });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => {
          if (open) requestAnimationFrame(() => searchButtonRef.current?.focus());
          return !open;
        });
      }
      if (event.key === "Escape") {
        if (paletteOpen) closePalette();
        closeExplore(exploreRef.current?.contains(document.activeElement) ?? false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !exploreRef.current?.contains(event.target)) closeExplore();
    };

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [closeExplore, closePalette, paletteOpen]);

  useEffect(() => {
    if (!exploreOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !window.matchMedia("(max-width: 800px)").matches) return;
      const menu = exploreRef.current?.querySelector("nav");
      if (!menu) return;
      const focusable = [exploreButtonRef.current, ...menu.querySelectorAll<HTMLElement>("a[href]")].filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exploreOpen]);

  useEffect(() => {
    if (pathname) {
      document.documentElement.scrollTo({ top: 0, behavior: "instant" });
      if (pathname === "/admin") return;
      const page = pathname === "/" ? "home" : pathname.slice(1);
      if (analyticsPages.has(page)) recordAnalytics("page_view", page);
    }
  }, [pathname]);

  useEffect(() => {
    const trackOutboundLinks = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a");
      const href = link?.getAttribute("href")?.toLowerCase();
      if (!href) return;
      const page = pathname === "/" ? "home" : pathname.slice(1);
      if (!analyticsPages.has(page)) return;
      if (href.startsWith("mailto:")) recordAnalytics("email_click", page);
      else if (href.includes("github.com")) recordAnalytics("github_click", page);
      else if (href.includes("linkedin.com")) recordAnalytics("linkedin_click", page);
    };
    document.addEventListener("click", trackOutboundLinks);
    return () => document.removeEventListener("click", trackOutboundLinks);
  }, [pathname]);

  const isAdmin = pathname === "/admin" || pathname?.startsWith("/admin/") === true;

  return (
    <div className="modern-site">
      {!isAdmin && (
        <header className={`site-nav ${compact ? "site-nav-compact" : ""}`}>
          <Link className="brand" href="/" aria-label="Morgan West Oketch, home">
            <span className="brand-mark" aria-hidden="true">M<span>W</span></span>
            <span className="brand-name">MORGAN OKETCH<small>CYBERSECURITY · SYSTEMS · DATA</small></span>
          </Link>
          <nav className="primary-nav" aria-label="Primary navigation">
            <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Home</Link>
            <Link href="/about" aria-current={pathname === "/about" ? "page" : undefined}>About</Link>
            <Link href="/skills" aria-current={pathname === "/skills" ? "page" : undefined}>Skills</Link>
            <Link href="/projects" aria-current={pathname === "/projects" ? "page" : undefined}>Projects</Link>
            <Link className="nav-contact" href="/contact" aria-current={pathname === "/contact" ? "page" : undefined}>Contact <span aria-hidden="true">↗</span></Link>
            <div className={`nav-explore ${exploreOpen ? "nav-explore-open" : ""}`} ref={exploreRef}>
              <button
                ref={exploreButtonRef}
                className="nav-explore-trigger"
                type="button"
                aria-label={exploreOpen ? "Close all portfolio pages" : "Open all portfolio pages"}
                aria-expanded={exploreOpen}
                aria-controls="portfolio-pages-menu"
                onClick={() => setExploreOpen((open) => !open)}
              >
                <span className="nav-explore-label">Explore <span aria-hidden="true">⌄</span></span>
                {exploreOpen ? <X className="nav-hamburger" size={18} aria-hidden="true" /> : <Menu className="nav-hamburger" size={18} aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="nav-drawer-backdrop"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => closeExplore(true)}
              />
              <nav
                id="portfolio-pages-menu"
                aria-label="Explore all pages"
                aria-hidden={!exploreOpen}
                inert={!exploreOpen}
                onPointerDown={(event) => {
                  if (event.pointerType === "mouse") return;
                  const time = performance.now();
                  drawerStartRef.current = {
                    x: event.clientX,
                    y: event.clientY,
                    time,
                    lastX: event.clientX,
                    lastY: event.clientY,
                    lastTime: time,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  const start = drawerStartRef.current;
                  if (start) {
                    start.lastX = event.clientX;
                    start.lastY = event.clientY;
                    start.lastTime = performance.now();
                  }
                }}
                onPointerUp={(event) => {
                  finishDrawerSwipe(event.clientX, event.clientY, performance.now());
                }}
                onPointerCancel={() => {
                  const start = drawerStartRef.current;
                  if (start) finishDrawerSwipe(start.lastX, start.lastY, start.lastTime);
                }}
              >
                <div className="nav-pages-inner">
                  {publicPages.slice(5).map((page) => (
                    <Link key={page.href} href={page.href} onClick={() => closeExplore()} aria-current={pathname === page.href ? "page" : undefined}>
                      {page.label}<small>{page.description}</small>
                    </Link>
                  ))}
                  <Link href="/privacy" onClick={() => closeExplore()} aria-current={pathname === "/privacy" ? "page" : undefined}>Privacy<small>Privacy and data practices</small></Link>
                </div>
              </nav>
            </div>
          </nav>
          <div className="nav-actions">
            <button ref={searchButtonRef} className="search-trigger" type="button" onClick={() => setPaletteOpen(true)} aria-label="Search portfolio pages">
              <Command size={15} aria-hidden="true" /><span>Search</span><kbd>Ctrl K</kbd>
            </button>
            <ThemeToggle />
          </div>
        </header>
      )}
      {!isAdmin && <div className="scroll-progress" aria-hidden="true" />}
      <main id="main-content" tabIndex={-1}>{children}</main>
      {!isAdmin && (
        <footer className="site-footer">
          <Link className="brand footer-brand" href="/">
            <span className="brand-mark" aria-hidden="true">M<span>W</span></span>
            <span className="brand-name">MORGAN OKETCH<small>CYBERSECURITY · SYSTEMS · DATA</small></span>
          </Link>
          <p>Built with curiosity, care, and a security-first mindset.</p>
          <nav aria-label="Footer navigation">
            <Link href="/privacy">Privacy</Link>
            <Link href="/contact">Contact</Link>
            <a href={profile.github} target="_blank" rel="noreferrer">GitHub <span className="sr-only">(opens in a new tab)</span></a>
          </nav>
          <small className="copyright">© {new Date().getFullYear()} Morgan West Oketch</small>
        </footer>
      )}
      {!isAdmin && (
        <div className="floating-tools">
          {showTop && (
            <button
              className="icon-button top-button"
              type="button"
              onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}
              aria-label="Back to top"
              title="Back to top"
            >
              <ArrowUp size={17} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      {paletteOpen && <CommandPalette onClose={closePalette} />}
    </div>
  );
}
