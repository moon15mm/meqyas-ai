import path from "node:path";

import type { NextConfig } from "next";

const apiUrl = process.env.API_INTERNAL_URL ?? "http://localhost:8000";
// next-intl request config. We register the alias directly instead of using
// `next-intl/plugin`, which eagerly loads the @swc/core native addon (fails on
// some Windows setups); the alias is all the plugin does for our configuration.
const I18N_REQUEST_CONFIG = "./src/i18n/request.ts";
const isDev = process.env.NODE_ENV !== "production";

// Next.js injects inline bootstrap scripts, hence 'unsafe-inline' for scripts (nonce-based CSP is on the roadmap).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  transpilePackages: ["@meqyas/ui", "@meqyas/shared"],
  poweredByHeader: false,
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    resolveAlias: { "next-intl/config": I18N_REQUEST_CONFIG },
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      "next-intl/config": path.resolve(process.cwd(), I18N_REQUEST_CONFIG),
    };
    return config;
  },
  experimental: {
    // AI generation can take tens of seconds; the default proxy timeout is too short.
    proxyTimeout: 180_000,
  },
};

export default nextConfig;
