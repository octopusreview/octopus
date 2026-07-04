import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// Capture the `where` passed to deleteMany so we can assert the legal-hold
// clause. Bun's module mocks are file-scoped and auto-cleaned — no restore.
let lastWhere: Record<string, unknown> | null = null;
mock.module("@octopus/db", () => ({
  prisma: {
    auditLog: {
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        lastWhere = args.where;
        return { count: 0 };
      },
    },
  },
}));

import { enforceAuditLogRetention } from "@/lib/audit";

const KEYS = ["AUDIT_LOG_LEGAL_HOLD_CATEGORIES", "AUDIT_LOG_RETENTION_DAYS"] as const;

describe("enforceAuditLogRetention — legal-hold category skip", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    lastWhere = null;
  });

  it("deletes by cutoff only when no legal hold is configured", async () => {
    await enforceAuditLogRetention(30);
    expect(lastWhere?.createdAt).toBeDefined();
    expect(lastWhere?.category).toBeUndefined();
  });

  it("excludes held categories from deletion when the env is set", async () => {
    process.env.AUDIT_LOG_LEGAL_HOLD_CATEGORIES = "billing, admin";
    await enforceAuditLogRetention(30);
    expect(lastWhere?.category).toEqual({ notIn: ["billing", "admin"] });
  });

  it("ignores blank entries in the hold list", async () => {
    process.env.AUDIT_LOG_LEGAL_HOLD_CATEGORIES = " , billing , ";
    await enforceAuditLogRetention(30);
    expect(lastWhere?.category).toEqual({ notIn: ["billing"] });
  });
});
