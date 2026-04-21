import { describe, it, expect } from "bun:test";
import { normalizeEmail } from "@/lib/email-normalize";

describe("normalizeEmail", () => {
  it("lowercases and trims the address", () => {
    expect(normalizeEmail("  FeritArslan@Gmail.COM  ")).toBe("feritarslan@gmail.com");
  });

  it("strips dots in the Gmail local part", () => {
    expect(normalizeEmail("fer.it.arslan@gmail.com")).toBe("feritarslan@gmail.com");
  });

  it("strips the +alias suffix in the Gmail local part", () => {
    expect(normalizeEmail("feritarslan+hello@gmail.com")).toBe(
      "feritarslan@gmail.com",
    );
  });

  it("applies dot and + stripping together", () => {
    expect(normalizeEmail("fer.it.arslan+foo.bar@gmail.com")).toBe(
      "feritarslan@gmail.com",
    );
  });

  it("maps googlemail.com to gmail.com", () => {
    expect(normalizeEmail("feritarslan@googlemail.com")).toBe(
      "feritarslan@gmail.com",
    );
  });

  it("leaves non-Gmail addresses unchanged apart from lowercasing", () => {
    expect(normalizeEmail("User.Name+tag@outlook.com")).toBe(
      "user.name+tag@outlook.com",
    );
  });

  it("does not touch a plain canonical gmail address", () => {
    expect(normalizeEmail("feritarslan@gmail.com")).toBe("feritarslan@gmail.com");
  });

  it("returns the trimmed input unchanged when the local part would be empty", () => {
    // All dots + alias only — don't strip to empty, preserve original
    expect(normalizeEmail("+tag@gmail.com")).toBe("+tag@gmail.com");
  });

  it("returns the trimmed input for malformed addresses", () => {
    expect(normalizeEmail("noatsign")).toBe("noatsign");
    expect(normalizeEmail("@nolocal.com")).toBe("@nolocal.com");
    expect(normalizeEmail("trailing@")).toBe("trailing@");
  });
});
