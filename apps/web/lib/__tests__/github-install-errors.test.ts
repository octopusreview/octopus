import { describe, expect, it } from "bun:test";

import {
  ERROR_MESSAGES,
  ERROR_TITLES,
  GITHUB_INSTALL_ERROR_CODES,
  isGithubInstallErrorCode,
  resolveGithubErrorCopy,
} from "@/lib/github-install-errors";

const OPERATOR_ONLY = ["github_app_not_configured", "github_verification_not_configured", "github_authorization_failed"] as const;
const OPERATOR_HINTS = /client id|client secret|callback url|\.env|restart|GITHUB_APP/i;

describe("resolveGithubErrorCopy", () => {
  it("never shows self-host setup instructions to a cloud customer", () => {
    for (const code of OPERATOR_ONLY) {
      const copy = resolveGithubErrorCopy(code, false);
      expect(copy.title).not.toMatch(OPERATOR_HINTS);
      expect(copy.message).not.toMatch(OPERATOR_HINTS);
      expect(copy.message).toContain("support@octopus-review.ai");
    }
  });

  it("keeps the operator instructions on self-host", () => {
    for (const code of OPERATOR_ONLY) {
      const copy = resolveGithubErrorCopy(code, true);
      expect(copy).toEqual({ title: ERROR_TITLES[code], message: ERROR_MESSAGES[code] });
    }
    expect(resolveGithubErrorCopy("github_verification_not_configured", true).message).toMatch(/client secret/i);
  });

  it("uses the same copy on both deployments for user-facing codes", () => {
    for (const code of GITHUB_INSTALL_ERROR_CODES) {
      if ((OPERATOR_ONLY as readonly string[]).includes(code)) continue;
      expect(resolveGithubErrorCopy(code, false)).toEqual(resolveGithubErrorCopy(code, true));
    }
  });

  it("has a title and a message for every code and rejects unknown codes", () => {
    for (const code of GITHUB_INSTALL_ERROR_CODES) {
      expect(ERROR_TITLES[code].length).toBeGreaterThan(0);
      expect(ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
    expect(isGithubInstallErrorCode("github_verification_not_configured")).toBe(true);
    expect(isGithubInstallErrorCode("__proto__")).toBe(false);
    expect(isGithubInstallErrorCode(null)).toBe(false);
  });
});
