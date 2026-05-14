import { config } from "dotenv";
import path from "path";
import type { NextConfig } from "next";

config({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@octopus/db", "@octopus/package-analyzer"],
  // Include non-JS files the standalone server reads at runtime (system
  // prompts, diagram rules, etc.). Without this Next.js drops them from the
  // standalone tree and reviewer.ts crashes on first PR.
  outputFileTracingIncludes: {
    "/api/**/*": ["./prompts/**/*"],
    "/**/*": ["./prompts/**/*"],
  },
  experimental: {
    serverActions: {
      allowedOrigins: [
        "octopus-review.ai",
        "*.octopus-review.ai",
        "*.databricksapps.com",
        "*.cloud.databricks.com",
      ],
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
};

export default nextConfig;
