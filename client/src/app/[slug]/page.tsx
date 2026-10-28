import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PortfolioPage from "@/components/PortfolioPage";
import { details, publicPages } from "@/data/site";

type PageProps = { params: Promise<{ slug: string }> };

const slugs = [...publicPages.map((page) => page.href.slice(1)).filter(Boolean), "privacy"];

export function generateStaticParams() {
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  if (!Object.hasOwn(details, slug)) return {};
  const page = details[slug];
  return {
    title: page.eyebrow.charAt(0) + page.eyebrow.slice(1).toLowerCase(),
    description: page.intro,
    openGraph: { title: `${page.title} | Morgan West Oketch`, description: page.intro },
    ...(process.env.NEXT_PUBLIC_SITE_URL ? { alternates: { canonical: `/${slug}` } } : {}),
    robots: slug === "privacy" ? { index: true, follow: true } : undefined,
  };
}

export default async function ContentRoute({ params }: PageProps) {
  const { slug } = await params;
  if (!Object.hasOwn(details, slug)) notFound();
  return <PortfolioPage slug={slug} />;
}
