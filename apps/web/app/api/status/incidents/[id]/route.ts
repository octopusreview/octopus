import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { pubby } from "@/lib/pubby";
import { authenticateStatusToken } from "../../auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = await authenticateStatusToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { status, message } = body as {
      status?: string;
      message?: string;
    };

    const incident = await prisma.statusIncident.findUnique({
      where: { id },
    });
    if (!incident) {
      return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    }

    if (status) {
      const validStatuses = ["investigating", "identified", "monitoring", "resolved"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: "Invalid status. Must be: investigating, identified, monitoring, or resolved" },
          { status: 400 },
        );
      }
    }

    // Create timeline update if message provided
    if (message) {
      await prisma.statusIncidentUpdate.create({
        data: {
          incidentId: id,
          status: status || incident.status,
          message,
          createdByName: "API",
        },
      });
    }

    // Update incident status
    if (status) {
      const updateData: { status: string; resolvedAt?: Date } = { status };
      if (status === "resolved") {
        updateData.resolvedAt = new Date();
      }
      await prisma.statusIncident.update({
        where: { id },
        data: updateData,
      });

      // If resolved, revert component if no other active incidents
      if (status === "resolved" && incident.componentId) {
        const otherActive = await prisma.statusIncident.count({
          where: {
            componentId: incident.componentId,
            status: { not: "resolved" },
            id: { not: id },
          },
        });
        if (otherActive === 0) {
          await prisma.statusComponent.update({
            where: { id: incident.componentId },
            data: { status: "operational" },
          });
        }
      }
    }

    pubby.trigger("status-updates", "status:changed", { ts: Date.now() }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: "Failed to update incident" },
      { status: 500 },
    );
  }
}
