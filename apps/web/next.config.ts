import { config } from "dotenv";
import path from "path";
import type { NextConfig } from "next";

config({ path: path.resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@octopus/db"],
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
