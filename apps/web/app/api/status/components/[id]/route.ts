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
    const { status } = body as { status?: string };

    if (!status) {
      return NextResponse.json(
        { error: "status is required" },
        { status: 400 },
      );
    }

    const validStatuses = [
      "operational",
      "degraded",
      "partial_outage",
      "major_outage",
      "maintenance",
    ];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: "Invalid status. Must be: operational, degraded, partial_outage, major_outage, or maintenance" },
        { status: 400 },
      );
    }

    const component = await prisma.statusComponent.findUnique({
      where: { id },
    });
    if (!component) {
      return NextResponse.json(
        { error: "Component not found" },
        { status: 404 },
      );
    }

    await prisma.statusComponent.update({
      where: { id },
      data: { status },
    });

    pubby.trigger("status-updates", "status:changed", { ts: Date.now() }).catch(() => {});

    return NextResponse.json({ success: true, status });
  } catch {
    return NextResponse.json(
      { error: "Failed to update component" },
      { status: 500 },
    );
  }
}
