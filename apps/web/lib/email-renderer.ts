import { render } from "@react-email/components";
import { prisma } from "@octopus/db";
import { EmailLayout } from "@/emails/components/layout";
import { createElement } from "react";

interface RenderResult {
  from: string;
  subject: string;
  html: string;
}

/**
 * Fetch a template from DB by slug, interpolate variables,
 * wrap in React Email layout, and render to HTML string.
 */
export async function renderEmailTemplate(
  slug: string,
  variables: Record<string, string>,
  options?: { userId?: string },
): Promise<RenderResult | null> {
  const template = await prisma.emailTemplate.findUnique({
    where: { slug },
  });

  if (!template || !template.enabled) {
    console.warn(`[email-renderer] Template "${slug}" not found or disabled`);
    return null;
  }

  // Check if user opted out of marketing emails
  if (template.category === "marketing" && options?.userId) {
    const user = await prisma.user.findUnique({
      where: { id: options.userId },
      select: { marketingEmailsEnabled: true },
    });
    if (user && !user.marketingEmailsEnabled) {
      console.log(`[email-renderer] User ${options.userId} opted out of marketing emails, skipping "${slug}"`);
      return null;
    }
  }

  const from = `${template.fromName} <${template.fromEmail}>`;
  const subject = interpolate(template.subject, variables);
  const body = interpolate(template.body, variables);
  const buttonText = template.buttonText
    ? interpolate(template.buttonText, variables)
    : null;
  const buttonUrl = template.buttonUrl
    ? interpolate(template.buttonUrl, variables)
    : null;

  const signature =
    template.signatureName && template.signatureTitle
      ? { name: template.signatureName, title: template.signatureTitle }
      : null;

  const element = createElement(EmailLayout, {
    body,
    buttonText,
    buttonUrl,
    signature,
  });

  const html = await render(element);

  return { from, subject, html };
}

/**
 * Render a template with raw content (for preview / test, without DB lookup)
 */
export async function renderEmailPreview(
  content: {
    fromName?: string;
    fromEmail?: string;
    subject: string;
    body: string;
    buttonText?: string | null;
    buttonUrl?: string | null;
    signatureName?: string | null;
    signatureTitle?: string | null;
  },
  variables: Record<string, string>,
): Promise<RenderResult> {
  const fromName = content.fromName || "Octopus";
  const fromEmail = content.fromEmail || "notifications@example.com";
  const from = `${fromName} <${fromEmail}>`;

  const subject = interpolate(content.subject, variables);
  const body = interpolate(content.body, variables);
  const buttonText = content.buttonText
    ? interpolate(content.buttonText, variables)
    : null;
  const buttonUrl = content.buttonUrl
    ? interpolate(content.buttonUrl, variables)
    : null;

  const signature =
    content.signatureName && content.signatureTitle
      ? { name: content.signatureName, title: content.signatureTitle }
      : null;

  const element = createElement(EmailLayout, {
    body,
    buttonText,
    buttonUrl,
    signature,
  });

  const html = await render(element);
  return { from, subject, html };
}

/** Replace {{variable}} placeholders with values */
function interpolate(
  text: string,
  variables: Record<string, string>,
): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return variables[key] ?? match;
  });
}
