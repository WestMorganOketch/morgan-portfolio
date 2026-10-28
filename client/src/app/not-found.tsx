import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft, ShieldAlert } from "lucide-react";

export const metadata: Metadata = {
  title: "Page not found",
  description: "The requested page is not part of Morgan West Oketch's portfolio.",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <section className="not-found-page page-container">
      <div className="not-found-icon"><ShieldAlert size={26} aria-hidden="true" /></div>
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <h1>This page isn't in the map.</h1>
      <p>The address may have changed, or the page may not exist. Head back to the portfolio and keep exploring.</p>
      <Link className="button button-primary" href="/"><ArrowLeft size={15} aria-hidden="true" /> Back to home</Link>
    </section>
  );
}
