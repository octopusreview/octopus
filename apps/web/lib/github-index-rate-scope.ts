import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@octopus/db";
import { decryptStringWithRekey, encryptString } from "./crypto";

type Input = { installationId: number; providedToken?: string };

/** Opaque tokens cannot reveal whether different credentials share a quota. */
export async function githubIndexRateScope(input: Input): Promise<string> {
  if (input.providedToken === undefined) {
    if (!Number.isSafeInteger(input.installationId) || input.installationId <= 0) throw new Error("GitHub index rate scope is unavailable");
    return `github-index-installation:${input.installationId}`;
  }
  if (!input.providedToken) throw new Error("GitHub index rate scope is unavailable");

  const candidate = encryptString(randomBytes(32).toString("base64url"));
  await prisma.$executeRaw`
    INSERT INTO "github_index_rate_secret" ("id", "secretEnc") VALUES (1, ${candidate})
    ON CONFLICT ("id") DO NOTHING`;
  const rows = await prisma.$queryRaw<Array<{ secretEnc: string }>>`
    SELECT "secretEnc" FROM "github_index_rate_secret" WHERE "id" = 1`;
  if (rows.length !== 1) throw new Error("GitHub index rate scope is unavailable");
  const { value: secret, replacement } = decryptStringWithRekey(rows[0].secretEnc);
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("GitHub index rate scope is unavailable");
  if (replacement) {
    await prisma.$executeRaw`
      UPDATE "github_index_rate_secret" SET "secretEnc" = ${replacement}
      WHERE "id" = 1 AND "secretEnc" = ${rows[0].secretEnc}`;
  }
  const digest = createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(JSON.stringify(["github-index-token-v1", input.providedToken])).digest("hex");
  return `github-index:${digest}`;
}
