import { resolve } from "node:path";
import { addWatch, removeWatch, loadWatchConfig } from "../lib/agent-watch.js";
import { positionals, hasFlag } from "../lib/args.js";
import { success, error, info, c, sanitizeTerminal } from "../lib/output.js";

/**
 * `octp agent watch [path]` — manage the per-account watch-list that
 * `octp agent serve` uses to serve code-search tasks. Maps a local dir to the
 * `owner/repo` its git origin points at.
 *   octp agent watch [path]      add (defaults to cwd)
 *   octp agent watch --list      show the watch-list
 *   octp agent watch [path] --remove   stop watching a dir
 */
export async function agentWatchCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    printHelp();
    return 0;
  }

  if (hasFlag(argv, "--list")) {
    const cfg = await loadWatchConfig();
    if (cfg.entries.length === 0) {
      info("No watched repos for this account. `octp agent watch [path]` to add one.");
      return 0;
    }
    info("Watched repos (current account):");
    for (const e of cfg.entries) {
      info(`  ${sanitizeTerminal(e.path)} → ${sanitizeTerminal(e.repoFullName)}`);
    }
    return 0;
  }

  const pathArg = positionals(argv)[0] ?? ".";

  if (hasFlag(argv, "--remove")) {
    const removed = await removeWatch(pathArg);
    if (removed) {
      success(`Unwatched ${sanitizeTerminal(removed)}`);
    } else {
      info(`Not watching ${sanitizeTerminal(resolve(pathArg))} — nothing to remove.`);
    }
    return 0;
  }

  const res = await addWatch(pathArg);
  if (!res.ok) {
    error(res.error);
    return 2;
  }
  success(`Watching ${sanitizeTerminal(res.entry.path)} → ${sanitizeTerminal(res.entry.repoFullName)}`);
  info(c.dim("Run `octp agent serve` to serve code-search tasks for it."));
  return 0;
}

function printHelp(): void {
  console.log(`octp agent watch — manage the code-search watch-list (per account)

Usage:
  octp agent watch [path]        Watch a repo dir (defaults to current dir)
  octp agent watch --list        List watched repos for the active account
  octp agent watch [path] --remove   Stop watching a dir

The watch-list maps a local directory to its git \`origin\` repo. \`octp agent
serve\` registers those repos and answers code-search questions about them
(from cloud "Ask Octopus") against your live local files.
`);
}
