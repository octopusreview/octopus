import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { getResend } from "@/lib/resend";
import { renderEmailTemplate, renderEmailPreview } from "@/lib/email-renderer";
import { prisma } from "@octopus/db";
import { headers } from "next/headers";

const APP_URL =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "http://localhost:3000";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const slug = body.slug as string;
  const to = (body.to as string) || session.user.email;

  // Sample variables for testing
  const sampleVars: Record<string, string> = {
    firstName: session.user.name?.split(" ")[0] || "there",
    appUrl: APP_URL,
    magicLinkUrl: `${APP_URL}/login`,
    inviterName: "Test User",
    organizationName: "Acme Corp",
    role: "member",
    acceptUrl: `${APP_URL}/dashboard`,
    declineUrl: `${APP_URL}/dashboard`,
    repoFullName: "acme/my-repo",
    details: "42 files indexed, 1024 vectors created in 12s",
    error: "Connection timeout (sample error)",
    prNumber: "42",
    prTitle: "Add dark mode support",
    prAuthor: "octocat",
    prUrl: "https://github.com/acme/my-repo/pull/42",
    findingsCount: "3",
    filesChanged: "7",
    documentTitle: "Architecture Guide",
    actionLabel: "Ready",
    totalChunks: "15",
    totalVectors: "128",
    balance: "$4.20",
  };

  const result = await renderEmailTemplate(slug, sampleVars);

  if (!result) {
    return NextResponse.json(
      { error: `Template "${slug}" not found or disabled` },
      { status: 404 },
    );
  }

  const { error } = await getResend().emails.send({
    from: result.from,
    to,
    subject: `[TEST] ${result.subject}`,
    html: result.html,
  });

  if (error) {
    return NextResponse.json(
      { error: `Failed to send: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ sent: true, to, slug });
}

/** Live preview — renders from editor values without DB lookup */
export async function PUT(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = await request.json();

  const sampleVars: Record<string, string> = {
    firstName: session.user.name?.split(" ")[0] || "there",
    appUrl: APP_URL,
    magicLinkUrl: `${APP_URL}/login`,
    inviterName: "Test User",
    organizationName: "Acme Corp",
    role: "member",
    acceptUrl: `${APP_URL}/dashboard`,
    declineUrl: `${APP_URL}/dashboard`,
    repoFullName: "acme/my-repo",
    details: "42 files indexed, 1024 vectors created in 12s",
    error: "Connection timeout (sample error)",
    prNumber: "42",
    prTitle: "Add dark mode support",
    prAuthor: "octocat",
    prUrl: "https://github.com/acme/my-repo/pull/42",
    findingsCount: "3",
    filesChanged: "7",
    documentTitle: "Architecture Guide",
    actionLabel: "Ready",
    totalChunks: "15",
    totalVectors: "128",
    balance: "$4.20",
  };

  const result = await renderEmailPreview(
    {
      fromName: body.fromName,
      fromEmail: body.fromEmail,
      subject: body.subject,
      body: body.body,
      buttonText: body.buttonText || null,
      buttonUrl: body.buttonUrl || null,
      signatureName: body.signatureName || null,
      signatureTitle: body.signatureTitle || null,
    },
    sampleVars,
  );

  return new Response(result.html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Preview endpoint — returns rendered HTML from DB */
export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");

  if (!slug) {
    return new Response("Missing slug parameter", { status: 400 });
  }

  const sampleVars: Record<string, string> = {
    firstName: session.user.name?.split(" ")[0] || "there",
    appUrl: APP_URL,
    magicLinkUrl: `${APP_URL}/login`,
    inviterName: "Test User",
    organizationName: "Acme Corp",
    role: "member",
    acceptUrl: `${APP_URL}/dashboard`,
    declineUrl: `${APP_URL}/dashboard`,
    repoFullName: "acme/my-repo",
    details: "42 files indexed, 1024 vectors created in 12s",
    error: "Connection timeout (sample error)",
    prNumber: "42",
    prTitle: "Add dark mode support",
    prAuthor: "octocat",
    prUrl: "https://github.com/acme/my-repo/pull/42",
    findingsCount: "3",
    filesChanged: "7",
    documentTitle: "Architecture Guide",
    actionLabel: "Ready",
    totalChunks: "15",
    totalVectors: "128",
    balance: "$4.20",
  };

  // Admin preview: read from DB directly, ignore enabled flag
  const template = await prisma.emailTemplate.findUnique({
    where: { slug },
  });

  if (!template) {
    return new Response(`Template "${slug}" not found`, { status: 404 });
  }

  const result = await renderEmailPreview(
    {
      fromName: template.fromName,
      fromEmail: template.fromEmail,
      subject: template.subject,
      body: template.body,
      buttonText: template.buttonText,
      buttonUrl: template.buttonUrl,
      signatureName: template.signatureName,
      signatureTitle: template.signatureTitle,
    },
    sampleVars,
  );

  return new Response(result.html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
