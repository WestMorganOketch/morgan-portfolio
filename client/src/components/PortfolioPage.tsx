"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight, ArrowUpRight, Award, BookOpen, BriefcaseBusiness, Check, Code2,
  Database, GraduationCap, Network, Server, Shield, Sparkles, Users,
} from "lucide-react";
import { profile } from "@/data/profile";
import { details, skillGroups, timeline } from "@/data/site";
import ContactForm from "@/components/ContactForm";
import AlertTriageGame from "@/components/AlertTriageGame";
import DocumentVault from "@/components/DocumentVault";
import Leaderboard from "@/components/Leaderboard";

const icons = { shield: Shield, network: Network, code: Code2, server: Server, users: Users };

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

function PageIntro({ slug }: { slug: string }) {
  const page = details[slug];
  return (
    <div className="page-intro page-container">
      <p className="eyebrow"><span className="status-indicator" /> {page.eyebrow}</p>
      <h1>{page.title}</h1>
      <p className="page-lede">{page.intro}</p>
      <div className="intro-rule"><span /></div>
    </div>
  );
}

function AboutContent() {
  return (
    <div className="content-grid about-detail-grid">
      <Reveal><article className="content-card about-statement"><span className="card-index">01 / PROFILE</span><p className="display-copy">{profile.summary}</p></article></Reveal>
      <Reveal delay={0.08}><div className="detail-stack">
        <article className="content-card"><GraduationCap size={19} /><span className="card-index">EDUCATION</span><h2>{profile.education.qualification}</h2><p>{profile.education.institution} · {profile.education.status}</p></article>
        <article className="content-card"><Shield size={19} /><span className="card-index">FOCUS</span><h2>Security, systems &amp; people</h2><p>Practical cybersecurity, IT support, networking, data, and secure web development.</p></article>
        <article className="content-card"><Sparkles size={19} /><span className="card-index">APPROACH</span><h2>Evidence before assumptions</h2><p>Curiosity, clear communication, responsible practice, and continuous learning.</p></article>
      </div></Reveal>
    </div>
  );
}

function SkillsContent() {
  const [selected, setSelected] = useState("All");
  const groups = selected === "All" ? skillGroups : skillGroups.filter((group) => group.name === selected);
  return (
    <>
      <div className="filter-row" aria-label="Filter skills by category">
        <span className="filter-label">FILTER BY DOMAIN</span>
        {["All", ...skillGroups.map((group) => group.name)].map((group) => (
          <button key={group} type="button" className={selected === group ? "filter-chip selected" : "filter-chip"} onClick={() => setSelected(group)} aria-pressed={selected === group}>{group}</button>
        ))}
      </div>
      <div className="skill-group-grid">
        {groups.map((group, index) => {
          const Icon = icons[group.icon];
          return (
            <Reveal key={group.name} delay={index * 0.04}>
              <section className="skill-group-card" aria-labelledby={`skill-${index}`}>
                <div className="skill-group-title"><span className="icon-tile"><Icon size={18} aria-hidden="true" /></span><div><p className="card-index">{String(index + 1).padStart(2, "0")} / DOMAIN</p><h2 id={`skill-${index}`}>{group.name}</h2></div></div>
                <ul className="skill-list">
                  {group.skills.map(([name, description, level]) => (
                    <li key={name}><div className="skill-row"><strong>{name}</strong><span className={`level-pill level-${level.toLowerCase().replaceAll(" ", "-")}`}>{level}</span></div><p>{description}</p></li>
                  ))}
                </ul>
              </section>
            </Reveal>
          );
        })}
      </div>
    </>
  );
}

type DisplayProject = {
  id: string;
  title: string;
  period: string;
  description: string;
  tags: string[];
  writeup?: string;
  challenges?: string;
  solutions?: string;
  architecture?: string;
  futureImprovements?: string;
  url?: string | null;
  demoUrl?: string | null;
  source?: "Morgan's portfolio" | "GitHub";
};

function safeProjectList(value: unknown): value is DisplayProject[] {
  return Array.isArray(value) && value.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const row = item as Record<string, unknown>;
    return typeof row.title === "string" && typeof row.period === "string"
      && typeof row.description === "string"
      && Array.isArray(row.tags) && row.tags.every((tag) => typeof tag === "string")
      && ["writeup", "challenges", "solutions", "architecture", "futureImprovements"].every((key) => row[key] === undefined || typeof row[key] === "string")
      && (row.url === null || row.url === undefined || (typeof row.url === "string" && row.url.startsWith("https://")))
      && (row.demoUrl === null || row.demoUrl === undefined || (typeof row.demoUrl === "string" && row.demoUrl.startsWith("https://")));
  });
}

