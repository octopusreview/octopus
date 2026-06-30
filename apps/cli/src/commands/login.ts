import { loadConfig } from "../lib/config.js";
import { loadCredentials, saveCredentials } from "../lib/credentials.js";
import {
  runDeviceFlow,
  verifyToken,
  isValidTokenFormat,
  buildCredentials,
  type AuthIdentity,
} from "../lib/auth.js";
import { normalizeBaseUrl, isTransportSafe } from "../lib/api.js";
import { flagValue, hasFlag } from "../lib/args.js";
import { success, error, info, c, sanitizeTerminal } from "../lib/output.js";

const DEFAULT_BASE_URL = "https://octopus-review.ai";

/**
 * `octp login` — standalone, scriptable auth. Browser device-flow by default,
 * or `--token oct_…` for headless/CI. Writes ~/.octopus/credentials.
 *
 * Base URL precedence: --api-url > existing creds > config.selfHostedBaseUrl >
 * hosted default. We refuse to send the token over cleartext HTTP to a
 * non-local host unless --insecure is passed (a token leak to any on-path
 * observer otherwise).
 */
export async function loginCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    printHelp();
    return 0;
  }

  const token = flagValue(argv, "--token");
  const apiUrlFlag = flagValue(argv, "--api-url");
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
    error(
      `Refusing to send credentials over insecure transport: ${baseUrl}\n` +
        `Use an https URL (or a loopback / private-LAN host), or pass --insecure to override.`,
    );
    return 2;
  }

  try {
    let identity: AuthIdentity;
    if (token) {
      if (!isValidTokenFormat(token)) {
        error("Invalid token format. Tokens start with 'oct_'.");
        return 2;
      }
      const verified = await verifyToken(baseUrl, token);
      identity = { token, organization: verified.organization, user: verified.user };
    } else {
      identity = await runDeviceFlow(baseUrl, { onAuthorizeUrl: (url) => info(c.dim(url)) });
    }
    await saveCredentials(buildCredentials(baseUrl, identity));
    const email = identity.user.email ? ` (${sanitizeTerminal(identity.user.email)})` : "";
    success(
      `Logged in as ${sanitizeTerminal(identity.user.name)}${email} — org: ${sanitizeTerminal(identity.organization.name)}`,
    );
    return 0;
  } catch (err) {
    error(err instanceof Error ? err.message : "Login failed");
    return 1;
  }
}

function printHelp(): void {
  console.log(`octp login — authenticate with Octopus

Usage:
  octp login                     Browser device-flow sign-in
  octp login --token oct_...      Sign in with a token (headless / CI)

Flags:
  --token <oct_...>              API token; skips the browser
                                 (exposes the token via process args (ps) and shell history; for CI prefer 'octp setup-token')
  --api-url <url>                Server base URL (default: hosted, or your saved server)
  --insecure                     Allow sending the token over cleartext HTTP (not recommended)
  --help, -h                     This help
`);
}
