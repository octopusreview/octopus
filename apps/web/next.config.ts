import { config } from "dotenv";
import path from "path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

config({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@octopus/db", "@octopus/package-analyzer"],
  // pdfkit reads its built-in AFM font data from disk at runtime; bundling it
  // breaks those reads, so keep it external (traced into standalone output).
  serverExternalPackages: ["pdfkit"],
  experimental: {
    serverActions: {
      allowedOrigins: ["octopus-review.ai", "*.octopus-review.ai"],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "api.producthunt.com",
        pathname: "/widgets/embed-image/**",
      },
      {
        protocol: "https",
        hostname: "cdn.octopus-review.ai",
      },
    ],
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID || Date.now().toString(),
  },
  async redirects() {
    // The Free-for-OSS pages were removed; keep inbound links (search, the
    // GitHub Marketplace CTA, blog posts) from 404ing by pointing them at pricing.
    return [
      { source: "/open-source", destination: "/docs/pricing", permanent: true },
      { source: "/docs/open-source", destination: "/docs/pricing", permanent: true },
      // Common guesses for pages that live under /docs.
      { source: "/pricing", destination: "/docs/pricing", permanent: true },
      { source: "/about", destination: "/docs/about", permanent: true },
    ];
  },
};

// Wrap with Sentry: injects the SDK, adds tunneling, and uploads source maps at
// build time. Source-map upload only runs when SENTRY_AUTH_TOKEN is set, so
// self-host builds (no token) skip it and never push to octopus's project. org/
// project are env-overridable for self-hosters; they default to octopus's.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || "weezboo-i0",
  project: process.env.SENTRY_PROJECT || "octopus-review",
  sentryUrl: process.env.SENTRY_URL || "https://de.sentry.io",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
});
