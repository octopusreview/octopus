import { authenticateApiToken } from "@/lib/api-auth";
import { prisma } from "@octopus/db";
import { resolveReviewModelPin } from "@/lib/ai-client";
import { getProviderForModel } from "@/lib/ai-router";
import { ORG_KEY_COLUMNS, buildCliModelsResponse } from "@/lib/cli-models";

// The org's effective review model for the CLI onboarding wizard (display
// only). Same auth as /api/cli/me; no writes.
export async function GET(request: Request) {
  const result = await authenticateApiToken(request);
  if (result instanceof Response) return result; // account-standing hold (403), pass through
  if (!result) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { model, pinned } = await resolveReviewModelPin(result.org.id);
  const [provider, catalogRow, org] = await Promise.all([
    getProviderForModel(model),
    prisma.availableModel.findUnique({ where: { modelId: model }, select: { displayName: true } }),
    prisma.organization.findUnique({
      where: { id: result.org.id },
      select: Object.fromEntries(Object.values(ORG_KEY_COLUMNS).map((c) => [c, true])) as Record<
        (typeof ORG_KEY_COLUMNS)[keyof typeof ORG_KEY_COLUMNS],
        true
      >,
    }),
  ]);

  return Response.json(
    buildCliModelsResponse({
      model,
      pinned,
      provider: String(provider),
      displayName: catalogRow?.displayName ?? null,
      keys: org ?? {},
    }),
  );
}
