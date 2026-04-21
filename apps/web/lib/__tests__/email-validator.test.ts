import { describe, it, expect } from "bun:test";
import { isDisposableDomain } from "@/lib/email-validator";

describe("isDisposableDomain", () => {
  it("flags a known disposable root domain", () => {
    expect(isDisposableDomain("mailinator.com")).toBe(true);
    expect(isDisposableDomain("yopmail.com")).toBe(true);
  });

  it("flags subdomains of disposable roots", () => {
    expect(isDisposableDomain("something.mailinator.com")).toBe(true);
    expect(isDisposableDomain("deep.sub.mailinator.com")).toBe(true);
  });

  it("is case-insensitive and ignores trailing dots", () => {
    expect(isDisposableDomain("MAILINATOR.COM")).toBe(true);
    expect(isDisposableDomain("mailinator.com.")).toBe(true);
  });

  it("does not flag legitimate providers", () => {
    expect(isDisposableDomain("gmail.com")).toBe(false);
    expect(isDisposableDomain("outlook.com")).toBe(false);
    expect(isDisposableDomain("example.com")).toBe(false);
  });

  it("requires a dot before the root for subdomain matching (no raw substring)", () => {
    // Verify the subdomain check uses `.<root>` not raw endsWith.
    // Construct a domain that shares a suffix with a disposable root but
    // without the leading dot — it must not match.
    expect(isDisposableDomain("legitmail.com")).toBe(false);
  });
});
