import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCredentials, loadCredentials, saveCredentials, type Credentials } from "../lib/credentials";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "octp-creds-"));
  process.env.OCTOPUS_HOME = tmpHome;
});

afterEach(async () => {
  delete process.env.OCTOPUS_HOME;
  await rm(tmpHome, { recursive: true, force: true });
});

const valid: Credentials = {
  baseUrl: "https://octopus-review.ai",
  token: "secret-token-123",
  orgId: "org_xyz",
  orgSlug: "acme",
  orgName: "Acme Inc",
  userName: "Test User",
  userEmail: "test@example.com",
  approvedAt: "2026-05-17T00:00:00.000Z",
};

describe("loadCredentials", () => {
  it("returns null when the file does not exist", async () => {
    expect(await loadCredentials()).toBeNull();
  });

  it("returns null when the file is unparseable", async () => {
    await writeFile(join(tmpHome, "credentials"), "{ not json");
    expect(await loadCredentials()).toBeNull();
  });

  it("returns null when the file lacks required fields", async () => {
    await writeFile(
      join(tmpHome, "credentials"),
      JSON.stringify({ baseUrl: "https://x", token: "y" }), // missing orgId/etc
    );
    expect(await loadCredentials()).toBeNull();
  });

  it("returns the credentials when the file is well-formed", async () => {
    await saveCredentials(valid);
    const loaded = await loadCredentials();
    expect(loaded).toEqual(valid);
  });
});

describe("saveCredentials", () => {
  it("creates the OCTOPUS_HOME directory if missing", async () => {
    await rm(tmpHome, { recursive: true, force: true });
    await saveCredentials(valid);
    const loaded = await loadCredentials();
    expect(loaded?.token).toBe(valid.token);
  });

  it("round-trips all fields", async () => {
    await saveCredentials(valid);
    const loaded = await loadCredentials();
    expect(loaded).toEqual(valid);
  });
});

describe("clearCredentials", () => {
  it("is a no-op when the file does not exist", async () => {
    await clearCredentials();
    expect(await loadCredentials()).toBeNull();
  });

  it("makes a previously-loaded credentials unloadable", async () => {
    await saveCredentials(valid);
    expect(await loadCredentials()).not.toBeNull();
    await clearCredentials();
    expect(await loadCredentials()).toBeNull();
  });
});
