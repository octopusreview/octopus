import { createInterface } from "node:readline";
import {
  listProfiles,
  setActiveProfile,
  removeProfile,
  type ProfileSummary,
} from "../lib/profile.js";
import { getActiveProfileName } from "../lib/paths.js";
import { loadCredentials } from "../lib/credentials.js";
import { positionals, hasFlag } from "../lib/args.js";
import { success, error, info, heading, table, c, sanitizeTerminal } from "../lib/output.js";

/**
 * `octp account` — manage signed-in profiles (Azure-CLI `az account` style).
 *   list           Table of all accounts (* marks active)
 *   set [name]     Switch active; no name → list, then pick interactively
 *   show           Show the active account
 *   remove <name>  Delete an account (auto-repoints active)
 * A global `--account <name>` flag overrides the active account for one command.
 */
export async function accountCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    printHelp();
    return 0;
  }
  const [sub, name] = positionals(argv);
  if (!sub || sub === "list") return listAccounts();
  if (sub === "show") return showAccount();
  if (sub === "set" || sub === "use") return setAccount(name);
  if (sub === "remove" || sub === "rm") return removeAccount(name);
  error(`Unknown account subcommand: ${sub}. Use list | set | show | remove.`);
  return 2;
}

async function listAccounts(): Promise<number> {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    info("No accounts yet. Run `octp login` to add one.");
    return 0;
  }
  heading("Accounts");
  table(
    profiles.map((p) => [
      p.active ? c.green(`* ${sanitizeTerminal(p.name)}`) : `  ${sanitizeTerminal(p.name)}`,
      p.creds ? sanitizeTerminal(p.creds.orgName) : c.dim("(not signed in)"),
      p.creds?.userName ? sanitizeTerminal(p.creds.userName) : c.dim("—"),
      p.creds ? sanitizeTerminal(p.creds.baseUrl) : c.dim("—"),
    ]),
    ["Account", "Org", "User", "Server"],
  );
  return 0;
}

async function showAccount(): Promise<number> {
  // getActiveProfileName() honors the --account override, so the header matches
  // the profile loadCredentials() actually resolves (no display/data mismatch).
  const active = getActiveProfileName();
  const creds = await loadCredentials();
  info(c.bold(sanitizeTerminal(active)));
  if (creds) {
    info(`org:    ${sanitizeTerminal(creds.orgName)} (${sanitizeTerminal(creds.orgSlug)})`);
    if (creds.userName) {
      info(
        `user:   ${sanitizeTerminal(creds.userName)}${creds.userEmail ? ` <${sanitizeTerminal(creds.userEmail)}>` : ""}`,
      );
    }
    info(`server: ${sanitizeTerminal(creds.baseUrl)}`);
  } else {
    info(c.dim("(active account has no saved credentials — run `octp login`)"));
  }
  return 0;
}

async function setAccount(name?: string): Promise<number> {
  const profiles = await listProfiles();
  if (profiles.length === 0) {
    error("No accounts yet. Run `octp login` to add one.");
    return 2;
  }

  let target = name;
  if (!target) {
    // "List before you switch": show the numbered list, then prompt.
    if (!process.stdin.isTTY) {
      error("Specify an account name (no TTY for interactive selection). `octp account list` to see them.");
      return 2;
    }
    printNumbered(profiles);
    const picked = await promptSelect(profiles.map((p) => p.name));
    if (!picked) {
      info("No selection — active account unchanged.");
      return 0;
    }
    target = picked;
  }

  try {
    await setActiveProfile(target);
    success(`Active account → ${sanitizeTerminal(target)}`);
    return 0;
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

async function removeAccount(name?: string): Promise<number> {
  if (!name) {
    error("Usage: octp account remove <name>");
    return 2;
  }
  try {
    const { newActive } = await removeProfile(name);
    success(`Removed account ${sanitizeTerminal(name)}.`);
    if (newActive) info(`Active account → ${sanitizeTerminal(newActive)}`);
    else info("No accounts remain. Run `octp login` to add one.");
    return 0;
  } catch (e) {
    error(e instanceof Error ? e.message : String(e));
    return 2;
  }
}

function printNumbered(profiles: ProfileSummary[]): void {
  info("Accounts:");
  profiles.forEach((p, i) => {
    const mark = p.active ? c.green("*") : " ";
    const org = p.creds ? ` — ${sanitizeTerminal(p.creds.orgName)}` : c.dim(" (not signed in)");
    info(`  ${i + 1}) ${mark} ${sanitizeTerminal(p.name)}${org}`);
  });
}

function promptSelect(names: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question("\nSelect account (number or name): ", (raw) => {
      rl.close();
      const t = raw.trim();
      if (!t) return resolve(null);
      const n = Number(t);
      if (Number.isInteger(n) && n >= 1 && n <= names.length) return resolve(names[n - 1]);
      if (names.includes(t)) return resolve(t);
      resolve(null);
    });
  });
}

function printHelp(): void {
  console.log(`octp account — manage signed-in profiles

Usage:
  octp account list              List all accounts (* = active)
  octp account set [name]        Switch active account (no name → pick from a list)
  octp account show              Show the active account
  octp account remove <name>     Delete an account

Global:
  --account <name>               Use a specific account for one command
                                 (e.g. octp whoami --account work)

Add an account with: octp login --account <name>
`);
}
