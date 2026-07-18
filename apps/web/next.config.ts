import { config } from "dotenv";
import path from "path";
import type { NextConfig } from "next";

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
    NEXT_PUBLIC_BUILD_ID: Date.now().toString(),
  },
  async redirects() {
    // The Free-for-OSS pages were removed; keep inbound links (search, the
    // GitHub Marketplace CTA, blog posts) from 404ing by pointing them at pricing.
    return [
      { source: "/open-source", destination: "/docs/pricing", permanent: true },
      { source: "/docs/open-source", destination: "/docs/pricing", permanent: true },
    ];
  },
};

export default nextConfig;
