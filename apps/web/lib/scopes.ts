/**
 * Scope registry for platform-global service tokens (external apps: Claude/MCP/
 * other). Format is `resource:action`, one action axis, deny-by-default. Org-
 * scoped resources (repos, knowledge) belong on OrgApiToken, not here.
 *
 * `blog:delete` is intentionally NOT here yet (deferred with the DELETE endpoint).
 * No wildcard: tokens must enumerate scopes, so a later-added action is never
 * retroactively granted.
 */
export const SCOPE_REGISTRY = {
  blog: ["read", "create", "update"],
} as const;

export const ALL_SCOPES: string[] = Object.entries(SCOPE_REGISTRY).flatMap(
  ([resource, actions]) => actions.map((a) => `${resource}:${a}`),
);

/**
 * Validate + normalize scopes at token-creation time: trim/lowercase/dedupe,
 * reject any scope not in the registry, and reject an empty set (a scopeless
 * token would be silently inert). Throws on invalid input.
 */
export function normalizeScopes(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error("scopes must be an array of strings");
  const cleaned = [
    ...new Set(input.map((s) => String(s).trim().toLowerCase()).filter(Boolean)),
  ];
  const unknown = cleaned.filter((s) => !ALL_SCOPES.includes(s));
  if (unknown.length > 0) {
    throw new Error(`unknown scope(s): ${unknown.join(", ")}. Valid: ${ALL_SCOPES.join(", ")}`);
  }
  if (cleaned.length === 0) throw new Error("at least one scope is required");
  return cleaned;
}

/**
 * Deny-by-default check: true only if the token holds EVERY required scope.
 * (Exact membership; no wildcard expansion.)
 */
export function hasScopes(
  tokenScopes: string[] | null | undefined,
  ...required: string[]
): boolean {
  // Deny-by-default: an empty `required` list must NOT vacuously pass
  // (`[].every()` is true) — a scope check with nothing to check is a bug.
  if (required.length === 0) return false;
  if (!tokenScopes || tokenScopes.length === 0) return false;
  return required.every((r) => tokenScopes.includes(r));
}
