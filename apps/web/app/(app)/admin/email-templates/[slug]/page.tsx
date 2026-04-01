import { prisma } from "@octopus/db";
import { notFound } from "next/navigation";
import { TemplateEditor } from "./template-editor";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const template = await prisma.emailTemplate.findUnique({
    where: { slug },
  });

  if (!template) notFound();

  return (
    <div className="space-y-4">
      <TemplateEditor template={template} />
    </div>
  );
}
