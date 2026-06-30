#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { OnboardWizard } from "./OnboardWizard.js";
import { isOnboarded, loadConfig } from "./lib/config.js";
import { agentServeCommand } from "./commands/agent-serve.js";
import { agentWatchCommand } from "./commands/agent-watch.js";
import { doctorCommand } from "./commands/doctor.js";
import { reviewCommand } from "./commands/review.js";
import { loginCommand } from "./commands/login.js";
import { logoutCommand } from "./commands/logout.js";
import { whoamiCommand } from "./commands/whoami.js";
import { setupTokenCommand } from "./commands/setup-token.js";
import { configCommand } from "./commands/config.js";
import { repoCommand } from "./commands/repo.js";
import { knowledgeCommand } from "./commands/knowledge.js";
import { usageCommand } from "./commands/usage.js";
import { analyzeDepsCommand } from "./commands/analyze-deps.js";
import { skillsCommand } from "./commands/skills.js";
import { updateCommand } from "./commands/update.js";
import { chatCommand } from "./commands/chat.js";
import { accountCommand } from "./commands/account.js";
import { ensureProfilesMigrated, isValidProfileName, ensureProfile, setActiveProfile } from "./lib/profile.js";
import { setActiveProfileOverride } from "./lib/paths.js";
import { flagValue } from "./lib/args.js";

const VERSION = "0.1.0";

/** Remove a `--flag <value>` pair from argv (the value is dropped only when the
 *  next token isn't itself a flag). Used to peel the global --account/--profile
 *  flag off before a command parses its own positionals. */
function stripValueFlag(argv: string[], flag: string): string[] {
  const out = argv.slice();
  let i = out.indexOf(flag);
  while (i !== -1) {
    const hasValue = out[i + 1] !== undefined && !out[i + 1].startsWith("-");
    out.splice(i, hasValue ? 2 : 1);
    i = out.indexOf(flag);
  }
  return out;
}

/**
 * Top-level CLI entry. Parses the first arg as a subcommand and dispatches.
 *
 * Layout:
 *   octp                  → if not onboarded, run the wizard; otherwise print
 *                           a one-line hint. With --skip-onboard or non-TTY
 *                           stdin, exit 0 without rendering.
 *   octp onboard [--reset]→ run the wizard explicitly
 *   octp review <pr>      → trigger a review on demand          (TODO — WS2/CLI)
 *   octp agent serve      → start the local-agent bridge        (TODO — WS2.7)
 *   octp config <get|set> → manage ~/.octopus/config.json       (TODO)
 *   octp doctor           → environment + auth health check     (TODO — WS6.6)
 *   octp --version | -v   → print version
 *   octp --help | -h      → print help
 *
 * Unknown subcommands and flags fail fast with a help hint — the WS6.6 pattern.
 */

function printHelp(): void {
  console.log(`octp ${VERSION} — Octopus CLI

Usage:
  octp                       Onboarding wizard (first run) or status hint
  octp onboard [--reset]     Run the onboarding wizard

Auth & accounts:
  octp login [--token ...]   Sign in (browser device-flow or --token)
  octp logout                Remove the active account's credentials
  octp whoami                Show the signed-in user + org
  octp setup-token           Print a token to stdout (for CI/CD)
  octp account <list|set|show|remove>   Manage signed-in accounts (profiles)

Reviews:
  octp review [--staged|--since <ref>]   Review local changes pre-PR
  octp review --pr <n|url>               Review an existing PR/MR (posts comments)
  octp chat [repo] [-p <msg>] [-g]       Chat with your codebase

Repositories & knowledge:
  octp repo <list|status|index|analyze> [repo]   Manage connected repos
  octp knowledge <list|add|remove>               Manage the knowledge base
  octp analyze-deps <repo-url>                    Scan dependencies for advisories
  octp usage                                     Show spend + token usage

Agent & ops:
  octp agent serve           Run the local agent (Ollama LLM tasks + code-search)
  octp agent watch [path]    Watch a repo dir so cloud chat can search it locally
  octp config <get|set|list> Manage ~/.octopus/config.json
  octp skills <list|install|update|remove>       Manage AI-agent skills
  octp doctor                Environment + auth health check
  octp update [--check]      Update the CLI

Flags:
  --account <name>           Use a specific account for one command (e.g. --account work)
  --version, -v              Print version
  --help, -h                 Print this help
  (run \`octp <command> --help\` for command-specific flags)

Environment:
  OCTOPUS_HOME               Override the config/secrets directory (default ~/.octopus)
  OCTOPUS_NO_ONBOARD=1       Permanently skip the first-run wizard

Docs:  https://github.com/octopusreview/octopus
`);
}

