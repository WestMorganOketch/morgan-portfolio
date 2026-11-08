import type { Metadata } from "next";
import Link from "next/link";
import ResumeToolbar from "./ResumeToolbar";
import { resume } from "@/data/resume";

export const metadata: Metadata = {
  title: "Résumé",
  description: "Read Morgan West Oketch’s résumé, including experience, selected projects, education, skills, and professional development.",
  alternates: { canonical: "/resume" },
  robots: { index: true, follow: true },
};

const skillHeadings = [...new Set(resume.skills.map((skill) => skill.heading))];

export default function ResumePage() {
  return (
    <div className="resume-page">
      <div className="resume-page-inner">
        <ResumeToolbar />
        <article className="resume-paper" aria-labelledby="resume-name">
          <header className="resume-header">
            <p className="resume-eyebrow"><span aria-hidden="true" /> Professional résumé</p>
            <div className="resume-identity">
              <div className="resume-identity-copy">
                <h1 id="resume-name">{resume.name}</h1>
                <p className="resume-headline">{resume.headline}</p>
              </div>
              <div className="resume-monogram" aria-hidden="true">MW</div>
            </div>
            <p className="resume-contact">
              <span>{resume.location}</span>
              <span aria-hidden="true">•</span>
              <a href={`mailto:${resume.email}`}>{resume.email}</a>
              {resume.links.map((link) => (
                <span className="resume-contact-link" key={link.label}>
                  <span aria-hidden="true">•</span>
                  <a href={link.href} rel="noreferrer" target="_blank">{link.label}</a>
                </span>
              ))}
            </p>
          </header>

          <section className="resume-section" aria-labelledby="resume-summary">
            <h2 id="resume-summary">Professional Summary</h2>
            <p>{resume.summary}</p>
          </section>

          <section className="resume-section" aria-labelledby="resume-skills">
            <h2 id="resume-skills">Skills</h2>
            {skillHeadings.map((heading) => (
              <div className="resume-skill-group" key={heading}>
                {skillHeadings.length > 1 ? <h3>{heading}</h3> : null}
                <ul className="resume-skill-list">
                  {resume.skills.filter((skill) => skill.heading === heading).map((skill) => (
                    <li key={skill.label}><strong>{skill.label}:</strong> {skill.items}</li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="resume-section" aria-labelledby="resume-experience">
            <h2 id="resume-experience">Experience</h2>
            {resume.experience.map((entry) => (
              <section className="resume-entry" key={entry.role}>
                <h3>{entry.role}, {entry.organisation}</h3>
                <p className="resume-period"><time dateTime={entry.period.startsWith("Apr") ? "2024-04" : "2021-05"}>{entry.period}</time>, {entry.location}</p>
                <ul>{entry.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
              </section>
            ))}
          </section>

          <section className="resume-section" aria-labelledby="resume-projects">
            <h2 id="resume-projects">Projects</h2>
            {resume.projects.map((project) => (
              <section className="resume-entry resume-project" key={project.title}>
                <h3>{project.title} — {project.subtitle}</h3>
                {project.href ? <p className="resume-project-link"><a href={project.href} rel="noreferrer" target="_blank">{project.href.replace("https://", "")}</a></p> : null}
                <p>{project.body}</p>
              </section>
            ))}
          </section>

          <section className="resume-section" aria-labelledby="resume-education">
            <h2 id="resume-education">Education</h2>
            <div className="resume-entry">
              <h3>{resume.education.qualification}</h3>
              <p>{resume.education.institution}, {resume.education.location} — <time dateTime="2026-11">{resume.education.period}</time></p>
              <p><strong>Relevant Coursework:</strong> {resume.education.coursework}</p>
            </div>
          </section>

          <section className="resume-section" aria-labelledby="resume-certifications">
            <h2 id="resume-certifications">Certifications</h2>
            <ul className="resume-certifications">
              {resume.certifications.map((certification) => (
                <li key={certification.name}><strong>{certification.name}</strong> — {certification.issuer} ({certification.date})</li>
              ))}
            </ul>
          </section>

          <section className="resume-section" aria-labelledby="resume-references">
            <h2 id="resume-references">References</h2>
            <p>{resume.references}</p>
          </section>

          <footer className="resume-documents-link">
            <Link href="/documents">More documents and certificates</Link>
          </footer>
        </article>
      </div>
    </div>
  );
}
