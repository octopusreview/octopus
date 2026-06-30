import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { loadCredentials } from "../lib/credentials.js";
import { getJson } from "../lib/api.js";
import { positionals, hasFlag } from "../lib/args.js";
import { success, error, info, warn, table, c, sanitizeTerminal } from "../lib/output.js";
import { getOctopusHome, ensureOctopusHome } from "../lib/paths.js";

/**
 * `octp skills` — manage Octopus skills (slash-command markdown files) for AI
 * coding agents. Ported from the old commander-based CLI to the plain
 * async-function convention. The skill registry lives under the API base URL
 * (`creds.baseUrl`); the manifest + content endpoints need no auth, but we
 * still require sign-in so the base URL is known.
 */

interface SkillEntry {
  name: string;
  title: string;
  description: string;
  filename: string;
  hash: string;
}

interface SkillsManifest {
  version: number;
  skills: SkillEntry[];
}

interface InstalledSkillState {
  hash: string;
  installedAt: string;
}

interface SkillsState {
  lastKnownVersion: number;
  lastCheckedAt: string;
  installed: Record<string, InstalledSkillState>;
}

const COMMANDS_DIR = join(process.cwd(), ".claude", "commands");

function stateFile(): string {
  return join(getOctopusHome(), "skills-state.json");
}

// --- State persistence (tolerant load; ensure-home before save) ---

async function loadState(): Promise<SkillsState> {
  try {
    const data = await readFile(stateFile(), "utf8");
    const parsed = JSON.parse(data) as Partial<SkillsState>;
    return {
      lastKnownVersion:
        typeof parsed.lastKnownVersion === "number" ? parsed.lastKnownVersion : 0,
      lastCheckedAt: typeof parsed.lastCheckedAt === "string" ? parsed.lastCheckedAt : "",
      installed:
        parsed.installed && typeof parsed.installed === "object" ? parsed.installed : {},
    };
  } catch {
    return { lastKnownVersion: 0, lastCheckedAt: "", installed: {} };
  }
}

async function saveState(state: SkillsState): Promise<void> {
  await ensureOctopusHome();
  await writeFile(stateFile(), JSON.stringify(state, null, 2), "utf8");
}

// --- Helpers ---

async function fetchManifest(baseUrl: string): Promise<SkillsManifest | null> {
  const res = await getJson<SkillsManifest>(`${baseUrl}/skills/skills.json`);
  if (!res.ok) {
    error(`Failed to fetch skills list: ${res.error}`);
    return null;
  }
  return res.data;
}

/**
 * Download skill content as plain text. api.js has no text helper (getJson
 * parses JSON), so this uses a direct fetch — the one foundation gap here.
 */
async function fetchSkillContent(baseUrl: string, filename: string): Promise<string> {
  const res = await fetch(`${baseUrl}/skills/${filename}`, {
    headers: { "user-agent": "octp-cli/0.1" },
  });
  if (!res.ok) {
    throw new Error(`Failed to download skill file: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Reject path traversal — filename must be a bare `*.md` basename. */
function validateFilename(filename: string): string {
  const safe = basename(filename);
  if (!safe.endsWith(".md") || safe !== filename) {
    throw new Error(`Invalid skill filename: ${filename}`);
  }
  return safe;
}

// --- Subcommands ---

async function listSkills(baseUrl: string): Promise<number> {
  const manifest = await fetchManifest(baseUrl);
  if (!manifest) return 1;

  const state = await loadState();

  if (manifest.version > state.lastKnownVersion && state.lastKnownVersion > 0) {
    info(c.cyan("New skills available!"));
  }

  state.lastKnownVersion = manifest.version;
  state.lastCheckedAt = new Date().toISOString();
  await saveState(state);

  if (manifest.skills.length === 0) {
    info("No skills available.");
    return 0;
  }

  const rows: string[][] = [];
  for (const skill of manifest.skills) {
    const installed = state.installed[skill.name];
    let status: string;
    if (installed) {
      status =
        installed.hash !== skill.hash
          ? `${c.green("installed")} ${c.yellow("(update available)")}`
          : c.green("installed");
    } else {
      status = c.dim("not installed");
    }
    rows.push([
      c.bold(sanitizeTerminal(skill.name)),
      skill.description ? sanitizeTerminal(skill.description) : c.dim("—"),
      status,
    ]);
  }
  table(rows, ["Name", "Description", "Status"]);
  return 0;
}

async function installSkills(
  baseUrl: string,
  name: string | undefined,
  all: boolean,
): Promise<number> {
  if (!name && !all) {
    error("Provide a skill name or use --all to install all skills.");
    return 2;
  }

  const manifest = await fetchManifest(baseUrl);
  if (!manifest) return 1;

  const toInstall = all
    ? manifest.skills
    : manifest.skills.filter((s) => s.name === name);

  if (toInstall.length === 0) {
    error(`Skill "${name}" not found. Run \`octp skills list\` to see available skills.`);
    return 1;
  }

  await mkdir(COMMANDS_DIR, { recursive: true });
  const state = await loadState();
  let failed = false;

  for (const skill of toInstall) {
    const installed = state.installed[skill.name];

    if (installed && installed.hash === skill.hash) {
      info(`${c.bold(skill.name)} is already up to date.`);
      continue;
    }

    try {
      const safeFilename = validateFilename(skill.filename);
      const content = await fetchSkillContent(baseUrl, safeFilename);

      const downloadedHash = computeHash(content);
      if (downloadedHash !== skill.hash) {
        error(
          `Hash mismatch for ${c.bold(skill.name)}: expected ${skill.hash.slice(0, 12)}… got ${downloadedHash.slice(0, 12)}…. Aborting.`,
        );
        failed = true;
        continue;
      }

      await writeFile(join(COMMANDS_DIR, safeFilename), content, "utf8");
      state.installed[skill.name] = {
        hash: skill.hash,
        installedAt: new Date().toISOString(),
      };

      if (installed) {
        success(`Updated ${c.bold(skill.name)}.`);
      } else {
        success(`Installed ${c.bold(skill.name)}. Use it with: ${c.cyan(`/${skill.name}`)}`);
      }
    } catch (e) {
      error(`Failed to install ${skill.name}: ${e instanceof Error ? e.message : String(e)}`);
      failed = true;
    }
  }

  state.lastKnownVersion = manifest.version;
  state.lastCheckedAt = new Date().toISOString();
  await saveState(state);
  return failed ? 1 : 0;
}

