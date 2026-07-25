import { describe, it, expect } from "bun:test";
import { firstNameOf, maskEmail } from "../stage-broadcast";

describe("firstNameOf", () => {
  it("takes the first token", () => {
    expect(firstNameOf("Jane Doe")).toBe("Jane");
    expect(firstNameOf("  Ada  Lovelace ")).toBe("Ada");
  });
  it("falls back to 'there' when empty/nullish", () => {
    expect(firstNameOf("")).toBe("there");
    expect(firstNameOf(null)).toBe("there");
    expect(firstNameOf(undefined)).toBe("there");
  });
});

describe("maskEmail", () => {
  it("keeps the first char and domain, masks the rest", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j***@example.com");
  });
  it("degrades safely without an @", () => {
    expect(maskEmail("garbage")).toBe("***");
  });
});
