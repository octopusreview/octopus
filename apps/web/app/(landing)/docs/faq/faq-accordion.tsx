"use client";

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";

interface FaqSection {
  title: string;
  items: { q: string; a: React.ReactNode }[];
}

export function FaqAccordion({ sections }: { sections: FaqSection[] }) {
  return (
    <div className="space-y-10">
      {sections.map((section) => (
        <section key={section.title}>
          <h2 className="mb-4 text-xl font-semibold text-white">
            {section.title}
          </h2>
          <Accordion
            type="single"
            collapsible
            className="rounded-lg border border-white/[0.06]"
          >
            {section.items.map((item, i) => (
              <AccordionItem
                key={i}
                value={`${section.title}-${i}`}
                className="border-white/[0.06] px-4"
              >
                <AccordionTrigger className="text-[#ccc] hover:text-white hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-[#888]">
                  <p>{item.a}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      ))}
    </div>
  );
}
