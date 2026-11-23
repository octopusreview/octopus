import { describe, it, expect } from "bun:test";
import {
  isDisposableDomain,
  isDisposableMxHost,
  parseBlockedDomainsEnv,
} from "@/lib/email-validator";

describe("isDisposableMxHost", () => {
  it("matches built-in and configured mail hosts and their subdomains", () => {
    const previous = process.env.SIGNUP_BLOCKED_MX_HOSTS;
    try {
      delete process.env.SIGNUP_BLOCKED_MX_HOSTS;
      expect(isDisposableMxHost("mx.mailinator.com.")).toBe(true);
      expect(isDisposableMxHost("aspmx.l.google.com")).toBe(false);
      expect(isDisposableMxHost("mail.blocked-mx.example")).toBe(false);
      process.env.SIGNUP_BLOCKED_MX_HOSTS = " Blocked-MX.example , other.example";
      expect(isDisposableMxHost("mail.blocked-mx.example.")).toBe(true);
      expect(isDisposableMxHost("blocked-mx.example")).toBe(true);
      expect(isDisposableMxHost("notblocked-mx.example")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.SIGNUP_BLOCKED_MX_HOSTS;
      else process.env.SIGNUP_BLOCKED_MX_HOSTS = previous;
    }
  });
});

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

  it("blocks the signup-farm domain families and their subdomains (#788)", () => {
    const farmRoots = [
      "foodtrik.com",
      "totalgamehub.net",
      "foodhz.com",
      "birdzpt.com",
      "rainsase.com",
    ];
    for (const root of farmRoots) {
      expect(isDisposableDomain(root)).toBe(true);
      expect(isDisposableDomain(`x7kq2.${root}`)).toBe(true);
    }
    // Unrelated normal domain is unaffected.
    expect(isDisposableDomain("example-company.com")).toBe(false);
  });

  it("requires a dot before the root for subdomain matching (no raw substring)", () => {
    // Verify the subdomain check uses `.<root>` not raw endsWith.
    // Construct a domain that shares a suffix with a disposable root but
    // without the leading dot — it must not match.
    expect(isDisposableDomain("legitmail.com")).toBe(false);
  });

  it("blocks the rotated signup-farm domain firegameplay.com and its subdomains (#788)", () => {
    expect(isDisposableDomain("firegameplay.com")).toBe(true);
    expect(isDisposableDomain("k3zp9.firegameplay.com")).toBe(true);
  });
});

describe("parseBlockedDomainsEnv", () => {
  it("returns an empty list for undefined or empty input", () => {
    expect(parseBlockedDomainsEnv(undefined)).toEqual([]);
    expect(parseBlockedDomainsEnv("")).toEqual([]);
    expect(parseBlockedDomainsEnv(" , ,")).toEqual([]);
  });

  it("trims, lowercases, and splits on commas", () => {
    expect(parseBlockedDomainsEnv(" Foo.com , BAR.NET")).toEqual([
      "foo.com",
      "bar.net",
    ]);
  });

  it("strips a leading @ or dot and a trailing dot", () => {
    expect(parseBlockedDomainsEnv("@foo.com,bar.net.,.baz.org")).toEqual([
      "foo.com",
      "bar.net",
      "baz.org",
    ]);
  });

  it("ignores entries without a dot so a bare TLD cannot block everything", () => {
    expect(parseBlockedDomainsEnv("com,foo.com,net.")).toEqual(["foo.com"]);
  });

  it("de-duplicates entries", () => {
    expect(parseBlockedDomainsEnv("foo.com,FOO.COM,@foo.com.")).toEqual([
      "foo.com",
    ]);
  });
});
