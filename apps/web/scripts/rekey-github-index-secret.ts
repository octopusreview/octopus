import { prisma } from "@octopus/db";
import { decryptStringWithDataKey, encryptString } from "@/lib/crypto";

const args = process.argv.slice(2);
const previousKey = process.env.OCTOPUS_PREVIOUS_DATA_KEY;
const currentKey = process.env.OCTOPUS_DATA_KEY;
const validKey = (key: string | undefined): key is string => !!key && /^[0-9a-f]{64}$/i.test(key);

async function main(): Promise<void> {
  if (args.some(arg => arg !== "--apply") || args.length > 1 || !validKey(previousKey) || !validKey(currentKey) ||
      previousKey.toLowerCase() === currentKey.toLowerCase()) {
    throw new Error("Invalid rekey configuration");
  }
  const result = await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ secretEnc: string }>>`
      SELECT "secretEnc" FROM "github_index_rate_secret" WHERE "id" = 1 FOR UPDATE`;
    if (!rows.length) return "absent";
    let secret: string;
    try { secret = decryptStringWithDataKey(rows[0].secretEnc, previousKey); }
    catch {
      secret = decryptStringWithDataKey(rows[0].secretEnc, currentKey);
      if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("Invalid rate-scope secret");
      return "already current";
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("Invalid rate-scope secret");
    if (!args.includes("--apply")) return "ready (dry run)";
    const replacement = encryptString(secret);
    await tx.$executeRaw`UPDATE "github_index_rate_secret" SET "secretEnc" = ${replacement} WHERE "id" = 1`;
    return "rekeyed";
  });
  console.log(`GitHub index rate-scope secret: ${result}`);
}

try { await main(); }
catch {
  console.error("GitHub index rate-scope rekey could not be confirmed; check with a dry run before retrying.");
  process.exitCode = 1;
} finally {
  try { await prisma.$disconnect(); }
  catch { console.error("GitHub index rate-scope rekey could not close its database connection."); process.exitCode = 1; }
}
