"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { prisma } from "@octopus/db";
import { revalidatePath } from "next/cache";
import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { pubby } from "@/lib/pubby";

function notifyStatusChange() {
  pubby.trigger("status-updates", "status:changed", { ts: Date.now() }).catch(() => {});
}

async function requireAdmin() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !isAdminEmail(session.user.email)) {
    throw new Error("Unauthorized");
  }
  return session;
}

// ── Component Actions ───────────────────────────────────────────────────────

export async function createComponent(formData: FormData) {
  await requireAdmin();

  const name = formData.get("name") as string;
  const description = (formData.get("description") as string) || null;
  const sortOrder = parseInt((formData.get("sortOrder") as string) || "0", 10);

  if (!name?.trim()) {
    return { error: "Component name is required" };
  }

  const existing = await prisma.statusComponent.findUnique({
    where: { name: name.trim() },
  });
  if (existing) {
    return { error: "A component with this name already exists" };
  }

  await prisma.statusComponent.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      sortOrder,
    },
  });

  revalidatePath("/admin/status");
  revalidatePath("/status");
  notifyStatusChange();
  return { success: true };
}

export async function updateComponent(id: string, formData: FormData) {
  await requireAdmin();

  const name = formData.get("name") as string;
  const description = (formData.get("description") as string) || null;
  const sortOrder = parseInt((formData.get("sortOrder") as string) || "0", 10);
  const isVisible = formData.get("isVisible") === "true";

  if (!name?.trim()) {
    return { error: "Component name is required" };
  }

  const existing = await prisma.statusComponent.findUnique({
    where: { name: name.trim() },
  });
  if (existing && existing.id !== id) {
    return { error: "A component with this name already exists" };
  }

  await prisma.statusComponent.update({
    where: { id },
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      sortOrder,
      isVisible,
    },
  });

  revalidatePath("/admin/status");
  revalidatePath("/status");
  notifyStatusChange();
  return { success: true };
}

export async function updateComponentStatus(id: string, status: string) {
  await requireAdmin();

  const validStatuses = [
    "operational",
    "degraded",
    "partial_outage",
    "major_outage",
    "maintenance",
  ];
  if (!validStatuses.includes(status)) {
    return { error: "Invalid status" };
  }

  await prisma.statusComponent.update({
    where: { id },
    data: { status },
  });

  revalidatePath("/admin/status");
  revalidatePath("/status");
  notifyStatusChange();
  return { success: true };
}

export async function deleteComponent(id: string) {
  await requireAdmin();

  await prisma.statusComponent.delete({ where: { id } });

  revalidatePath("/admin/status");
  revalidatePath("/status");
  notifyStatusChange();
  return { success: true };
}

// ── Incident Actions ────────────────────────────────────────────────────────

const SEVERITY_TO_COMPONENT_STATUS: Record<string, string> = {
  critical: "major_outage",
  major: "partial_outage",
  minor: "degraded",
  maintenance: "maintenance",
};

export async function createIncident(formData: FormData) {
  const session = await requireAdmin();

  const title = formData.get("title") as string;
  const severity = formData.get("severity") as string;
  const message = formData.get("message") as string;
  const componentId = (formData.get("componentId") as string) || null;

  if (!title?.trim() || !severity || !message?.trim()) {
    return { error: "Title, severity, and message are required" };
  }

  const validSeverities = ["critical", "major", "minor", "maintenance"];
  if (!validSeverities.includes(severity)) {
    return { error: "Invalid severity" };
  }

  const incident = await prisma.statusIncident.create({
    data: {
      title: title.trim(),
      severity,
      status: "investigating",
      message: message.trim(),
      componentId: componentId || null,
      createdById: session.user.id,
      createdByName: session.user.name,
    },
  });

  // Auto-update component status based on severity
  if (componentId) {
    const componentStatus = SEVERITY_TO_COMPONENT_STATUS[severity];
    if (componentStatus) {
      await prisma.statusComponent.update({
        where: { id: componentId },
        data: { status: componentStatus },
      });
    }
  }

  revalidatePath("/admin/status");
  revalidatePath("/status");
  notifyStatusChange();
  return { success: true, id: incident.id };
}

