import { NextResponse } from "next/server";
import { prisma } from "@octopus/db";

export async function GET() {
  const [components, activeIncidents, recentResolved] = await Promise.all([
    prisma.statusComponent.findMany({
      where: { isVisible: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
      },
    }),
    prisma.statusIncident.findMany({
      where: { status: { not: "resolved" } },
      orderBy: { createdAt: "desc" },
      include: {
        component: { select: { name: true } },
        updates: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.statusIncident.findMany({
      where: {
        status: "resolved",
        resolvedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { resolvedAt: "desc" },
      include: {
        component: { select: { name: true } },
        updates: { orderBy: { createdAt: "asc" } },
      },
    }),
  ]);

  // Calculate overall status
  let overall = "operational";
  for (const comp of components) {
    if (comp.status === "major_outage") {
      overall = "major_outage";
      break;
    }
    if (comp.status === "partial_outage" && overall !== "major_outage") {
      overall = "partial_outage";
    }
    if (
      comp.status === "degraded" &&
      overall !== "major_outage" &&
      overall !== "partial_outage"
    ) {
      overall = "degraded";
    }
    if (comp.status === "maintenance" && overall === "operational") {
      overall = "maintenance";
    }
  }

  return NextResponse.json({
    overall,
    components,
    activeIncidents: activeIncidents.map((inc) => ({
      id: inc.id,
      title: inc.title,
      severity: inc.severity,
      status: inc.status,
      message: inc.message,
      componentName: inc.component?.name ?? null,
      createdAt: inc.createdAt.toISOString(),
      updates: inc.updates.map((u) => ({
        status: u.status,
        message: u.message,
        createdAt: u.createdAt.toISOString(),
      })),
    })),
    recentResolved: recentResolved.map((inc) => ({
      id: inc.id,
      title: inc.title,
      severity: inc.severity,
      message: inc.message,
      componentName: inc.component?.name ?? null,
      resolvedAt: inc.resolvedAt?.toISOString() ?? null,
      createdAt: inc.createdAt.toISOString(),
      updates: inc.updates.map((u) => ({
        status: u.status,
        message: u.message,
        createdAt: u.createdAt.toISOString(),
      })),
    })),
  });
}
