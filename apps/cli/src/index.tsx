#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { OnboardWizard } from "./OnboardWizard.js";
import { isOnboarded, loadConfig } from "./lib/config.js";
import { agentServeCommand } from "./commands/agent-serve.js";

const VERSION = "0.1.0";

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

const KNOWN_SUBCOMMANDS = new Set([
  "onboard",
  "review",
  "agent",
  "config",
  "doctor",
]);

function printHelp(): void {
  console.log(`octp ${VERSION} — Octopus CLI

Usage:
  octp                       Launch the onboarding wizard (first run) or dashboard
  octp onboard [--reset]     Run the onboarding wizard explicitly
  octp review <pr>           Trigger a review on a pull request          (coming soon)
  octp agent serve           Run as a local-agent bridge (poll for tasks, run via Ollama)
  octp config <get|set>      Manage ~/.octopus/config.json               (coming soon)
  octp doctor                Environment + auth health check             (coming soon)

octp agent serve flags:
  --name <name>              Agent name reported to the server (default: hostname-pid)
  --verbose, -v              Log every task claim + completion

Flags:
  --skip-onboard             Skip the first-run wizard
  --reset                    Re-run the onboarding wizard, pre-seeding existing config
  --version, -v              Print version
  --help, -h                 Print this help

Environment:
  OCTOPUS_HOME               Override the config/secrets directory (default ~/.octopus)
  OCTOPUS_NO_ONBOARD=1       Permanently skip the first-run wizard

Docs:  https://github.com/octopusreview/octopus
`);
}

async function main(argv: string[]): Promise<number> {
  const first = argv[0];

  if (first === "--version" || first === "-v") {
    console.log(VERSION);
    return 0;
  }
  if (first === "--help" || first === "-h") {
    printHelp();
    return 0;
  }

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
    return await renderWizard();
  }

  if (first === "onboard") {
    return await renderWizard();
  }

  if (first === "agent") {
    const sub = argv[1];
    if (sub === "serve") {
      return await agentServeCommand(argv.slice(2));
    }
    console.error(`Unknown agent subcommand: ${sub ?? "(none)"}`);
    console.error("Try: octp agent serve");
    return 2;
  }

  if (KNOWN_SUBCOMMANDS.has(first)) {
    console.error(`octp ${first}: not yet implemented in this build.`);
    console.error("Tracking: https://github.com/cemoso/octopus/issues?q=workstream%3A");
    return 2;
  }

  console.error(`Unknown command: ${first}`);
  console.error("Run `octp --help` for a list of commands.");
  return 2;
}

async function renderWizard(): Promise<number> {
  await new Promise<void>((resolve) => {
    const { waitUntilExit } = render(<OnboardWizard />);
    waitUntilExit().then(() => resolve());
  });
  return 0;
}

// Reusable entry point for other packages that want to embed onboarding.
export async function ensureOnboardCompleted(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes("--skip-onboard")) return;
  if (process.env.OCTOPUS_NO_ONBOARD === "1") return;
  if (!process.stdin.isTTY) return;

  const config = await loadConfig();
  if (isOnboarded(config) && !argv.includes("--reset") && !argv.includes("--reset-onboard")) return;

  await renderWizard();
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
