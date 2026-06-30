import { createInterface } from "node:readline";
import { loadCredentials } from "../lib/credentials.js";
import { streamData } from "../lib/api.js";
import { hasFlag, flagValue, positionals } from "../lib/args.js";
import { resolveRepo } from "../lib/repo-resolver.js";
import { error, info, c, sanitizeTerminal } from "../lib/output.js";

const USAGE = `octp chat — chat with Octopus about a repository

Usage:
  octp chat [repo] [-p|--print <message>] [-g|--global]

Arguments:
  repo                 Repository name or full name (auto-detects from git remote)

Options:
  -p, --print <msg>    Pipeline mode: ask a single question, print the answer, exit
  -g, --global         Ask across all repos in your organization (no repo resolution)
  -h, --help           Show this help

Pipeline mode is also used automatically when stdin is not a TTY (piped input).`;

const CHAT_TIMEOUT_MS = (() => {
  const v = Number(process.env.OCTP_CHAT_TIMEOUT_MS ?? 5 * 60_000);
  return Number.isNaN(v) ? 5 * 60_000 : v;
})();

/** Read all of stdin to a trimmed string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** `octp chat` — interactive or pipeline chat backed by /api/cli/chat. */
export async function chatCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    console.log(USAGE);
    return 0;
  }

  const creds = await loadCredentials();
  if (!creds) {
    error("Not signed in. Run `octp login`.");
    return 2;
  }

  const printMsg = flagValue(argv, "-p") ?? flagValue(argv, "--print");
  const isPrintFlag = hasFlag(argv, "-p", "--print");
  const isGlobal = hasFlag(argv, "-g", "--global");
  const isPipeline = isPrintFlag || !process.stdin.isTTY;

  const repoArg = positionals(argv, ["-p", "--print"])[0];

  let repoId: string | null = null;
  let label = "your organization";
  if (!isGlobal) {
    const resolved = await resolveRepo(creds, repoArg);
    if (!resolved.ok) {
      error(resolved.error);
      return 1;
    }
    repoId = resolved.repo.id;
    label = resolved.repo.fullName;
  }

  const url = `${creds.baseUrl}/api/cli/chat`;

  // Pipeline mode: single question -> stream answer -> exit.
  if (isPipeline) {
    const message = printMsg ?? (await readStdin());
    if (!message) {
      error("No message provided. Use -p <message> or pipe via stdin.");
      return 1;
    }

    let hadError = false;
    const result = await streamData(url, { message, conversationId: null, repoId }, creds.token, (data) => {
      if (data.type === "delta" && typeof data.text === "string") {
        process.stdout.write(sanitizeTerminal(data.text));
      } else if (data.type === "error") {
        hadError = true;
        const m = typeof data.message === "string" ? data.message : "chat failed";
        process.stderr.write(`\n${sanitizeTerminal(m)}\n`);
      }
    }, CHAT_TIMEOUT_MS);

    process.stdout.write("\n");
    if (!result.ok) {
      error(`Chat request failed (HTTP ${result.status}: ${result.error})`);
      return 1;
    }
    return hadError ? 1 : 0;
  }

  // Interactive REPL.
  info(`Chatting about ${c.bold(label)}. Type 'exit' or Ctrl+C to quit.\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let conversationId: string | null = null;
  let exitCode = 0;

  return await new Promise<number>((resolve) => {
    let closed = false;
    const finish = (code: number) => {
      if (closed) return;
      closed = true;
      exitCode = code;
      rl.close();
    };

    rl.on("close", () => resolve(exitCode));
    rl.on("SIGINT", () => finish(0));

    const ask = () => {
      rl.question(c.cyan("you> "), (raw) => {
        const message = raw.trim();
        if (!message) {
          ask();
          return;
        }
        if (message.toLowerCase() === "exit") {
          finish(0);
          return;
        }

        process.stdout.write(c.green("octopus> "));
        streamData(url, { message, conversationId, repoId }, creds.token, (data) => {
          if (data.type === "conversation_id" && typeof data.id === "string") {
            conversationId = data.id;
          } else if (data.type === "delta" && typeof data.text === "string") {
            process.stdout.write(sanitizeTerminal(data.text));
          } else if (data.type === "error") {
            const m = typeof data.message === "string" ? data.message : "chat failed";
            process.stdout.write(c.red(`\n${sanitizeTerminal(m)}`));
          }
        }, CHAT_TIMEOUT_MS)
          .then((result) => {
            if (!result.ok) {
              process.stdout.write(c.red(`\nChat request failed (HTTP ${result.status}: ${result.error})`));
            }
            process.stdout.write("\n\n");
            if (!closed) ask();
          });
      });
    };

    ask();
  });
}
