import { describe, it, expect } from "bun:test";
import crypto from "node:crypto";
import {
  safeReturnTo,
  maskEmail,
  cuid,
  normalizeHost,
  signSessionCookie,
  parseScimIdentity,
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// safeReturnTo — security-critical open-redirect guard.
// Every case here represents a real attack vector documented in the original
// PR review finding. If any of these regress to anything other than
// "/dashboard", the user is one bad redirect away from a phishing page.
// ─────────────────────────────────────────────────────────────────────────────
describe("safeReturnTo", () => {
  it("returns /dashboard for null / empty", () => {
    expect(safeReturnTo(null)).toBe("/dashboard");
    expect(safeReturnTo("")).toBe("/dashboard");
  });

  it("preserves valid same-origin paths", () => {
    expect(safeReturnTo("/dashboard")).toBe("/dashboard");
    expect(safeReturnTo("/settings/billing")).toBe("/settings/billing");
    expect(safeReturnTo("/repositories/abc123/graph")).toBe("/repositories/abc123/graph");
    expect(safeReturnTo("/foo?bar=baz&qux=1")).toBe("/foo?bar=baz&qux=1");
  });

  it("rejects relative paths (must start with /)", () => {
    expect(safeReturnTo("dashboard")).toBe("/dashboard");
    expect(safeReturnTo("../etc/passwd")).toBe("/dashboard");
    expect(safeReturnTo("./settings")).toBe("/dashboard");
  });

  it("rejects protocol-relative URLs (//evil.com)", () => {
    expect(safeReturnTo("//evil.com")).toBe("/dashboard");
    expect(safeReturnTo("//evil.com/dashboard")).toBe("/dashboard");
    expect(safeReturnTo("///evil.com")).toBe("/dashboard");
  });

  it("rejects backslash-prefixed paths (Windows-style host)", () => {
    expect(safeReturnTo("/\\evil.com")).toBe("/dashboard");
    expect(safeReturnTo("/\\\\evil.com")).toBe("/dashboard");
  });

  it("rejects URL-encoded slashes (decoded host bypass)", () => {
    // /%2Fevil.com decodes to //evil.com which would escape the origin
    expect(safeReturnTo("/%2Fevil.com")).toBe("/dashboard");
    // /%5Cevil.com decodes to /\evil.com (Windows-style host)
    expect(safeReturnTo("/%5Cevil.com")).toBe("/dashboard");
    // Uppercase encoding
    expect(safeReturnTo("/%2fEVIL.com")).toBe("/dashboard");
  });

  it("rejects absolute URLs (http://evil.com)", () => {
    expect(safeReturnTo("http://evil.com")).toBe("/dashboard");
    expect(safeReturnTo("https://evil.com/dashboard")).toBe("/dashboard");
    expect(safeReturnTo("javascript:alert(1)")).toBe("/dashboard");
    expect(safeReturnTo("data:text/html,<script>alert(1)</script>")).toBe("/dashboard");
  });

  it("rejects CR/LF (header injection defense)", () => {
    expect(safeReturnTo("/dashboard\r\nSet-Cookie: evil=1")).toBe("/dashboard");
    expect(safeReturnTo("/dashboard\nLocation: https://evil.com")).toBe("/dashboard");
    expect(safeReturnTo("/foo\rbar")).toBe("/dashboard");
  });

  it("rejects malformed percent-encoding", () => {
    // %ZZ is invalid → decodeURIComponent throws → fall back to default
    expect(safeReturnTo("/%ZZbroken")).toBe("/dashboard");
    expect(safeReturnTo("/%E0%A4")).toBe("/dashboard");
  });

  it("rejects oversize payloads (>2KiB)", () => {
    const long = "/a" + "x".repeat(2050);
    expect(safeReturnTo(long)).toBe("/dashboard");
  });

  it("accepts paths just under the 2KiB cap", () => {
    const ok = "/a" + "x".repeat(2046); // 2048 chars total
    expect(safeReturnTo(ok)).toBe(ok);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// maskEmail — PII redaction for logs
// ─────────────────────────────────────────────────────────────────────────────
describe("maskEmail", () => {
  it("masks middle of local-part", () => {
    expect(maskEmail("dermot.smyth@databricks.com")).toBe("d***@databricks.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
  });

  it("preserves domain unchanged", () => {
    expect(maskEmail("user@subdomain.example.co.uk")).toBe("u***@subdomain.example.co.uk");
  });

  it("returns *** for malformed emails (no @)", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("")).toBe("***");
  });

  it("returns *** for empty local-part", () => {
    expect(maskEmail("@example.com")).toBe("***");
  });

  it("never returns the raw email", () => {
    const inputs = [
      "alice@a.b",
      "Bob@Company.Co",
      "x.y.z+tag@example.org",
    ];
    for (const e of inputs) expect(maskEmail(e)).not.toBe(e);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cuid — id generator for User/Session rows
// ─────────────────────────────────────────────────────────────────────────────
describe("cuid", () => {
  it("produces a 25-char string prefixed with c", () => {
    const id = cuid();
    expect(id).toMatch(/^c[0-9a-f]{24}$/);
  });

  it("produces unique values across calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(cuid());
    expect(ids.size).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeHost
// ─────────────────────────────────────────────────────────────────────────────
describe("normalizeHost", () => {
  it("prepends https:// when scheme is missing", () => {
    expect(normalizeHost("example.databricks.com")).toBe("https://example.databricks.com");
  });

  it("preserves https:// when present", () => {
    expect(normalizeHost("https://example.databricks.com")).toBe("https://example.databricks.com");
  });

  it("preserves http:// (for local dev)", () => {
    expect(normalizeHost("http://localhost:8000")).toBe("http://localhost:8000");
  });

  it("strips trailing slash", () => {
    expect(normalizeHost("https://example.com/")).toBe("https://example.com");
    expect(normalizeHost("example.com/")).toBe("https://example.com");
  });

  it("returns empty string for undefined / empty input", () => {
    expect(normalizeHost(undefined)).toBe("");
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost("   ")).toBe("");
  });

  it("trims whitespace", () => {
    expect(normalizeHost("  https://example.com  ")).toBe("https://example.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// signSessionCookie — Better-Auth v1.x signed-cookie format
// Format: `${token}.${base64(HMAC-SHA256(secret, token))}`
// ─────────────────────────────────────────────────────────────────────────────
describe("signSessionCookie", () => {
  const SECRET = "test-secret-do-not-use-in-prod";
  const TOKEN = "a1b2c3d4e5f6";

  it("returns token + '.' + base64 signature", () => {
    const cookie = signSessionCookie(TOKEN, SECRET, "1.x");
    expect(cookie.startsWith(`${TOKEN}.`)).toBe(true);
    const sig = cookie.slice(TOKEN.length + 1);
    // Base64 of a 32-byte HMAC-SHA256 digest is exactly 44 chars (with padding).
    expect(sig).toMatch(/^[A-Za-z0-9+/]{43}=$/);
  });

  it("produces deterministic signatures for the same input", () => {
    const a = signSessionCookie(TOKEN, SECRET, "1.x");
    const b = signSessionCookie(TOKEN, SECRET, "1.x");
    expect(a).toBe(b);
  });

  it("changes the signature when the token changes", () => {
    const a = signSessionCookie("token-a", SECRET, "1.x");
    const b = signSessionCookie("token-b", SECRET, "1.x");
    expect(a).not.toBe(b);
  });

  it("changes the signature when the secret changes", () => {
    const a = signSessionCookie(TOKEN, "secret-a", "1.x");
    const b = signSessionCookie(TOKEN, "secret-b", "1.x");
    expect(a).not.toBe(b);
  });

  it("matches a reference HMAC-SHA256 computation", () => {
    // Lock in the algorithm — if this assertion breaks, Better-Auth's signed
    // cookie format has changed and we need to bump COOKIE_SIGN_VERSION at
    // the call site and audit the migration impact.
    const expected = crypto.createHmac("sha256", SECRET).update(TOKEN).digest("base64");
    expect(signSessionCookie(TOKEN, SECRET, "1.x")).toBe(`${TOKEN}.${expected}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseScimIdentity — Databricks SCIM /Me response → identity record
// ─────────────────────────────────────────────────────────────────────────────
describe("parseScimIdentity", () => {
  it("uses the primary email when present", () => {
    const r = parseScimIdentity(
      {
        id: "abc-123",
        displayName: "Dermot Smyth",
        emails: [
          { value: "secondary@example.com", primary: false },
          { value: "primary@example.com", primary: true },
        ],
      },
      null,
    );
    expect(r).toEqual({
      email: "primary@example.com",
      name: "Dermot Smyth",
      dbxUserId: "abc-123",
    });
  });

  it("falls back to the first email when none is marked primary", () => {
    const r = parseScimIdentity(
      { id: "u1", emails: [{ value: "first@example.com" }, { value: "second@example.com" }] },
      null,
    );
    expect(r?.email).toBe("first@example.com");
  });

  it("falls back to userName when emails array is missing", () => {
    const r = parseScimIdentity(
      { id: "u1", userName: "user@example.com", displayName: "User" },
      null,
    );
    expect(r?.email).toBe("user@example.com");
    expect(r?.name).toBe("User");
  });

  it("lowercases the email", () => {
    const r = parseScimIdentity(
      { id: "u1", emails: [{ value: "MixedCase@Example.COM", primary: true }] },
      null,
    );
    expect(r?.email).toBe("mixedcase@example.com");
  });

  it("trims whitespace from the email", () => {
    const r = parseScimIdentity(
      { id: "u1", emails: [{ value: "  user@example.com  ", primary: true }] },
      null,
    );
    expect(r?.email).toBe("user@example.com");
  });

  it("uses the SCIM id as dbxUserId when present", () => {
    const r = parseScimIdentity(
      { id: "scim-id-1", emails: [{ value: "u@e.com", primary: true }] },
      "header-fallback",
    );
    expect(r?.dbxUserId).toBe("scim-id-1");
  });

  it("falls back to the header user id when SCIM id is missing", () => {
    const r = parseScimIdentity(
      { emails: [{ value: "u@e.com", primary: true }] },
      "header-fallback",
    );
    expect(r?.dbxUserId).toBe("header-fallback");
  });

  it("uses displayName → userName → email for the name", () => {
    expect(
      parseScimIdentity(
        { displayName: "DN", userName: "UN", emails: [{ value: "e@x.com" }] },
        null,
      )?.name,
    ).toBe("DN");
    expect(
      parseScimIdentity(
        { userName: "UN", emails: [{ value: "e@x.com" }] },
        null,
      )?.name,
    ).toBe("UN");
    expect(
      parseScimIdentity({ emails: [{ value: "e@x.com" }] }, null)?.name,
    ).toBe("e@x.com");
  });

  it("returns null when no usable email can be derived", () => {
    expect(parseScimIdentity({}, null)).toBeNull();
    expect(parseScimIdentity({ id: "x" }, null)).toBeNull();
    expect(parseScimIdentity({ id: "x", emails: [] }, null)).toBeNull();
    expect(parseScimIdentity({ id: "x", emails: [{ value: "" }] }, null)).toBeNull();
    expect(parseScimIdentity({ id: "x", userName: "not-an-email" }, null)).toBeNull();
  });

  it("rejects an email-shaped userName when emails array exists but is empty", () => {
    expect(parseScimIdentity({ userName: "no-at-sign" }, null)).toBeNull();
  });
});
