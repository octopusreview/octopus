import { AskOctopus } from "@/components/ask-octopus";
import { ORGANIZATION_JSON_LD, WEBSITE_JSON_LD, jsonLd } from "@/lib/structured-data";

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
