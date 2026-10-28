import type { MetadataRoute } from "next";
import { publicPages } from "@/data/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (!siteUrl) return [];
  return [
    ...publicPages.map((page) => ({
      url: `${siteUrl}${page.href}`,
      changeFrequency: page.href === "/" ? "weekly" as const : "monthly" as const,
      priority: page.href === "/" ? 1 : page.href === "/contact" ? 0.8 : 0.7,
    })),
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
