import type { Metadata, Viewport } from "next";
import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import { ThemeProvider } from "next-themes";
import { SiteShell } from "@/components/SiteShell";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  title: {
    default: "Morgan West Oketch | Cybersecurity, IT Support & Data",
    template: "%s | Morgan West Oketch",
  },
  description: "The professional portfolio of Morgan West Oketch — cybersecurity analyst, IT support specialist, and Mathematics & Computer Science student in Nairobi, Kenya.",
  applicationName: "Morgan West Oketch Portfolio",
  icons: { icon: "/icon.svg", shortcut: "/icon.svg" },
  authors: [{ name: "Morgan West Oketch" }],
  creator: "Morgan West Oketch",
  openGraph: {
    type: "website",
    locale: "en_KE",
    siteName: "Morgan West Oketch",
    title: "Morgan West Oketch | Cybersecurity, IT Support & Data",
    description: "Cybersecurity, systems, and data — built with curiosity and a security-first mindset.",
    ...(siteUrl ? { images: [{ url: "/opengraph-image.svg", width: 1200, height: 630, alt: "Morgan West Oketch — Cybersecurity, Systems & Data" }] } : {}),
  },
  twitter: {
    card: "summary_large_image",
    title: "Morgan West Oketch | Cybersecurity, IT Support & Data",
    description: "Cybersecurity, systems, and data — built with curiosity and a security-first mindset.",
    ...(siteUrl ? { images: ["/opengraph-image.svg"] } : {}),
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#091112" },
    { media: "(prefers-color-scheme: light)", color: "#f5f7f4" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem storageKey="morgan-portfolio-theme" disableTransitionOnChange>
          <LazyMotion features={domAnimation}>
            <MotionConfig reducedMotion="user">
              <a className="skip-link" href="#main-content">Skip to content</a>
              <SiteShell>{children}</SiteShell>
            </MotionConfig>
          </LazyMotion>
        </ThemeProvider>
      </body>
    </html>
  );
}
