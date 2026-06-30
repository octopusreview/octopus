import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isValidProfileName,
  ensureProfilesMigrated,
  ensureProfile,
  setActiveProfile,
  removeProfile,
  loadProfilesIndex,
  loadCredentialsForProfile,
} from "../lib/profile";
import { setActiveProfileOverride, getProfileDir, getProfilesIndexPath } from "../lib/paths";

let tmpHome: string;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "octp-profile-"));
  process.env.OCTOPUS_HOME = tmpHome;
  setActiveProfileOverride(null);
});

afterEach(async () => {
  delete process.env.OCTOPUS_HOME;
  setActiveProfileOverride(null);
  await rm(tmpHome, { recursive: true, force: true });
});

describe("isValidProfileName (path-traversal guard)", () => {
  it("accepts safe names", () => {
    for (const n of ["work", "default", "a.b-c_1", "Personal"]) {
      expect(isValidProfileName(n)).toBe(true);
    }
  });
  it("rejects empty, dot-entries, and path separators", () => {
    for (const n of ["", ".", "..", "../x", "a/b", "a\\b", "a b", "x/../y"]) {
      expect(isValidProfileName(n)).toBe(false);
    }
  });
});

describe("ensureProfilesMigrated", () => {
  it("on a fresh home creates the index with an active default and no creds", async () => {
    await ensureProfilesMigrated();
    const idx = await loadProfilesIndex();
    expect(idx.active).toBe("default");
    expect(Object.keys(idx.profiles)).toEqual(["default"]);
    expect(await loadCredentialsForProfile("default")).toBeNull();
  });

  it("moves a legacy credentials file into profiles/default (no logout)", async () => {
    const creds = {
      baseUrl: "https://x",
      token: "oct_abc",
      orgId: "o",
      orgSlug: "s",
      orgName: "Org",
      approvedAt: "2026-01-01T00:00:00Z",
    };
    await writeFile(join(tmpHome, "credentials"), JSON.stringify(creds), { mode: 0o600 });

    await ensureProfilesMigrated();

    await expect(stat(join(tmpHome, "credentials"))).rejects.toThrow(); // legacy gone
    const moved = await loadCredentialsForProfile("default");
    expect(moved?.token).toBe("oct_abc");
    expect((await loadProfilesIndex()).active).toBe("default");
  });

  it("is idempotent — a second run doesn't clobber state", async () => {
    await ensureProfilesMigrated();
    await ensureProfile("work");
    await setActiveProfile("work");
    await ensureProfilesMigrated(); // index already exists → no-op
    const idx = await loadProfilesIndex();
    expect(idx.active).toBe("work");
    expect(Object.keys(idx.profiles).sort()).toEqual(["default", "work"]);
  });
});

describe("profile ops", () => {
  beforeEach(async () => {
    await ensureProfilesMigrated();
  });

  it("ensureProfile registers a new profile + creates its dir", async () => {
    await ensureProfile("work");
    expect((await loadProfilesIndex()).profiles.work).toBeDefined();
    expect((await stat(getProfileDir("work"))).isDirectory()).toBe(true);
  });

  it("setActiveProfile switches active; rejects unknown", async () => {
    await ensureProfile("work");
    await setActiveProfile("work");
    expect((await loadProfilesIndex()).active).toBe("work");
    await expect(setActiveProfile("nope")).rejects.toThrow();
  });

  it("removeProfile of the active one auto-repoints to a remaining profile", async () => {
    await ensureProfile("work");
    await setActiveProfile("work");
    const { newActive } = await removeProfile("work");
    expect(newActive).toBe("default");
    expect((await loadProfilesIndex()).active).toBe("default");
    await expect(stat(getProfileDir("work"))).rejects.toThrow();
  });

  it("removeProfile unsets active when none remain", async () => {
    const { newActive } = await removeProfile("default");
    expect(newActive).toBeNull();
    expect((await loadProfilesIndex()).active).toBeNull();
  });

  it("rejects invalid names everywhere (traversal guard)", async () => {
    await expect(ensureProfile("..")).rejects.toThrow();
    await expect(setActiveProfile("../x")).rejects.toThrow();
    await expect(removeProfile("a/b")).rejects.toThrow();
  });
});

describe("loadProfilesIndex hardening", () => {
  it("returns an empty index for an array `profiles` or non-JSON", async () => {
    await mkdir(tmpHome, { recursive: true });
    await writeFile(getProfilesIndexPath(), JSON.stringify({ active: "x", profiles: ["a", "b"] }));
    let idx = await loadProfilesIndex();
    expect(idx.profiles).toEqual({});
    expect(idx.active).toBeNull();
    await writeFile(getProfilesIndexPath(), "not json");
    idx = await loadProfilesIndex();
    expect(idx.profiles).toEqual({});
  });

  it("drops traversal/invalid profile keys and an invalid active pointer", async () => {
    await mkdir(tmpHome, { recursive: true });
    await writeFile(
      getProfilesIndexPath(),
      JSON.stringify({
        active: "../evil",
        profiles: { "../evil": { createdAt: "x" }, work: { createdAt: "y" } },
      }),
    );
    const idx = await loadProfilesIndex();
    expect(Object.keys(idx.profiles)).toEqual(["work"]);
    expect(idx.active).toBeNull();
  });
});

describe("migration perms + byok", () => {
  it("writes profiles.json with 0600 perms", async () => {
    await ensureProfilesMigrated();
    const st = await stat(getProfilesIndexPath());
    expect(st.mode & 0o777).toBe(0o600);
  });

  it("migrates a legacy byok.json into profiles/default", async () => {
    await writeFile(join(tmpHome, "byok.json"), JSON.stringify({ keys: { openai: "sk-x" } }), {
      mode: 0o600,
    });
    await ensureProfilesMigrated();
    await expect(stat(join(tmpHome, "byok.json"))).rejects.toThrow();
    const moved = await readFile(join(getProfileDir("default"), "byok.json"), "utf8");
    expect(moved).toContain("sk-x");
  });
});
