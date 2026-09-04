import { AskOctopus } from "@/components/ask-octopus";
import { ORGANIZATION_JSON_LD, jsonLd } from "@/lib/structured-data";

export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(ORGANIZATION_JSON_LD) }}
      />
      {children}
      <AskOctopus />
    </>
  );
}
