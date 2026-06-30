import { loadConfig, saveConfig } from "../lib/config.js";
import { loadCredentials } from "../lib/credentials.js";
import { normalizeBaseUrl } from "../lib/api.js";
import { positionals, hasFlag } from "../lib/args.js";
import { success, error, info, heading, table, c } from "../lib/output.js";

/**
 * `octp config` — read/write ~/.octopus/config.json prefs non-interactively.
 * Replaces the previous stub. Writable keys are the OctopusConfig prefs;
 * baseUrl/org are read-only here (managed by `octp login`).
 */

const WRITABLE = ["provider", "model", "ollamaBaseUrl", "selfHostedBaseUrl"] as const;
const URL_KEYS = new Set(["ollamaBaseUrl", "selfHostedBaseUrl"]);

export async function configCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    printHelp();
    return 0;
  }
  const [sub, key, value] = positionals(argv);
  if (!sub || sub === "list") return listConfig();
  if (sub === "get") return getConfig(key);
  if (sub === "set") return setConfig(key, value);
  error(`Unknown config subcommand: ${sub}. Use get | set | list.`);
  return 2;
}

async function listConfig(): Promise<number> {
  const cfg = await loadConfig();
  const creds = await loadCredentials();
  heading("Config (~/.octopus/config.json)");
  table([
    ["provider", cfg.provider ?? c.dim("(unset)")],
    ["model", cfg.model ?? c.dim("(unset)")],
    ["ollamaBaseUrl", cfg.ollamaBaseUrl ?? c.dim("(default)")],
    ["selfHostedBaseUrl", cfg.selfHostedBaseUrl ?? c.dim("(unset)")],
  ]);
  if (creds) {
    heading("Session (~/.octopus/credentials)");
    table([
      ["baseUrl", creds.baseUrl],
      ["org", `${creds.orgName} (${creds.orgSlug})`],
      [
        "user",
        creds.userName
          ? `${creds.userName}${creds.userEmail ? ` <${creds.userEmail}>` : ""}`
          : c.dim("(unknown)"),
      ],
    ]);
  } else {
    info(c.dim("\nNot signed in. Run `octp login`."));
  }
  return 0;
}

async function getConfig(key?: string): Promise<number> {
  if (!key) {
    error("Usage: octp config get <key>");
    return 2;
  }
  const cfg = await loadConfig();
  const creds = await loadCredentials();
  switch (key) {
    case "provider":
    case "model":
    case "ollamaBaseUrl":
    case "selfHostedBaseUrl":
      console.log(cfg[key] ?? "not set");
      return 0;
    case "baseUrl":
      console.log(creds?.baseUrl ?? "not set");
      return 0;
    case "orgSlug":
      console.log(creds?.orgSlug ?? "not set");
      return 0;
    case "orgId":
      console.log(creds?.orgId ?? "not set");
      return 0;
    default:
      error(
        `Unknown config key: ${key}. Readable: provider, model, ollamaBaseUrl, selfHostedBaseUrl, baseUrl, orgSlug, orgId`,
      );
      return 2;
  }
}

async function setConfig(key?: string, value?: string): Promise<number> {
  if (!key || value === undefined || value === "") {
    error("Usage: octp config set <key> <value>");
    return 2;
  }
  if (!(WRITABLE as readonly string[]).includes(key)) {
    error(
      `Cannot set "${key}". Writable keys: ${WRITABLE.join(", ")}. (baseUrl/org are managed by \`octp login\`.)`,
    );
    return 2;
  }
  let finalValue = value;
  if (URL_KEYS.has(key)) {
    const n = normalizeBaseUrl(value);
    if (!n) {
      error(`Invalid URL for ${key}: ${value}`);
      return 2;
    }
    finalValue = n;
  }
  const cfg = await loadConfig();
  (cfg as Record<string, unknown>)[key] = finalValue;
  await saveConfig(cfg);
  success(`Set ${key} = ${finalValue}`);
  return 0;
}

function printHelp(): void {
  console.log(`octp config — read/write CLI configuration

Usage:
  octp config list                 Show config + current session
  octp config get <key>            Print a single value
  octp config set <key> <value>    Set a writable pref

Writable keys:  provider, model, ollamaBaseUrl, selfHostedBaseUrl
Readable keys:  + baseUrl, orgSlug, orgId  (managed by \`octp login\`)
`);
}
