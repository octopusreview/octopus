"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { isAdminEmail } from "@/lib/admin";
import { seedEmailTemplates } from "@/lib/email-template-seeds";

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Not authenticated");
  if (!isAdminEmail(session.user.email)) throw new Error("Not authorized");
  return session;
}

export async function seedTemplatesAction() {
  await requireAdmin();
  const result = await seedEmailTemplates();
  revalidatePath("/admin/email-templates");
  return result;
}

export async function updateTemplateAction(
  currentSlug: string,
  data: {
    slug: string;
    name: string;
    category: string;
    fromName: string;
    fromEmail: string;
    subject: string;
    body: string;
    buttonText: string | null;
    buttonUrl: string | null;
    signatureName: string | null;
    signatureTitle: string | null;
    enabled: boolean;
  },
) {
  await requireAdmin();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (data.fromEmail && !emailRegex.test(data.fromEmail)) {
    throw new Error("Invalid fromEmail format");
  }

  await prisma.emailTemplate.update({
    where: { slug: currentSlug },
    data: {
      slug: data.slug,
      name: data.name,
      category: data.category,
      fromName: data.fromName,
      fromEmail: data.fromEmail,
      subject: data.subject,
      body: data.body,
      buttonText: data.buttonText,
      buttonUrl: data.buttonUrl,
      signatureName: data.signatureName,
      signatureTitle: data.signatureTitle,
      enabled: data.enabled,
    },
  });

  revalidatePath("/admin/email-templates");
  revalidatePath(`/admin/email-templates/${data.slug}`);
}

export async function createTemplateAction(): Promise<{ slug: string }> {
  await requireAdmin();

  const slug = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  await prisma.emailTemplate.create({
    data: {
      slug,
      name: "New Template",
      category: "marketing",
      fromName: process.env.EMAIL_SYSTEM_FROM_NAME || "Octopus",
      fromEmail: process.env.EMAIL_SYSTEM_FROM_EMAIL || "notifications@example.com",
      subject: "Subject here",
      body: "Hello {{firstName}},\n\nYour content here.",
      variables: ["firstName"],
      enabled: false,
    },
  });

  revalidatePath("/admin/email-templates");
  return { slug };
}

export async function deleteTemplateAction(slug: string) {
  await requireAdmin();

  const template = await prisma.emailTemplate.findUnique({
    where: { slug },
    select: { system: true },
  });

  if (template?.system) {
    throw new Error("System templates cannot be deleted");
  }

  await prisma.emailTemplate.delete({
    where: { slug },
  });

  revalidatePath("/admin/email-templates");
}
