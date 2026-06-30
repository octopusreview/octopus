import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { loadCredentials } from "../lib/credentials.js";
import { getJson, postJson, del } from "../lib/api.js";
import { positionals, flagValue, hasFlag } from "../lib/args.js";
import { error, success, info, table, c, sanitizeTerminal } from "../lib/output.js";
import type { KnowledgeDocument } from "../lib/types.js";

const USAGE = `octp knowledge — manage knowledge base documents

Usage:
  octp knowledge list                      List knowledge base documents
  octp knowledge add <file> [--title <t>]  Add a file (title defaults to filename)
  octp knowledge remove <id>               Remove a knowledge document`;

// Sent as a JSON string in the request body, so cap the content size to keep
// the payload sane and give a clear error instead of a vague server reject.
const MAX_CONTENT_BYTES = 1024 * 1024; // 1 MB

export async function knowledgeCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    console.log(USAGE);
    return 0;
  }

  const creds = await loadCredentials();
  if (!creds) {
    error("Not signed in. Run `octp login`.");
    return 2;
  }

  const pos = positionals(argv, ["--title"]);
  const sub = pos[0];

  switch (sub) {
    case "list":
      return await listKnowledge(creds.baseUrl, creds.token);
    case "add":
      return await addKnowledge(creds.baseUrl, creds.token, pos[1], flagValue(argv, "--title"));
    case "remove":
      return await removeKnowledge(creds.baseUrl, creds.token, pos[1]);
    default:
      if (sub) error(`Unknown subcommand: ${sub}`);
      else error("Missing subcommand.");
      console.error(USAGE);
      return 2;
  }
}

async function listKnowledge(baseUrl: string, token: string): Promise<number> {
  const res = await getJson<{ documents: KnowledgeDocument[] }>(`${baseUrl}/api/cli/knowledge`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 401) {
      error("Session expired or token revoked. Run `octp login` again.");
      return 1;
    }
    error(`Could not list documents (HTTP ${res.status}: ${res.error})`);
    return 1;
  }

  const { documents } = res.data;
  if (documents.length === 0) {
    info("No knowledge documents found. Use `octp knowledge add <file>` to add one.");
    return 0;
  }

  const rows = documents.map((d) => [
    d.id.slice(0, 8),
    sanitizeTerminal(d.title),
    sanitizeTerminal(d.sourceType),
    sanitizeTerminal(d.status),
    String(d.totalChunks),
    sanitizeTerminal(d.createdAt),
  ]);
  table(rows, ["ID", "Title", "Type", "Status", "Chunks", "Created"]);
  info(c.dim(`\n${documents.length} document${documents.length === 1 ? "" : "s"} total`));
  return 0;
}

async function addKnowledge(
  baseUrl: string,
  token: string,
  file: string | undefined,
  title: string | undefined,
): Promise<number> {
  if (!file) {
    error("Missing <file> argument.");
    console.error(USAGE);
    return 2;
  }

  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch {
    error(`Could not read file: ${file}`);
    return 1;
  }

  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_CONTENT_BYTES) {
    error(
      `File too large: ${(bytes / 1024 / 1024).toFixed(2)} MB exceeds the 1 MB limit for knowledge uploads.`,
    );
    return 1;
  }

  const fileName = basename(file);
  const docTitle = title ?? fileName;

  const res = await postJson<{ document: { id: string; title: string } }>(
    `${baseUrl}/api/cli/knowledge`,
    { title: docTitle, content, fileName },
    token,
  );
  if (!res.ok) {
    if (res.status === 401) {
      error("Session expired or token revoked. Run `octp login` again.");
      return 1;
    }
    error(`Could not add document (HTTP ${res.status}: ${res.error})`);
    return 1;
  }

  success(`Added "${res.data.document.title}" (${res.data.document.id})`);
  return 0;
}

async function removeKnowledge(
  baseUrl: string,
  token: string,
  id: string | undefined,
): Promise<number> {
  if (!id) {
    error("Missing <id> argument.");
    console.error(USAGE);
    return 2;
  }

  const res = await del<unknown>(`${baseUrl}/api/cli/knowledge/${encodeURIComponent(id)}`, token);
  if (!res.ok) {
    if (res.status === 401) {
      error("Session expired or token revoked. Run `octp login` again.");
      return 1;
    }
    error(`Could not remove document (HTTP ${res.status}: ${res.error})`);
    return 1;
  }

  success(`Document ${id} removed.`);
  return 0;
}
