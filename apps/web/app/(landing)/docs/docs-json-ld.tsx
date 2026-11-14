import { docsPageJsonLd, jsonLd } from "@/lib/structured-data";

/** WebPage + breadcrumb structured data for one docs page. */
export function DocsJsonLd(props: Parameters<typeof docsPageJsonLd>[0]) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLd(docsPageJsonLd(props)) }}
    />
  );
}
