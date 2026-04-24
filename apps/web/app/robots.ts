import type { MetadataRoute } from "next";

const disallow = [
  "/api/",
  "/blocked",
  "/dashboard",
  "/settings",
  "/admin",
  "/onboarding",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow,
      },
      { userAgent: "GPTBot", allow: "/", disallow },
      { userAgent: "ClaudeBot", allow: "/", disallow },
      { userAgent: "Google-Extended", allow: "/", disallow },
      { userAgent: "PerplexityBot", allow: "/", disallow },
      { userAgent: "CCBot", allow: "/", disallow },
    ],
    sitemap: "https://octopus-review.ai/sitemap.xml",
    host: "https://octopus-review.ai",
  };
}
