import { loadCredentials, saveCredentials } from "../lib/credentials.js";
import { loadConfig } from "../lib/config.js";
import { runDeviceFlow, buildCredentials } from "../lib/auth.js";
import { normalizeBaseUrl, isTransportSafe } from "../lib/api.js";
import { flagValue, hasFlag } from "../lib/args.js";
import { getActiveProfileName } from "../lib/paths.js";
import { ensureProfile, setActiveProfile } from "../lib/profile.js";
import { error } from "../lib/output.js";

const DEFAULT_BASE_URL = "https://octopus-review.ai";

/**
 * `octp setup-token` — browser auth that prints the raw token to STDOUT for
 * CI/CD capture. The authorize URL + all status text go to STDERR so
 * `TOKEN=$(octp setup-token)` captures only the token. `--save` also persists
 * a local session.
 */
export async function setupTokenCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    printHelp();
    return 0;
  }
  const apiUrlFlag = flagValue(argv, "--api-url");
  const noOpen = hasFlag(argv, "--no-open");
  const save = hasFlag(argv, "--save");
  const insecure = hasFlag(argv, "--insecure");

  const fallback =
    (await loadCredentials())?.baseUrl ?? (await loadConfig()).selfHostedBaseUrl ?? DEFAULT_BASE_URL;
  const normalized = normalizeBaseUrl(apiUrlFlag ?? fallback);
  if (!normalized) {
    error(`Invalid API URL: ${apiUrlFlag ?? fallback}`);
    return 2;
  }
  const baseUrl = normalized;

  if (!isTransportSafe(baseUrl) && !insecure) {
    error(`Refusing to authenticate over insecure transport: ${baseUrl}. Use https, or pass --insecure.`);
    return 2;
  }

  try {
    const identity = await runDeviceFlow(baseUrl, {
      noOpen,
      onAuthorizeUrl: (url) =>
        process.stderr.write(
          noOpen ? `Open this URL to authorize:\n${url}\n` : `Opening browser to authorize: ${url}\n`,
        ),
    });
    if (save) {
      // Persist into the active profile (reflects --account), registering +
      // activating it so it shows up in `octp account list`.
      const profileName = getActiveProfileName();
      await ensureProfile(profileName);
      await saveCredentials(buildCredentials(baseUrl, identity));
      await setActiveProfile(profileName);
    }
    // Token → stdout (the one capturable line). Everything else went to stderr.
    process.stdout.write(identity.token + "\n");
    return 0;
  } catch (err) {
    error(err instanceof Error ? err.message : "Failed to obtain token");
    return 1;
  }
}

function printHelp(): void {
  console.log(`octp setup-token — print an API token to stdout (for CI/CD)

Usage:
  TOKEN=$(octp setup-token)        Authenticate, capture the token
  octp setup-token --no-open       Don't auto-open the browser (print the URL)
  octp setup-token --save          Also save a local session (~/.octopus/credentials)

Flags:
  --api-url <url>                  Server base URL
  --no-open                        Don't open the browser automatically
  --save                           Persist the token as a local session too
  --insecure                       Allow cleartext HTTP transport
  --help, -h                       This help
`);
}
