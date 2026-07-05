/**
 * Mint a scoped service token (universal path — works for self-host + CI, where
 * the super-admin admin UI isn't available). Run on a host with DB access.
 *
 *   bun run apps/web/scripts/mint-service-token.ts \
 *     --name "Claude blog writer" --scopes blog:read,blog:create,blog:update
 *
 * Prints the plaintext token ONCE. Store it immediately — only its hash is kept.
 */
import { prisma } from "@octopus/db";
import { generateServiceToken, hashToken, serviceTokenPrefix } from "@/lib/api-auth";
import { normalizeScopes } from "@/lib/scopes";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("--name")?.trim();
  const scopesRaw = arg("--scopes");
  if (!name || !scopesRaw) {
    console.error('Usage: --name "<name>" --scopes blog:read,blog:create,blog:update');
    process.exit(1);
  }

  let scopes: string[];
  try {
    scopes = normalizeScopes(scopesRaw.split(",").map((s) => s.trim()));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }

  const token = generateServiceToken();
  const created = await prisma.serviceToken.create({
    data: {
      name,
      tokenHash: hashToken(token),
      tokenPrefix: serviceTokenPrefix(token),
      scopes,
      createdBy: "cli",
    },
  });

  console.log(`\n✓ Created service token "${name}" [${scopes.join(", ")}] (id ${created.id})`);
  console.log("\n  STORE THIS NOW — it is shown only once:\n");
  console.log(`  ${token}\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
