import { loadCredentials, clearCredentials } from "../lib/credentials.js";
import { hasFlag } from "../lib/args.js";
import { success, error, info } from "../lib/output.js";

/** `octp logout` — remove saved credentials (~/.octopus/credentials). */
export async function logoutCommand(argv: string[]): Promise<number> {
  if (hasFlag(argv, "--help", "-h")) {
    console.log("octp logout — remove saved credentials (~/.octopus/credentials)");
    return 0;
  }
  const creds = await loadCredentials();
  if (!creds) {
    info("Not signed in — nothing to do.");
    return 0;
  }
  try {
    await clearCredentials();
    success(`Signed out of ${creds.orgName}.`);
    return 0;
  } catch (e) {
    // clearCredentials re-throws non-ENOENT — the token is still on disk.
    error(`Could not remove credentials: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}
