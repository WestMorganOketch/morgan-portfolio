import type { Metadata } from "next";
import Script from "next/script";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen, BriefcaseBusiness, Shield } from "lucide-react";
import HomeHero from "@/components/HomeHero";
import { profile } from "@/data/profile";

export const metadata: Metadata = {
  title: "Cybersecurity Analyst & IT Support Specialist",
  description: "Meet Morgan West Oketch, a cybersecurity analyst and Mathematics & Computer Science student in Nairobi, Kenya. Explore projects, experience, skills, and professional training.",
  ...(process.env.NEXT_PUBLIC_SITE_URL ? { alternates: { canonical: "/" } } : {}),
};

const personJsonLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: profile.name,
  jobTitle: "Cybersecurity Analyst",
  description: profile.summary,
  email: profile.email,
  address: { "@type": "PostalAddress", addressLocality: "Nairobi", addressCountry: "KE" },
  sameAs: [profile.github, profile.linkedin],
  knowsAbout: ["Cybersecurity", "IT support", "Network security", "Data analytics", "Web development"],
};

export default function HomePage() {
  const jsonLd = JSON.stringify(personJsonLd).replace(/</g, "\\u003c");
  return (
    <>
      <Script id="person-jsonld" type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <HomeHero />
      <section className="page-container home-detail-section">
        <div className="home-section-heading"><div><p className="eyebrow">A FEW SELECTED DETAILS</p><h2>What I bring to the table.</h2></div><Link href="/about">Get to know me <ArrowRight size={14} aria-hidden="true" /></Link></div>
        <div className="home-feature-grid">
          <article><span className="home-feature-icon"><Shield size={19} aria-hidden="true" /></span><p className="card-index">DEFENSIVE THINKING</p><h3>Security with context.</h3><p>Studying how people, processes, and systems work together helps make security more practical.</p><Link href="/skills">Explore security skills <ArrowRight size={13} aria-hidden="true" /></Link></article>
          <article><span className="home-feature-icon"><BriefcaseBusiness size={19} aria-hidden="true" /></span><p className="card-index">REAL-WORLD EXPERIENCE</p><h3>Support that empowers.</h3><p>Helping learners and users solve real IT problems while making technical topics approachable.</p><Link href="/experience">View experience <ArrowRight size={13} aria-hidden="true" /></Link></article>
          <article><span className="home-feature-icon"><BookOpen size={19} aria-hidden="true" /></span><p className="card-index">ALWAYS LEARNING</p><h3>Progress, documented.</h3><p>Building a portfolio of learning, from professional programs to practical projects.</p><Link href="/projects">Browse project work <ArrowRight size={13} aria-hidden="true" /></Link></article>
        </div>
      </section>
      <section className="home-journey-band">
        <div className="page-container journey-content">
          <div><p className="eyebrow">NEXT CHAPTER</p><h2>Good security starts<br />with good questions.</h2><p>Looking for a curious teammate, an eager learner, or a thoughtful conversation?</p></div>
          <Link className="button button-primary" href="/contact">Let's connect <ArrowUpRight size={15} aria-hidden="true" /></Link>
        </div>
      </section>
    </>
  );
}
