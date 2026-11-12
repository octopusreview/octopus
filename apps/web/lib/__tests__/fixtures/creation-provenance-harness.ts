import { mock, spyOn } from "bun:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.match(url.pathname, /(^|[-_])test($|[-_])/);
const scenario = process.argv[2];
const fixture = randomUUID();
// The migration check uses a separate schema; all cases use a disposable database.
const schema = `provenance_${fixture.replaceAll("-", "")}`;
process.env.DATABASE_URL = url.toString();
process.env.NEXT_PUBLIC_OCTOPUS_SELF_HOSTED = "true";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = randomUUID() + randomUUID();
for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"]) {
  process.env[key] = "synthetic-fixture";
}
process.env.OCTOPUS_ADMIN_EMAIL = `bootstrap-${fixture}@example.com`;
process.env.OCTOPUS_ADMIN_PASSWORD = randomUUID();
delete process.env.DISABLE_ADMIN_SEED;
mock.module("server-only", () => ({}));
mock.module("@/lib/audit", () => ({ writeAuditLog: async () => {} }));
mock.module("@/lib/queue", () => ({ enqueueAfter: async () => {}, enqueue: async () => {} }));
mock.module("@/lib/email-validator", () => ({ validateEmailForSignup: async () => ({ ok: true }), reasonToMessage: () => "Invalid" }));
mock.module("@/lib/email-renderer", () => ({ renderEmailTemplate: async () => null }));
mock.module("@/lib/marketing-capture", () => ({ signupMarketingVisit: async () => null }));
mock.module("@/lib/session-guard", () => ({ assertUserNotBanned: async () => {} }));
mock.module("@/lib/signup-velocity", () => ({ checkSignupVelocity: async () => ({ blocked: false }) }));
mock.module("@/lib/credits", () => ({ addFreeCredits: async () => {} }));
mock.module("@/lib/welcome-credit", () => ({
  assessWelcomeCredit: async () => ({ eligible: false, grant: false, score: 0, reason: "fixture" }),
  logWelcomeOutcome: () => {},
}));
let magicUrl = "";
mock.module("@/lib/email", () => ({ sendEmail: async (message: { html: string }) => {
  magicUrl = message.html.match(/href="([^"]+)"/)?.[1] ?? "";
} }));
const database = await import("@octopus/db");
const { prisma } = database;
let transactionOverride: typeof prisma.$transaction | undefined;
const facade = new Proxy(prisma, {
  get(target, key) {
    return key === "$transaction" && transactionOverride ? transactionOverride : Reflect.get(target, key);
  },
});
mock.module("@octopus/db", () => ({ ...database, prisma: facade }));
const provenance = await import("@/lib/creation-provenance");
const { createOrgForUser } = await import("@/lib/org-create");
const { canUserCreateOrg, hasEverOwnedOrg } = await import("@/lib/org-limits");
const { toBaseSlug, randomSlugSuffix } = await import("@/lib/slug");
const root = new URL("../../../../../", import.meta.url);
const source = async (path: string) => readFile(new URL(path, root), "utf8");
const parse = async (path: string) => ts.createSourceFile(path, await source(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function nodes(node: ts.Node): ts.Node[] {
  const found = [node];
  node.forEachChild(child => { found.push(...nodes(child)); });
  return found;
}
const compile = (text: string, bindings: Record<string, unknown>) => {
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(text.replace(/^export /, ""));
  return new Function(...Object.keys(bindings), js)(...Object.values(bindings));
};
const user = (id = randomUUID()) => prisma.user.create({ data: { id, email: `${id}@example.com`, name: "Fixture" } });
let schemaCreated = false;
try {
  await prisma.$executeRawUnsafe('TRUNCATE organizations, users CASCADE');
  if (scenario === "migration") {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      schemaCreated = true;
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('CREATE TABLE organizations (LIKE public.organizations INCLUDING ALL)');
      await tx.$executeRawUnsafe('CREATE TABLE users (LIKE public.users INCLUDING ALL)');
      await tx.$executeRawUnsafe('ALTER TABLE organizations DROP COLUMN "creationSource", DROP COLUMN "creatorFirstOrganization"');
      await tx.$executeRawUnsafe('ALTER TABLE users DROP COLUMN "arrivalSource", DROP COLUMN "signupMethod"');
      await tx.$executeRawUnsafe(`INSERT INTO users (id, name, email, "updatedAt") VALUES ('old', 'Fixture', 'old@example.com', TIMESTAMP '2026-01-01')`);
      await tx.$executeRawUnsafe(`INSERT INTO organizations (id, name, slug, "updatedAt") VALUES ('old', 'Fixture', 'old', TIMESTAMP '2026-01-01')`);
      const beforeUsers = await tx.$queryRaw`SELECT * FROM users`;
      const beforeOrgs = await tx.$queryRaw`SELECT * FROM organizations`;
      const migration = await source("packages/db/prisma/migrations/20261015120000_creation_provenance/migration.sql");
      for (const statement of migration.split(";").filter(s => s.trim())) await tx.$executeRawUnsafe(statement);
      assert.deepEqual(await tx.$queryRaw`SELECT * FROM users`,
        (beforeUsers as object[]).map(row => ({ ...row, arrivalSource: null, signupMethod: null })));
      const afterOrgs = await tx.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM organizations`;
      assert.deepEqual(afterOrgs, (beforeOrgs as object[]).map(row => ({ ...row, creationSource: null, creatorFirstOrganization: null })));
      const cols = await tx.$queryRaw<Array<{ column_default: string | null; is_nullable: string }>>`
        SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_schema = ${schema} AND column_name IN ('creationSource', 'creatorFirstOrganization', 'arrivalSource', 'signupMethod')`;
      assert.equal(cols.length, 4);
      assert.ok(cols.every(c => c.column_default === null && c.is_nullable === "YES"));
    });
  } else if (scenario === "lookup-indexes") {
    const people = Array.from({ length: 20_000 }, (_, i) => ({ id: `${fixture}-${i}`, email: `${fixture}-${i}@example.com`, name: "Fixture" }));
    await prisma.user.createMany({ data: people });
    const org = await prisma.organization.create({ data: { name: "Fixture", slug: fixture } });
    await prisma.organizationMember.createMany({ data: people.map(p => ({ userId: p.id, organizationId: org.id })) });
    await prisma.organizationInvitation.createMany({ data: people.map(p => ({ email: p.email, organizationId: org.id,
      invitedById: people[0].id, expiresAt: new Date("2099-01-01") })) });
    await prisma.$executeRawUnsafe("ANALYZE organization_members");
    await prisma.$executeRawUnsafe("ANALYZE organization_invitations");
    type Plan = { "Index Name"?: string; Plans?: Plan[] };
    const usesIndex = (plan: Plan, name: string): boolean => plan["Index Name"] === name || (plan.Plans ?? []).some(child => usesIndex(child, name));
    // Test both a matching row and a new signup with no match: LIMIT 1 alone
    // does not stop a table scan when the requested user/email is absent.
    for (const person of [people[10_000], { id: "missing", email: "missing@example.com" }]) {
      const membership = await prisma.$queryRaw<Array<{ "QUERY PLAN": Array<{ Plan: Plan }> }>>`
        EXPLAIN (ANALYZE, FORMAT JSON) SELECT id FROM organization_members WHERE "userId" = ${person.id} LIMIT 1`;
      const invitation = await prisma.$queryRaw<Array<{ "QUERY PLAN": Array<{ Plan: Plan }> }>>`
        EXPLAIN (ANALYZE, FORMAT JSON) SELECT token FROM organization_invitations
        WHERE email = ${person.email} AND status = 'pending' AND "expiresAt" > ${new Date()} LIMIT 1`;
      assert.ok(usesIndex(membership[0]["QUERY PLAN"][0].Plan, "organization_members_userId_idx"), "Membership lookup must use its user index");
      assert.ok(usesIndex(invitation[0]["QUERY PLAN"][0].Plan, "organization_invitations_email_status_expiresAt_idx"), "Invitation lookup must use its email/status/expiry index");
    }
  } else if (scenario.startsWith("community-")) {
    const action = scenario.startsWith("community-action");
    const file = await parse(action ? "apps/web/app/api/github-action/review/route.ts" : "apps/web/app/api/oss-review/route.ts");
    const fn = nodes(file).find(n => ts.isFunctionDeclaration(n) && n.name?.text === "getOrCreateCommunityOrg")!;
    const create = compile(fn.getText(file) + "\nreturn getOrCreateCommunityOrg;", { prisma, ORG_TYPE: { COMMUNITY: 2 } });
    const owner = `fixture-${fixture}`;
    if (scenario.endsWith("existing")) {
      for (const existingSource of [null, "user_created", "auto_default"]) {
        const old = await prisma.organization.create({ data: { name: "Fixture", slug: `community-${owner}`, type: 1, creationSource: existingSource } });
        const updated = await create(owner);
        assert.equal(updated.creationSource, existingSource);
        assert.equal(updated.type, 2);
        await prisma.organization.delete({ where: { id: old.id } });
      }
    } else {
      const created = await create(owner);
      assert.equal(created.creationSource, "community_bot");
      assert.equal(created.creatorFirstOrganization, null);
    }
  } else if (scenario === "demo-seed") {
    const file = await parse("packages/db/prisma/seed.ts");
    const statement = nodes(file).find(n => ts.isVariableStatement(n) && n.getText(file).includes("prisma.organization.create("))!;
    // Run the actual seed INSERT; replace fixture identities before persistence.
    const db = { organization: { create: (args: Parameters<typeof prisma.organization.create>[0]) => prisma.organization.create({
      ...args, data: { ...args.data, name: "Fixture", slug: fixture, githubInstallationId: null },
    }) } };
    const created = await compile("return (async () => {" + statement.getText(file) + "; return org; })();", { prisma: db, orgId: fixture });
    assert.equal(created.creationSource, "demo_seed");
    assert.equal(created.creatorFirstOrganization, null);
  } else if (["auto-layout", "auto-profile", "auto-cli", "second", "removed-member", "membership-unavailable", "user-created", "concurrent-organizations"].includes(scenario)) {
    const person = await user();
    if (scenario === "second" || scenario === "removed-member") {
      const previous = await prisma.organization.create({ data: { name: "Fixture", slug: fixture, members: { create: { userId: person.id, role: "member", ...(scenario === "removed-member" ? { deletedAt: new Date() } : {}) } } } });
      assert.ok(previous);
    }
    let created;
    if (scenario === "concurrent-organizations") {
      // Hold both transactions after the provenance lookup. Neither may depend
      // on the other transaction committing before it reaches this point.
      const transaction = prisma.$transaction.bind(prisma);
      let reached = 0;
      let release!: () => void;
      let reject!: (error: Error) => void;
      let timedOut = false;
      const bothCounted = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
      const timeout = setTimeout(() => {
        timedOut = true;
        reject(new Error("Concurrent creation could not reach the lookup"));
      }, 5_000);
      transactionOverride = (async (run: (tx: unknown) => Promise<unknown>) =>
        transaction(async tx => run(new Proxy(tx, {
          get(target, key) {
            if (key !== "organizationMember") return Reflect.get(target, key);
            return new Proxy(tx.organizationMember, {
              get(member, operation) {
                if (operation !== "findFirst") return Reflect.get(member, operation);
                return async (args: Parameters<typeof tx.organizationMember.findFirst>[0]) => {
                  const membership = await tx.organizationMember.findFirst(args);
                  if (Object.keys(args?.where ?? {}).length === 1 && args?.where?.userId === person.id) {
                    if (++reached === 2) release();
                    await bothCounted;
                  }
                  return membership;
                };
              },
            });
          },
        })), { timeout: 10_000 })) as typeof prisma.$transaction;
      let pair;
      try {
        pair = await Promise.all([createOrgForUser(person.id, "Fixture"), createOrgForUser(person.id, "Fixture")]);
      } finally {
        clearTimeout(timeout);
        transactionOverride = undefined;
      }
      assert.equal(timedOut, false);
      assert.equal(reached, 2);
      assert.equal(new Set(pair.map(row => row.id)).size, 2);
      assert.equal(await prisma.organizationMember.count({ where: { userId: person.id } }), 2);
      assert.ok(pair.every(row => row.creationSource === "auto_default"));
      created = pair[0];
    } else if (scenario.startsWith("auto-")) {
      const path = scenario === "auto-layout" ? "apps/web/app/(app)/layout.tsx"
        : scenario === "auto-profile" ? "apps/web/app/(app)/complete-profile/actions.ts" : "apps/web/app/api/cli/auth/orgs/route.ts";
      const file = await parse(path);
      const call = nodes(file).find(n => ts.isCallExpression(n) && n.expression.getText(file) === "createOrgForUser")!;
      created = await compile("return " + call.getText(file) + ";", { createOrgForUser, session: { user: person }, displayName: "Fixture", name: "Fixture", userName: "Fixture" });
    } else if (scenario === "user-created") {
      const file = await parse("apps/web/app/(app)/actions.ts");
      const fn = nodes(file).find(n => ts.isFunctionDeclaration(n) && n.name?.text === "createOrganization")!;
      const stop = new Error("redirect");
      const create = compile(fn.getText(file) + "\nreturn createOrganization;", {
        prisma, getUser: async () => person, canUserCreateOrg, hasEverOwnedOrg, toBaseSlug, randomSlugSuffix,
        assessWelcomeCredit: async () => ({ eligible: false }), logWelcomeOutcome: () => {},
        organizationCreationProvenance: provenance.organizationCreationProvenance,
        MAX_OWNED_ORGS_PER_USER: 10, WELCOME_FREE_CREDITS: 0, WELCOME_DEFERRED_REASON: "deferred_no_oauth",
        isTextFormData: () => true, cookies: async () => ({ set: () => {} }), revalidatePath: () => {}, redirect: () => { throw stop; },
      });
      const form = new FormData(); form.set("name", "Fixture");
      await assert.rejects(() => create({}, form), error => error === stop);
      created = await prisma.organization.findFirstOrThrow();
    } else if (scenario === "membership-unavailable") {
      created = await prisma.$transaction(async tx => {
        const proxy = { ...tx, organizationMember: { findFirst: () => tx.$executeRawUnsafe("SELECT * FROM nonexistent_provenance_fixture") } };
        const fields = await provenance.organizationCreationProvenance(proxy as unknown as typeof tx, person.id, "auto_default");
        return tx.organization.create({ data: { ...fields, name: "Fixture", slug: fixture } });
      });
    } else created = await createOrgForUser(person.id, "Fixture");
    assert.equal(created.creationSource, scenario === "user-created" ? "user_created" : "auto_default");
    if (scenario !== "concurrent-organizations") {
      assert.equal(created.creatorFirstOrganization, scenario === "membership-unavailable" ? null : !["second", "removed-member"].includes(scenario));
    }
  } else {
    const { auth } = await import("@/lib/auth");
    // No provider network calls: exercise the real social endpoint and SQL adapter.
    const context = await auth.$context;
    for (const provider of context.socialProviders) {
      provider.verifyIdToken = async () => true;
      provider.getUserInfo = async () => ({ user: { id: fixture, name: "Fixture", email: `${fixture}@example.com`, emailVerified: true }, data: {} });
    }
    const email = `${fixture}@example.com`;
    if (scenario.startsWith("invite-")) {
      if (scenario !== "invite-none") {
        const inviter = await user();
        const org = await prisma.organization.create({ data: { name: "Fixture", slug: fixture } });
        await prisma.organizationInvitation.create({ data: {
          organizationId: org.id, invitedById: inviter.id, email,
          status: scenario === "invite-expired" ? "pending" : scenario.slice(7),
          expiresAt: new Date(Date.now() + (scenario === "invite-expired" ? -60_000 : 60_000)),
        } });
      }
    }
    if (scenario === "invitation-unavailable") await prisma.$executeRawUnsafe('ALTER TABLE organization_invitations RENAME TO unavailable_provenance_fixture');
    let person;
    if (["github", "google", "microsoft", "link-later"].includes(scenario)) {
      const provider = scenario === "link-later" ? "github" : scenario;
      await auth.api.signInSocial({ body: { provider, idToken: { token: "synthetic" } } });
      person = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(person.signupMethod, provider);
      if (scenario === "link-later") {
        await auth.api.signInSocial({ body: { provider: "google", idToken: { token: "synthetic" } } });
        assert.equal(await prisma.account.count({ where: { userId: person.id } }), 2);
        assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: person.id } })).signupMethod, "github");
      }
    } else if (scenario === "magic-link") {
      await auth.api.signInMagicLink({ body: { email }, headers: new Headers({ origin: "http://localhost:3000" }) });
      assert.ok(magicUrl);
      const response = await auth.handler(new Request(magicUrl));
      assert.equal(response.status, 302);
      person = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(person.signupMethod, "magic_link");
      assert.equal(await prisma.account.count({ where: { userId: person.id } }), 0);
    } else if (scenario === "bootstrap") {
      const { bootstrapDefaultAdmin } = await import("@/lib/bootstrap-admin");
      // The production bootstrap logs initial credentials; silence it in this fixture.
      const log = spyOn(console, "log").mockImplementation(() => {});
      try { await bootstrapDefaultAdmin(); } finally { log.mockRestore(); }
      person = await prisma.user.findFirstOrThrow();
      assert.equal(person.signupMethod, "password");
      assert.equal(person.arrivalSource, "system");
    } else if (scenario === "method-unknown" || scenario === "method-unavailable" || scenario === "oauth-callbacks") {
      const hook = auth.options.databaseHooks!.user!.create!.before!;
      const contexts = scenario === "oauth-callbacks" ? ["github", "google", "microsoft"].map(id => ({ path: "/callback/:id", params: { id } }))
        : [scenario === "method-unavailable" ? { get path(): string { throw new Error("Unavailable"); } } : { path: "/unknown" }];
      for (const [i, ctx] of contexts.entries()) {
        const id = randomUUID();
        const input = { id, name: "Fixture", email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() };
        const result = await hook(input, ctx as never);
        assert.ok(result && typeof result === "object" && "data" in result);
        person = await prisma.user.create({ data: { ...input, ...result.data } });
        assert.equal(person.signupMethod, scenario === "oauth-callbacks" ? ["github", "google", "microsoft"][i] : null);
      }
    } else {
      await auth.api.signUpEmail({ body: { email, name: "Fixture", password: randomUUID() } });
      person = await prisma.user.findUniqueOrThrow({ where: { email } });
      assert.equal(person.signupMethod, "password");
    }
    if (scenario === "invitation-unavailable") await prisma.$executeRawUnsafe('ALTER TABLE unavailable_provenance_fixture RENAME TO organization_invitations');
    assert.ok(person);
    assert.equal(person.arrivalSource, scenario === "bootstrap" ? "system" : scenario === "invitation-unavailable" ? null : scenario === "invite-pending" ? "invite" : "signup");
  }
  console.log("PROVENANCE_OK");
} catch (error) {
  console.error("PROVENANCE_FAILURE");
  if (error instanceof Error) {
    console.error(error.name);
    for (const frame of (error.stack ?? "").split("\n").filter(line => line.trim().startsWith("at "))) {
      console.error(frame.replace(/file:\/\//g, ""));
    }
  }
  process.exitCode = 1;
} finally {
  if (schemaCreated) await prisma.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await prisma.$executeRawUnsafe('TRUNCATE organizations, users CASCADE');
  await prisma.$disconnect();
}
