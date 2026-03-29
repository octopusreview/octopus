import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import { authenticateStatusToken } from "../auth";

const SEVERITY_TO_COMPONENT_STATUS: Record<string, string> = {
  critical: "major_outage",
  major: "partial_outage",
  minor: "degraded",
  maintenance: "maintenance",
};

export async function POST(request: NextRequest) {
  const token = await authenticateStatusToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, severity, message, componentId, status = "investigating" } = body as {
      title?: string;
      severity?: string;
      message?: string;
      componentId?: string;
      status?: string;
    };

    if (!title || !severity || !message) {
      return NextResponse.json(
        { error: "title, severity, and message are required" },
        { status: 400 },
      );
    }

    const validSeverities = ["critical", "major", "minor", "maintenance"];
    if (!validSeverities.includes(severity)) {
      return NextResponse.json(
        { error: "Invalid severity. Must be: critical, major, minor, or maintenance" },
        { status: 400 },
      );
    }

    const incident = await prisma.statusIncident.create({
      data: {
        title,
        severity,
        status,
        message,
        componentId: componentId || null,
        createdByName: "API",
      },
    });

    // Auto-update component status
    if (componentId) {
      const componentStatus = SEVERITY_TO_COMPONENT_STATUS[severity];
      if (componentStatus) {
        await prisma.statusComponent.update({
          where: { id: componentId },
          data: { status: componentStatus },
        }).catch(() => {});
      }
    }

    pubby.trigger("status-updates", "status:changed", { ts: Date.now() }).catch(() => {});

    return NextResponse.json({
      success: true,
      id: incident.id,
      status: incident.status,
      severity: incident.severity,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to create incident" },
      { status: 500 },
    );
  }
}
