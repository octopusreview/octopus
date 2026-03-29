import { prisma } from "@octopus/db";
import { StatusAdmin } from "./status-admin";

export default async function AdminStatusPage() {
  const [components, incidents, tokens] = await Promise.all([
    prisma.statusComponent.findMany({
      orderBy: { sortOrder: "asc" },
    }),
    prisma.statusIncident.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        component: { select: { name: true } },
        updates: { orderBy: { createdAt: "asc" } },
      },
    }),
    prisma.statusApiToken.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <StatusAdmin
      components={components.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        status: c.status,
        sortOrder: c.sortOrder,
        isVisible: c.isVisible,
      }))}
      incidents={incidents.map((inc) => ({
        id: inc.id,
        title: inc.title,
        severity: inc.severity,
        status: inc.status,
        message: inc.message,
        componentId: inc.componentId,
        componentName: inc.component?.name ?? null,
        resolvedAt: inc.resolvedAt?.toISOString() ?? null,
        createdByName: inc.createdByName,
        createdAt: inc.createdAt.toISOString(),
        updates: inc.updates.map((u) => ({
          id: u.id,
          status: u.status,
          message: u.message,
          createdByName: u.createdByName,
          createdAt: u.createdAt.toISOString(),
        })),
      }))}
      tokens={tokens.map((t) => ({
        id: t.id,
        name: t.name,
        tokenPrefix: t.tokenPrefix,
        lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
        createdAt: t.createdAt.toISOString(),
      }))}
    />
  );
}
