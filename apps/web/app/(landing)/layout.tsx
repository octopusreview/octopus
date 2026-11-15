import { AskOctopus } from "@/components/ask-octopus";
import { ORGANIZATION_JSON_LD, WEBSITE_JSON_LD, jsonLd } from "@/lib/structured-data";

// Public pages do not read the visitor's session on the server, so cacheable
// pages can be reused for five minutes. The homepage and status page opt out;
// the blog index is dynamic because it reads search parameters.
export const revalidate = 300;

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dark">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(ORGANIZATION_JSON_LD) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(WEBSITE_JSON_LD) }}
      />
      {children}
      <AskOctopus />
    </div>
  );
}
