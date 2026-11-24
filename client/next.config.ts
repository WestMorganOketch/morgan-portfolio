import type { NextConfig } from "next";

const configuredApiOrigin = (
  process.env.PORTFOLIO_API_ORIGIN
  || process.env.VITE_API_URL
  || ""
).trim();

function normalizeApiOrigin(value: string): string {
  if (!value) return "http://localhost:3001";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PORTFOLIO_API_ORIGIN must be an absolute API URL, such as https://your-api.example.com.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("PORTFOLIO_API_ORIGIN must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("PORTFOLIO_API_ORIGIN must not contain credentials, query parameters, or a fragment.");
  }
  // Accept a base ending in /api too; the rewrite appends /api itself.
  if (parsed.pathname.replace(/\/+$/, "").toLowerCase() === "/api") parsed.pathname = "/";
  return parsed.toString().replace(/\/+$/, "");
}

const apiOrigin = normalizeApiOrigin(configuredApiOrigin);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  agentRules: false,
  outputFileTracingRoot: process.cwd(),
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    ];
    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
    }
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
