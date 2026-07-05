import type { MetadataRoute } from "next";

const disallow = [
  "/api/",
  "/blocked",
  "/dashboard",
  "/settings",
  "/admin",
  "/onboarding",
  "/monitor",
  "/chat",
  "/package-analyzer",
  "/usage",
  "/repositories",
  "/knowledge",
  "/complete-profile",
  "/review-logs",
  "/timeline",
  "/issues",
  "/coupon",
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
  };
}
