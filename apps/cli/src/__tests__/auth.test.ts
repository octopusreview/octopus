import { describe, it, expect } from "bun:test";
import { isValidTokenFormat, TOKEN_PREFIX } from "../lib/auth.js";

describe("isValidTokenFormat", () => {
  it("accepts oct_-prefixed tokens with a body", () => {
    expect(isValidTokenFormat("oct_abc123")).toBe(true);
    expect(TOKEN_PREFIX).toBe("oct_");
  });

  it("rejects wrong prefix or empty body", () => {
    expect(isValidTokenFormat("abc123")).toBe(false);
    expect(isValidTokenFormat("oct_")).toBe(false);
    expect(isValidTokenFormat("")).toBe(false);
    expect(isValidTokenFormat("OCT_abc")).toBe(false);
  });
});
