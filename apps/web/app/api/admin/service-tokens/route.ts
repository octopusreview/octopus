import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@octopus/db";
import { generateServiceToken, hashToken, serviceTokenPrefix } from "@/lib/api-auth";
import { normalizeScopes, ALL_SCOPES } from "@/lib/scopes";

// Machine auth: the shared ADMIN_API_SECRET bearer (matches /api/admin/seed-docs
// & telemetry). The admin UI for this lives in the octopus-configuration console,
// which calls these endpoints via lib/octopus-api.ts.
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.ADMIN_API_SECRET;
  if (!expected) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === expected;
}

/** List active service tokens (+ the scope registry for the mint form). */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tokens = await prisma.serviceToken.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      tokenPrefix: true,
      scopes: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ tokens, allScopes: ALL_SCOPES });
}

/** Mint a new service token. Returns the plaintext token ONCE (never stored). */
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "A name is required" }, { status: 400 });
  }
  let scopes: string[];
  try {
    scopes = normalizeScopes(body.scopes);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  // Who minted it: the config app passes the admin's email/id; default "config".
  const createdBy =
    typeof body.createdBy === "string" && body.createdBy.trim()
      ? body.createdBy.trim().slice(0, 200)
      : "config";

  const token = generateServiceToken();
  const created = await prisma.serviceToken.create({
    data: {
      name,
      tokenHash: hashToken(token),
      tokenPrefix: serviceTokenPrefix(token),
      scopes,
      createdBy,
    },
  });
  console.log(
    `[admin] service-token mint id=${created.id} prefix=${created.tokenPrefix} scopes=${scopes.join(",")} by=${createdBy}`,
  );
  // Plaintext returned ONCE for display; never persisted or logged.
  return NextResponse.json({ ok: true, id: created.id, token });
}