export async function addIncidentUpdate(
  incidentId: string,
  formData: FormData,
) {
  const session = await requireAdmin();

  const status = formData.get("status") as string;
  const message = formData.get("message") as string;

  if (!status || !message?.trim()) {
    return { error: "Status and message are required" };
  }

  const validStatuses = ["investigating", "identified", "monitoring", "resolved"];
  if (!validStatuses.includes(status)) {
    return { error: "Invalid status" };
  }

  const incident = await prisma.statusIncident.findUnique({
    where: { id: incidentId },
  });
  if (!incident) {
    return { error: "Incident not found" };
  }

  // Create the update
  await prisma.statusIncidentUpdate.create({
    data: {
      incidentId,
      status,
      message: message.trim(),
      createdById: session.user.id,
      createdByName: session.user.name,
    },
  });

  // Update the incident status
  const updateData: { status: string; resolvedAt?: Date } = { status };
  if (status === "resolved") {
    updateData.resolvedAt = new Date();
  }
  await prisma.statusIncident.update({
    where: { id: incidentId },
    data: updateData,
  });

  // If resolved, check if component should revert to operational
  if (status === "resolved" && incident.componentId) {
    const otherActiveIncidents = await prisma.statusIncident.count({
      where: {
        componentId: incident.componentId,
        status: { not: "resolved" },
        id: { not: incidentId },
      },
    });

    if (otherActiveIncidents === 0) {
      await prisma.statusComponent.update({
        where: { id: incident.componentId },
        data: { status: "operational" },
      });
    }
  }

  revalidatePath("/admin/status");
  revalidatePath("/status");
  notifyStatusChange();
  return { success: true };
}

export async function deleteIncident(id: string) {
  await requireAdmin();

  const incident = await prisma.statusIncident.findUnique({
    where: { id },
  });
  if (!incident) {
    return { error: "Incident not found" };
  }

  await prisma.statusIncident.delete({ where: { id } });

  // If the deleted incident was affecting a component, check if component should revert
  if (incident.componentId && incident.status !== "resolved") {
    const otherActiveIncidents = await prisma.statusIncident.count({
      where: {
        componentId: incident.componentId,
        status: { not: "resolved" },
      },
    });

    if (otherActiveIncidents === 0) {
      await prisma.statusComponent.update({
        where: { id: incident.componentId },
        data: { status: "operational" },
      });
    }
  }

  revalidatePath("/admin/status");
  revalidatePath("/status");
  notifyStatusChange();
  return { success: true };
}

// ── AI Message Generation ───────────────────────────────────────────────────

export async function generateIncidentMessage(
  summary: string,
  severity: string,
  componentName: string | null,
) {
  await requireAdmin();

  if (!summary.trim()) {
    return { error: "Please provide a brief summary first" };
  }

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `You are writing a status page incident for a SaaS product called Octopus (AI-powered code review tool). Generate both a title and a message body in English based on this summary.

Summary (may be in any language): ${summary}
Severity: ${severity}
${componentName ? `Affected component: ${componentName}` : ""}

Rules:
- Title: short (5-10 words), descriptive, no period at the end
- Message: 1-3 sentences, factual, no apologies or fluff, present tense for ongoing issues, mention what users might experience
- Return ONLY valid JSON: {"title": "...", "message": "..."}`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "";

  if (!text) {
    return { error: "Failed to generate message" };
  }

  try {
    const parsed = JSON.parse(text);
    return { success: true, title: parsed.title as string, message: parsed.message as string };
  } catch {
    // Fallback: treat entire response as message
    return { success: true, title: undefined, message: text };
  }
}

// ── Status API Token Management ─────────────────────────────────────────────

export async function generateStatusApiToken(name: string) {
  await requireAdmin();

  if (!name.trim()) {
    return { error: "Token name is required" };
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const rawToken = `status_${hex}`;
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const tokenPrefix = rawToken.slice(0, 11) + "...";

  await prisma.statusApiToken.create({
    data: { name, tokenHash, tokenPrefix },
  });

  revalidatePath("/admin/status");
  return { success: true, token: rawToken };
}

export async function deleteStatusApiToken(id: string) {
  await requireAdmin();

  await prisma.statusApiToken.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/admin/status");
  return { success: true };
}
