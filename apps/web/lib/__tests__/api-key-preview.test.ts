import { describe, expect, it } from "bun:test";
import { maskStoredKey } from "../api-key-preview";
import { encryptString } from "../crypto";

describe("API key previews", () => {
  it("fully masks short keys, including overlapping preview boundaries", () => {
    expect(maskStoredKey(null)).toBeNull();
    for (let length = 1; length <= 15; length++) {
      expect(maskStoredKey("x".repeat(length))).toBe("••••••••");
    }
  });

  it("preserves a partially masked preview for longer keys", () => {
    expect(maskStoredKey("sk-1234567890123")).toBe("sk-1234••••••••0123");
  });

  it("masks an encrypted short key after decryption", () => {
    const oldDataKey = process.env.OCTOPUS_DATA_KEY;
    process.env.OCTOPUS_DATA_KEY = "ab".repeat(32);
    try {
      expect(maskStoredKey(encryptString("sk-123456"))).toBe("••••••••");
    } finally {
      if (oldDataKey === undefined) delete process.env.OCTOPUS_DATA_KEY;
      else process.env.OCTOPUS_DATA_KEY = oldDataKey;
    }
  });
});
