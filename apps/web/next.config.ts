import { config } from "dotenv";
import path from "path";
import type { NextConfig } from "next";

config({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@octopus/db", "@octopus/package-analyzer"],
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
    ],
  },
  env: {
    NEXT_PUBLIC_BUILD_ID: Date.now().toString(),
  },
};

export default nextConfig;
