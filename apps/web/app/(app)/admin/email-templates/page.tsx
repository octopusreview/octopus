import { prisma } from "@octopus/db";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { SeedTemplatesButton } from "./seed-button";
import { CreateTemplateButton } from "./create-button";
import { TemplateList } from "./template-list";

export default async function AdminEmailTemplatesPage() {
  const templates = await prisma.emailTemplate.findMany({
    orderBy: { name: "asc" },
  });

  const systemTemplates = templates.filter((t) => t.system);
  const customTemplates = templates.filter((t) => !t.system);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Email Templates</h2>
          <p className="text-muted-foreground text-sm">
            Edit email content. Layout and styling are handled by shared
            components.
          </p>
        </div>
        <div className="flex gap-2">
          <CreateTemplateButton />
          <SeedTemplatesButton hasTemplates={systemTemplates.length > 0} />
        </div>
      </div>

      <TemplateList
        systemTemplates={systemTemplates}
        customTemplates={customTemplates}
      />
    </div>
  );
}