function ProjectsContent() {
  const seedProjects: DisplayProject[] = profile.projects.map((project, index) => ({
    ...project,
    id: `featured-${index + 1}`,
    source: "Morgan's portfolio",
  }));
  const [projects, setProjects] = useState<DisplayProject[]>(seedProjects);
  const [githubProjects, setGithubProjects] = useState<DisplayProject[]>([]);
  const [filter, setFilter] = useState("All");
  const [databaseNotice, setDatabaseNotice] = useState("");
  const [githubNotice, setGithubNotice] = useState("Loading public repositories…");

  useEffect(() => {
    let active = true;
    const wakeTimer = setTimeout(() => {
      if (active) setDatabaseNotice("Waking up the projects server. The first request on free hosting can take about a minute.");
    }, 4000);
    void fetch("/api/projects", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("The project database is not connected.");
        const data: unknown = await response.json();
        if (!safeProjectList(data)) throw new Error("The project service returned an unexpected response.");
        clearTimeout(wakeTimer);
        if (active) {
          setDatabaseNotice("");
          if (data.length) setProjects(data.map((item) => ({ ...item, source: "Morgan's portfolio" })));
        }
      })
      .catch((error: unknown) => {
        clearTimeout(wakeTimer);
        if (active) setDatabaseNotice(error instanceof Error ? "Live project management is not connected yet; these featured projects remain visible." : "Live project management is not connected yet.");
      });
    void fetch("https://api.github.com/users/WestMorganOketch/repos?sort=updated&per_page=30&type=owner", {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("GitHub repositories could not be loaded right now.");
        const data: unknown = await response.json();
        if (!Array.isArray(data)) throw new Error("GitHub returned an unexpected response.");
        const repositories = data.flatMap((repo: unknown) => {
          if (typeof repo !== "object" || repo === null) return [];
          const row = repo as Record<string, unknown>;
          if (row.fork === true || typeof row.name !== "string" || typeof row.html_url !== "string"
            || !row.html_url.startsWith("https://github.com/WestMorganOketch/")) return [];
          return [{
            id: `github-${row.id ?? row.name}`,
            title: row.name,
            period: typeof row.updated_at === "string" ? new Date(row.updated_at).toLocaleDateString("en", { month: "short", year: "numeric" }) : "GitHub repository",
            description: typeof row.description === "string" && row.description.trim() ? row.description : "Public project repository. See GitHub for the source and documentation.",
            tags: [typeof row.language === "string" ? row.language : "GitHub"],
            url: row.html_url,
            source: "GitHub" as const,
          }];
        });
        if (active) {
          setGithubProjects(repositories);
          setGithubNotice(repositories.length ? "" : "No public repositories are available to feature yet.");
        }
      })
      .catch((error: unknown) => {
        if (active) setGithubNotice(error instanceof Error ? error.message : "GitHub repositories could not be loaded right now.");
      });
    return () => {
      active = false;
      clearTimeout(wakeTimer);
    };
  }, []);

  const allProjects = useMemo(() => [...projects, ...githubProjects], [projects, githubProjects]);
  const filtered = filter === "All"
    ? allProjects
    : filter === "GitHub"
      ? allProjects.filter((project) => project.source === "GitHub")
      : allProjects.filter((project) => project.tags.some((tag) => tag.toLowerCase().includes(filter.toLowerCase())));
  const filters = ["All", "Cybersecurity", "Web", "GitHub"];
  const caseStudyFields = [
    ["Project write-up", "writeup"],
    ["Challenges", "challenges"],
    ["Solutions", "solutions"],
    ["Architecture", "architecture"],
    ["Future improvements", "futureImprovements"],
  ] as const;

  return (
    <>
      <div className="filter-row" aria-label="Filter projects">
        <span className="filter-label">EXPLORE THE WORK</span>
        {filters.map((option) => <button key={option} type="button" className={filter === option ? "filter-chip selected" : "filter-chip"} onClick={() => setFilter(option)} aria-pressed={filter === option}>{option}</button>)}
      </div>
      {databaseNotice && <p className="inline-note" role="status">{databaseNotice}</p>}
      <div className="project-card-grid">
        {filtered.map((project, index) => (
          <Reveal key={project.id} delay={index * 0.04}>
            <article className="project-card">
              <div className="project-art"><span className="project-art-mark" aria-hidden="true"><Code2 size={29} /></span><span className="card-index">{project.source === "GitHub" ? "PUBLIC REPOSITORY" : "CASE STUDY"}</span><span className="project-year">{project.period}</span></div>
              <div className="project-card-content">
                <div className="project-card-title"><h2>{project.title}</h2>{project.url && <a href={project.url} target="_blank" rel="noreferrer" aria-label={`View ${project.title} on GitHub`}><ArrowUpRight size={17} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>}</div>
                <p>{project.description}</p>
                {caseStudyFields.map(([label, key]) => {
                  const text = project[key];
                  return text ? <details className="project-details" key={key}><summary>{label}</summary><p>{text}</p></details> : null;
                })}
                <ul className="tag-list" aria-label="Technologies">{project.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
                {(project.url?.startsWith("https://") || project.demoUrl?.startsWith("https://")) && (
                  <div className="project-links">
                    {project.url?.startsWith("https://") && <a href={project.url} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>}
                    {project.demoUrl?.startsWith("https://") && <a href={project.demoUrl} target="_blank" rel="noreferrer">Live demo <ArrowUpRight size={13} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>}
                  </div>
                )}
              </div>
            </article>
          </Reveal>
        ))}
      </div>
      <div className="github-loading-note" role="status">
        {githubNotice && <p>{githubNotice}</p>}
        <a className="text-link" href={profile.github} target="_blank" rel="noreferrer">Explore all public repositories <ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>
      </div>
    </>
  );
}