async function main(rawArgv: string[]): Promise<number> {
  // Global --account / --profile: select the active profile for this run, then
  // strip the flag so it doesn't leak into a command's positional parsing.
  const acctFlag = flagValue(rawArgv, "--account") ?? flagValue(rawArgv, "--profile");
  if ((rawArgv.includes("--account") || rawArgv.includes("--profile")) && acctFlag === undefined) {
    console.error("--account requires an account name (e.g. --account work).");
    return 2;
  }
  let argv = rawArgv;
  if (acctFlag !== undefined) {
    if (!isValidProfileName(acctFlag)) {
      console.error(
        `Invalid account name "${acctFlag}". Use letters, digits, dot, dash, or underscore.`,
      );
      return 2;
    }
    setActiveProfileOverride(acctFlag);
    argv = stripValueFlag(stripValueFlag(rawArgv, "--account"), "--profile");
  }

  const first = argv[0];

  if (first === "--version" || first === "-v") {
    console.log(VERSION);
    return 0;
  }
  if (first === "--help" || first === "-h") {
    printHelp();
    return 0;
  }

  // Migrate the legacy single-context layout to per-profile dirs (idempotent;
  // a no-op after the first run). Must precede any credential read/write.
  await ensureProfilesMigrated();

  // No subcommand: gate on first-run + TTY, then render the wizard (or exit cleanly).
  if (first === undefined || first.startsWith("-")) {
    if (argv.includes("--skip-onboard")) return 0;
    if (process.env.OCTOPUS_NO_ONBOARD === "1") return 0;
    if (!process.stdin.isTTY) return 0;

    const config = await loadConfig();
    if (isOnboarded(config) && !argv.includes("--reset")) {
      // For now, an onboarded user with no subcommand just sees a one-line hint.
      // Interactive dashboard belongs in a follow-up PR.
      console.log("You're set. Try `octp --help` for available commands.");
      return 0;
    }
    {
      const code = await renderWizard(argv.includes("--reset"));
      // If signing in under a named account (--account), register + activate it
      // so the wizard's credentials land in a tracked profile (parity with login).
      if (acctFlag) {
        await ensureProfile(acctFlag);
        await setActiveProfile(acctFlag);
      }
      return code;
    }
  }

  if (first === "onboard") {
    {
      const code = await renderWizard(argv.includes("--reset"));
      // If signing in under a named account (--account), register + activate it
      // so the wizard's credentials land in a tracked profile (parity with login).
      if (acctFlag) {
        await ensureProfile(acctFlag);
        await setActiveProfile(acctFlag);
      }
      return code;
    }
  }

  const rest = argv.slice(1);
  switch (first) {
    case "login":
      return await loginCommand(rest);
    case "logout":
      return await logoutCommand(rest);
    case "whoami":
      return await whoamiCommand(rest);
    case "setup-token":
      return await setupTokenCommand(rest);
    case "config":
      return await configCommand(rest);
    case "review":
      return await reviewCommand(rest);
    case "chat":
      return await chatCommand(rest);
    case "repo":
      return await repoCommand(rest);
    case "knowledge":
      return await knowledgeCommand(rest);
    case "analyze-deps":
      return await analyzeDepsCommand(rest);
    case "usage":
      return await usageCommand(rest);
    case "skills":
      return await skillsCommand(rest);
    case "update":
      return await updateCommand(rest);
    case "doctor":
      return await doctorCommand(rest);
    case "account":
    case "profile":
      return await accountCommand(rest);
    case "agent": {
      const sub = argv[1];
      if (sub === "serve") return await agentServeCommand(argv.slice(2));
      if (sub === "watch") return await agentWatchCommand(argv.slice(2));
      console.error(`Unknown agent subcommand: ${sub ?? "(none)"}`);
      console.error("Try: octp agent serve | octp agent watch");
      return 2;
    }
  }

  console.error(`Unknown command: ${first}`);
  console.error("Run `octp --help` for a list of commands.");
  return 2;
}

async function renderWizard(reset = false): Promise<number> {
  await new Promise<void>((resolve) => {
    const { waitUntilExit } = render(<OnboardWizard reset={reset} />);
    waitUntilExit().then(() => resolve());
  });
  return 0;
}

// Reusable entry point for other packages that want to embed onboarding.
export async function ensureOnboardCompleted(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--skip-onboard")) return;
  if (process.env.OCTOPUS_NO_ONBOARD === "1") return;
  if (!process.stdin.isTTY) return;

  // Keep the profile layout migrated for embedders that bypass main().
  await ensureProfilesMigrated();

  const config = await loadConfig();
  const reset = argv.includes("--reset") || argv.includes("--reset-onboard");
  if (isOnboarded(config) && !reset) return;

  await renderWizard(reset);
}

// When invoked directly (octp binary), parse argv and dispatch.
// Path-suffix sniffing was fragile across platforms (Windows backslash,
// .exe vs no .exe, custom rename, install path). The ES-module-standard
// `import.meta.url` equality check works the same way on every platform
// and correctly distinguishes "this file is the entrypoint" from "this
// file was imported by something else."
//
// On Bun's --compile binary, `import.meta.url` is a file://... URL pointing
// at the compiled entry; comparing against pathToFileURL(process.argv[1])
// (the executable Node-style first arg) matches when invoked directly and
// not when imported as a library.
import { pathToFileURL } from "node:url";

const isDirectInvocation =
  typeof process !== "undefined" &&
  typeof process.argv?.[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