async function updateSkills(baseUrl: string): Promise<number> {
  const manifest = await fetchManifest(baseUrl);
  if (!manifest) return 1;

  const state = await loadState();
  const installedNames = Object.keys(state.installed);

  if (installedNames.length === 0) {
    info(`No skills installed. Run ${c.cyan("octp skills install <name>")} first.`);
    return 0;
  }

  let updated = 0;
  let upToDate = 0;
  let failed = false;

  for (const name of installedNames) {
    const skill = manifest.skills.find((s) => s.name === name);
    if (!skill) {
      warn(`Skill "${name}" no longer exists in registry, skipping.`);
      continue;
    }

    if (state.installed[name].hash === skill.hash) {
      upToDate++;
      continue;
    }

    try {
      const safeFilename = validateFilename(skill.filename);
      const content = await fetchSkillContent(baseUrl, safeFilename);

      const downloadedHash = computeHash(content);
      if (downloadedHash !== skill.hash) {
        error(
          `Hash mismatch for ${c.bold(skill.name)}: expected ${skill.hash.slice(0, 12)}… got ${downloadedHash.slice(0, 12)}…. Aborting.`,
        );
        failed = true;
        continue;
      }

      await mkdir(COMMANDS_DIR, { recursive: true });
      await writeFile(join(COMMANDS_DIR, safeFilename), content, "utf8");
      state.installed[name] = {
        hash: skill.hash,
        installedAt: new Date().toISOString(),
      };
      updated++;
    } catch (e) {
      error(`Failed to update ${name}: ${e instanceof Error ? e.message : String(e)}`);
      failed = true;
    }
  }

  state.lastKnownVersion = manifest.version;
  state.lastCheckedAt = new Date().toISOString();
  await saveState(state);

  const parts: string[] = [];
  if (updated > 0) parts.push(`Updated ${updated} skill(s)`);
  if (upToDate > 0) parts.push(`${upToDate} already up to date`);
  success(parts.join(", ") || "Nothing to update.");
  return failed ? 1 : 0;
}

async function removeSkill(baseUrl: string, name: string | undefined): Promise<number> {
  if (!name) {
    error("Usage: octp skills remove <name>");
    return 2;
  }

  const state = await loadState();
  if (!state.installed[name]) {
    error(`Skill "${name}" is not installed.`);
    return 1;
  }

  // Prefer the manifest's filename; fall back to the name-based convention.
  let filename = `${name}.md`;
  const res = await getJson<SkillsManifest>(`${baseUrl}/skills/skills.json`);
  if (res.ok) {
    const skill = res.data.skills.find((s) => s.name === name);
    if (skill) filename = skill.filename;
  }

  const safeFilename = basename(filename);
  try {
    await unlink(join(COMMANDS_DIR, safeFilename));
  } catch (e) {
    if (!(e instanceof Error && "code" in e && (e as { code: string }).code === "ENOENT")) {
      error(`Failed to remove file: ${e instanceof Error ? e.message : String(e)}`);
      return 1;
    }
  }

  delete state.installed[name];
  await saveState(state);
  success(`Removed ${c.bold(name)}.`);
  return 0;
}

function printHelp(): void {
  console.log(`octp skills — manage Octopus skills for AI coding agents

Usage:
  octp skills list                     List available skills + install status
  octp skills install <name>           Install a skill into .claude/commands
  octp skills install --all            Install all available skills
  octp skills update                   Update all installed skills
  octp skills remove <name>            Remove an installed skill
`);
}

export async function skillsCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    printHelp();
    return 0;
  }

  const creds = await loadCredentials();
  if (!creds) {
    error("Not signed in. Run `octp login`.");
    return 2;
  }

  const [sub, name] = positionals(argv);
  const baseUrl = creds.baseUrl;

  switch (sub) {
    case undefined:
    case "list":
      return listSkills(baseUrl);
    case "install":
      return installSkills(baseUrl, name, hasFlag(argv, "--all"));
    case "update":
      return updateSkills(baseUrl);
    case "remove":
      return removeSkill(baseUrl, name);
    default:
      error(`Unknown skills subcommand: ${sub}. Use list | install | update | remove.`);
      return 2;
  }
}
