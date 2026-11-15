import { AskOctopus } from "@/components/ask-octopus";
import { ORGANIZATION_JSON_LD, WEBSITE_JSON_LD, jsonLd } from "@/lib/structured-data";

// Public pages look the same to every visitor (the session is read in the
// browser, see components/session-aware.tsx), so they are rendered once and
// reused for five minutes. Pages that read live data opt out with
// `dynamic = "force-dynamic"`.
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
