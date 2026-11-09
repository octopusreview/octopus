import "server-only";
import { githubIndexRateScopeDigests } from "./crypto";

type Input = { installationId: number; providedToken?: string };

/** An opaque token's quota principal cannot be inferred from the token alone. */
export function githubIndexRateScopes(input: Input): string[] {
  if (input.providedToken !== undefined) {
    if (!input.providedToken) {
      throw new Error("GitHub index rate scope is unavailable");
    }
    return githubIndexRateScopeDigests(input.providedToken).map(digest => `github-index:${digest}`);
  }
  if (!Number.isSafeInteger(input.installationId) || input.installationId <= 0) {
    throw new Error("GitHub index rate scope is unavailable");
  }
  return [`github-index-installation:${input.installationId}`];
}
