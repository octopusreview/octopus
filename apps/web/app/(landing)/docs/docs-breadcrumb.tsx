"use client";

import { usePathname } from "next/navigation";

const pageNames: Record<string, string> = {
  "/docs/cli": "CLI",
  "/docs/octopusignore": ".octopusignore",
  "/docs/integrations": "Integrations",
  "/docs/self-hosting": "Self-Hosting",
  "/docs/pricing": "Pricing",
  "/docs/about": "About",
  "/docs/privacy": "Privacy Policy",
  "/docs/terms": "Terms & Conditions",
  "/docs/cookies": "Cookie Policy",
  "/docs/faq": "FAQ",
  "/docs/glossary": "Glossary",
  "/docs/getting-started": "Getting Started",
  "/docs/skills": "Skills",
};

export function DocsBreadcrumb() {
  const pathname = usePathname();
  const pageName = pageNames[pathname];

  if (!pageName) return null;

  return (
    <>
      <span className="text-[#333]">/</span>
      <span className="text-sm text-white">{pageName}</span>
    </>
  );
}
