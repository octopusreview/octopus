import { mock } from "bun:test";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["postgres:", "postgresql:"].includes(url.protocol));
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
assert.match(url.pathname, /(^|[-_])test($|[-_])/);
url.hostname = "127.0.0.1";
process.env.DATABASE_URL = url.toString();
let orgId = "";
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => ({ value: orgId }) }) }));
mock.module("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`unexpected redirect to ${to}`); } }));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: `usage-unknown-${orgId}` } }) } } }));
mock.module("@/lib/stripe", () => ({ getStripe: () => { throw new Error("Stripe must not be called"); }, getOffSessionPaymentMethodId: async () => null }));
const { prisma } = await import("@octopus/db");
const { default: UsagePage } = await import("../../../app/(app)/usage/page");
const org = await prisma.organization.create({ data: { name: "Synthetic", slug: `usage-unknown-test-${randomUUID()}` } });
orgId = org.id;
try {
  await prisma.user.create({ data: { id: `usage-unknown-${orgId}`, name: "Synthetic", email: `${orgId}@example.invalid`, emailVerified: true } });
  await prisma.organizationMember.create({ data: { userId: `usage-unknown-${orgId}`, organizationId: org.id, role: "owner" } });
  // The daily chart labels each day that has usage as MM-DD.
  const days = async () => renderToStaticMarkup(await UsagePage({ searchParams: Promise.resolve({}) })).match(/>\d\d-\d\d<\/span>/g)?.length ?? 0;
  await prisma.aiUsage.create({ data: { organizationId: org.id, provider: "openai", model: "gpt-fixture", operation: "review-failed-attempt", inputTokens: 0, outputTokens: 0, usageUnknown: true } });
  assert.equal(await days(), 0, "a failed attempt with unknown usage is not a day of customer usage");
  await prisma.aiUsage.create({ data: { organizationId: org.id, provider: "openai", model: "gpt-fixture", operation: "review", inputTokens: 1, outputTokens: 1 } });
  assert.equal(await days(), 1, "ordinary usage is still shown");
} finally { await prisma.user.deleteMany({ where: { id: `usage-unknown-${orgId}` } }); await prisma.organization.delete({ where: { id: org.id } }); await prisma.$disconnect(); }
console.log("PASS failed attempts with unknown usage stay out of the daily usage chart");