function ExperienceContent() {
  return (
    <div className="experience-grid">
      {profile.experience.map((item, index) => (
        <Reveal key={item.role} delay={index * 0.08}>
          <article className="experience-card">
            <div className="experience-card-top"><span className="icon-tile"><BriefcaseBusiness size={18} aria-hidden="true" /></span><span className="card-index">{item.period}</span></div>
            <h2>{item.role}</h2><p className="experience-org">{item.organization}</p><p>{item.description}</p>
            <ul className="tag-list">{item.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

function EducationContent() {
  return (
    <div className="education-layout">
      <Reveal><article className="education-feature">
        <div className="education-symbol"><GraduationCap size={33} aria-hidden="true" /></div>
        <p className="eyebrow">CURRENT DEGREE · EXPECTED NOV 2026</p>
        <h2>{profile.education.qualification}</h2>
        <p className="education-school">{profile.education.institution}</p>
        <p>{profile.education.location}</p>
        <span className="level-pill">In progress</span>
      </article></Reveal>
      <Reveal delay={0.08}><article className="content-card coursework-card"><span className="card-index">RELEVANT COURSEWORK</span><h2>Details to be added</h2><p>Course titles will be listed here once Morgan confirms the modules he has completed.</p><div className="card-divider" /><p className="muted">Alongside university study: security labs, networking practice, and professional training.</p></article></Reveal>
    </div>
  );
}

function CertificationsContent() {
  return (
    <div className="certification-grid">
      {profile.certifications.map((cert, index) => (
        <Reveal key={cert.name} delay={index * 0.04}>
          <article className="cert-card">
            <div className="cert-icon"><Award size={22} aria-hidden="true" /></div>
            <span className={cert.status === "COMPLETED" ? "status-pill status-complete" : "status-pill status-progress"}>{cert.status === "COMPLETED" ? <><Check size={12} aria-hidden="true" /> Completed</> : "In progress"}</span>
            <h2>{cert.name}</h2><p>{cert.issuer}</p><span className="cert-date">{cert.date}</span>
            <p className="cert-verification">{cert.status === "COMPLETED" ? "Certificate link not supplied" : "Training in progress — not a certification yet"}</p>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

function TimelineContent() {
  return (
    <ol className="timeline-list">
      {timeline.map((item, index) => (
        <Reveal key={`${item.date}-${item.title}`} delay={index * 0.04}>
          <li className="timeline-item">
            <span className={`timeline-dot timeline-${item.type}`} aria-hidden="true" />
            <div className="timeline-date">{item.date}</div>
            <div className="timeline-content"><span className="card-index">{item.type.toUpperCase()}</span><h2>{item.title}</h2><p className="timeline-org">{item.organization}</p><p>{item.detail}</p></div>
          </li>
        </Reveal>
      ))}
    </ol>
  );
}

function AchievementsContent() {
  return (
    <div className="achievement-grid">
      <Reveal><article className="achievement-card"><div className="achievement-icon"><Users size={22} aria-hidden="true" /></div><span className="card-index">COMMUNITY SUPPORT</span><h2>Supported a 50+ user IT lab</h2><p>Provided hands-on support while volunteering as an ICT Tutor at Profia Institute.</p></article></Reveal>
      <Reveal delay={0.06}><article className="achievement-card"><div className="achievement-icon"><Shield size={22} aria-hidden="true" /></div><span className="card-index">PROFESSIONAL LEARNING</span><h2>Completed Security Analyst training</h2><p>Completed the Security Analyst program with Cyber Shujaa / USIU-Africa.</p></article></Reveal>
      <Reveal delay={0.12}><article className="achievement-card"><div className="achievement-icon"><BookOpen size={22} aria-hidden="true" /></div><span className="card-index">TEACHING</span><h2>Shared practical IT knowledge</h2><p>Delivered cybersecurity and networking learning to students and lab users.</p></article></Reveal>
    </div>
  );
}

function ServicesContent() {
  return (
    <div className="service-grid">
      {profile.services.map((service, index) => <Reveal key={service.number} delay={index * 0.06}><article className="service-card"><span className="card-index">{service.number} / {service.note.toUpperCase()}</span><h2>{service.title}</h2><p>{service.description}</p><Link href="/contact" className="text-link">Discuss a project <ArrowRight size={14} aria-hidden="true" /></Link></article></Reveal>)}
      <p className="scope-note"><Shield size={16} aria-hidden="true" /> Any security testing is limited to systems for which the client has explicit authorization and an agreed written scope.</p>
    </div>
  );
}

type ManagedEntry = {
  id: string;
  title: string;
  period: string;
  description: string;
  body: string;
  tags: string[];
  url: string | null;
};

const managedCategories: Record<string, string> = {
  experience: "experience",
  education: "education",
  certifications: "certifications",
  achievements: "achievements",
  blog: "blog",
  gallery: "gallery",
  services: "services",
  writeups: "writeups",
  inventions: "inventions",
  cheatsheets: "cheatsheets",
  ctfs: "ctfs",
  assignments: "assignments",
  skills: "skills",
};

function isManagedEntryList(value: unknown): value is ManagedEntry[] {
  return Array.isArray(value) && value.every((item: unknown) => {
    if (typeof item !== "object" || item === null) return false;
    const row = item as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.title === "string"
      && typeof row.period === "string" && typeof row.description === "string"
      && typeof row.body === "string" && Array.isArray(row.tags)
      && row.tags.every((tag: unknown) => typeof tag === "string")
      && (row.url === null || typeof row.url === "string");
  });
}

function ManagedContent({ slug }: { slug: string }) {
  const category = managedCategories[slug];
  const [entries, setEntries] = useState<ManagedEntry[]>([]);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const wakeTimer = setTimeout(() => {
      if (active) setNotice("Waking up the portfolio server. Published updates will appear when it is ready.");
    }, 4000);
    void fetch(`/api/content/${category}`, { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Published updates from the portfolio manager are unavailable.");
        const data: unknown = await response.json();
        if (!isManagedEntryList(data)) throw new Error("The portfolio manager returned an unexpected response.");
        clearTimeout(wakeTimer);
        if (active) {
          setNotice("");
          setEntries(data);
        }
      })
      .catch((cause: unknown) => {
        clearTimeout(wakeTimer);
        if (active) setNotice(cause instanceof Error ? cause.message : "Portfolio updates are temporarily unavailable.");
      })
      .finally(() => {
        clearTimeout(wakeTimer);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearTimeout(wakeTimer);
    };
  }, [category]);

  if (!category || (!loading && !entries.length && !notice)) return null;
  return (
    <section className="managed-content" aria-label="Additional portfolio entries">
      {loading && notice ? <p className="inline-note managed-notice" role="status">{notice}</p> : null}
      {!loading && notice ? <p className="inline-note managed-notice" role="status">{notice} The verified profile information above remains available.</p> : null}
      {entries.length ? <div className="managed-content-grid">
        {entries.map((entry) => (
          <article className="managed-entry" key={entry.id}>
            <p className="card-index">{entry.period || "PORTFOLIO UPDATE"}</p>
            <h2>{entry.title}</h2>
            <p>{entry.description}</p>
            {entry.body && <details><summary>Additional details</summary><p>{entry.body}</p></details>}
            {entry.tags.length > 0 && <ul className="tag-list">{entry.tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>}
            {entry.url?.startsWith("https://") && <a className="text-link managed-reference" href={entry.url} target="_blank" rel="noreferrer">Open reference <ArrowUpRight size={13} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>}
          </article>
        ))}
      </div> : null}
    </section>
  );
}

function PlaceholderContent({ slug }: { slug: string }) {
  const page = details[slug];
  const icon = slug === "inventions" ? <Sparkles size={25} /> : slug === "blog" || slug === "writeups" || slug === "cheatsheets" ? <BookOpen size={25} /> : <Database size={25} />;
  return (
    <Reveal><section className="coming-soon-card">
      <span className="coming-soon-icon" aria-hidden="true">{icon}</span>
      <p className="eyebrow">A SPACE TO GROW</p>
      <h2>Carefully curated, not filled with filler.</h2>
      <p>{page.intro}</p>
      {slug === "gallery" && <div className="photo-placeholder" role="img" aria-label="Portrait placeholder; Morgan's photo has not been supplied"><span>PHOTO</span><small>MORGAN'S PHOTO WILL GO HERE</small></div>}
      {slug === "privacy" && <div className="privacy-points"><p><Check size={15} aria-hidden="true" /> Portfolio content is served without visitor accounts.</p><p><Check size={15} aria-hidden="true" /> Aggregate analytics and game scores do not store visitor IP addresses or email addresses.</p><p><Check size={15} aria-hidden="true" /> Contact messages are stored privately with consent and deleted after 90 days.</p><p><Check size={15} aria-hidden="true" /> Public document files are available only after Morgan publishes them.</p><p><Check size={15} aria-hidden="true" /> GitHub repository requests go to GitHub and are subject to GitHub's privacy policy.</p><p><Check size={15} aria-hidden="true" /> No third-party advertising or tracking pixels are intentionally included.</p></div>}
      {slug !== "privacy" && <Link className="button button-quiet" href="/contact">Suggest a collaboration <ArrowRight size={15} aria-hidden="true" /></Link>}
    </section></Reveal>
  );
}

function ContactContent() {
  return (
    <div className="contact-layout">
      <section className="contact-info" aria-label="Contact information">
        <p className="card-index">DIRECT CONTACT</p>
        <h2>Good work starts with a conversation.</h2>
        <p>For roles, collaborations, learning opportunities, or technical questions, use the form or reach out directly.</p>
        <a href={`mailto:${profile.email}`}><MailIcon />{profile.email}</a>
        <a href={profile.linkedin} target="_blank" rel="noreferrer"><span className="contact-symbol" aria-hidden="true">in</span>LinkedIn <ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>
        <a href={profile.github} target="_blank" rel="noreferrer"><span className="contact-symbol" aria-hidden="true">⌘</span>GitHub <ArrowUpRight size={14} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>
        <div className="calendar-placeholder"><span className="card-index">SCHEDULING</span><p>Calendar booking will be added when a scheduling link is available.</p></div>
      </section>
      <ContactForm />
    </div>
  );
}

function MailIcon() {
  return <span className="contact-symbol" aria-hidden="true">✉</span>;
}

export default function PortfolioPage({ slug }: { slug: string }) {
  let content: React.ReactNode;
  switch (slug) {
    case "about": content = <AboutContent />; break;
    case "skills": content = <SkillsContent />; break;
    case "projects": content = <ProjectsContent />; break;
    case "experience": content = <ExperienceContent />; break;
    case "education": content = <EducationContent />; break;
    case "certifications": content = <CertificationsContent />; break;
    case "timeline": content = <TimelineContent />; break;
    case "achievements": content = <AchievementsContent />; break;
    case "services": content = <ServicesContent />; break;
    case "documents": content = <DocumentVault />; break;
    case "triage": content = <AlertTriageGame />; break;
    case "leaderboard": content = <Leaderboard />; break;
    case "contact": content = <ContactContent />; break;
    default: content = <PlaceholderContent slug={slug} />;
  }

  return (
    <div className="inner-page">
      <PageIntro slug={slug} />
      <div className="page-container page-content">{content}{managedCategories[slug] ? <ManagedContent key={slug} slug={slug} /> : null}</div>
      <div className="page-bottom-cta page-container">
        <p>Curious about my work?</p>
        <Link href={slug === "projects" ? "/contact" : "/projects"}>{slug === "projects" ? "Start a conversation" : "Explore selected projects"} <ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
    </div>
  );
}
