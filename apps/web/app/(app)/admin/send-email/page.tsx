import { prisma } from "@octopus/db";
import { SendEmailPanel } from "./send-email-panel";

export default async function AdminSendEmailPage() {
  const templates = await prisma.emailTemplate.findMany({
    where: { enabled: true, category: "marketing" },
    orderBy: { name: "asc" },
    select: {
      slug: true,
      name: true,
      category: true,
      subject: true,
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Send Email</h2>
        <p className="text-muted-foreground text-sm">
          Send an email template to a filtered audience.
        </p>
      </div>
      <SendEmailPanel templates={templates} />
    </div>
  );
}
