import { describe, it, expect } from "bun:test";
import { validateProviderUrl } from "@/lib/providers/url-validation";

describe("validateProviderUrl", () => {
  describe("syntactic validation", () => {
    it("rejects empty input", () => {
      expect(() => validateProviderUrl("", { hosted: false })).toThrow(/empty/);
      expect(() => validateProviderUrl("   ", { hosted: false })).toThrow(/empty/);
    });

    it("rejects unparseable URLs", () => {
      expect(() => validateProviderUrl("not-a-url", { hosted: false })).toThrow(/parseable/);
      expect(() => validateProviderUrl("http://", { hosted: false })).toThrow(/parseable/);
    });

    it("rejects non-http(s) schemes", () => {
      expect(() => validateProviderUrl("ftp://example.com", { hosted: false })).toThrow(/http/);
      expect(() => validateProviderUrl("file:///etc/passwd", { hosted: false })).toThrow(/http/);
      expect(() => validateProviderUrl("javascript:alert(1)", { hosted: false })).toThrow(/http/);
    });

    it("returns the origin (drops path/query/fragment)", () => {
      expect(validateProviderUrl("https://example.com/some/path?foo=bar#frag", { hosted: true })).toBe(
        "https://example.com",
      );
    });

    it("strips trailing slashes", () => {
      expect(validateProviderUrl("https://example.com///", { hosted: true })).toBe("https://example.com");
    });

    it("preserves ports", () => {
      expect(validateProviderUrl("http://example.com:8080", { hosted: true })).toBe("http://example.com:8080");
    });
  });

  describe("hosted-mode SSRF protections", () => {
    it("blocks loopback in hosted mode", () => {
      expect(() => validateProviderUrl("http://localhost:11434", { hosted: true })).toThrow(/private\/loopback/);
      expect(() => validateProviderUrl("http://127.0.0.1", { hosted: true })).toThrow(/private\/loopback/);
      expect(() => validateProviderUrl("http://[::1]", { hosted: true })).toThrow(/private\/loopback/);
    });

    it("blocks RFC1918 private ranges in hosted mode", () => {
      expect(() => validateProviderUrl("http://10.0.0.1", { hosted: true })).toThrow();
      expect(() => validateProviderUrl("http://192.168.1.1", { hosted: true })).toThrow();
      expect(() => validateProviderUrl("http://172.16.0.1", { hosted: true })).toThrow();
      expect(() => validateProviderUrl("http://172.31.255.255", { hosted: true })).toThrow();
    });

    it("allows 172.15.x and 172.32.x (just outside RFC1918)", () => {
      expect(validateProviderUrl("http://172.15.0.1", { hosted: true })).toBe("http://172.15.0.1");
      expect(validateProviderUrl("http://172.32.0.1", { hosted: true })).toBe("http://172.32.0.1");
    });

    it("blocks cloud metadata link-local in hosted mode", () => {
      expect(() => validateProviderUrl("http://169.254.169.254/latest/meta-data", { hosted: true })).toThrow();
    });

    it("blocks IPv6 link-local and unique-local in hosted mode", () => {
      expect(() => validateProviderUrl("http://[fe80::1]", { hosted: true })).toThrow();
      expect(() => validateProviderUrl("http://[fc00::1]", { hosted: true })).toThrow();
      expect(() => validateProviderUrl("http://[fd12::1]", { hosted: true })).toThrow();
    });

    it("blocks IPv4 wildcard 0.0.0.0 (routes to loopback on Linux/macOS)", () => {
      expect(() => validateProviderUrl("http://0.0.0.0:11434", { hosted: true })).toThrow();
    });

    it("blocks IPv6 unspecified `::`", () => {
      expect(() => validateProviderUrl("http://[::]:11434", { hosted: true })).toThrow();
    });

    it("blocks IPv4-mapped IPv6 (cloud-metadata bypass)", () => {
      // ::ffff:127.0.0.1 → loopback, ::ffff:169.254.169.254 → cloud metadata
      expect(() => validateProviderUrl("http://[::ffff:127.0.0.1]", { hosted: true })).toThrow();
      expect(() => validateProviderUrl("http://[::ffff:169.254.169.254]", { hosted: true })).toThrow();
    });

    it("blocks 6to4 (2002::/16) — embeds v4 in next 32 bits", () => {
      // [2002:7f00:1::] addresses 127.0.0.1 via 6to4
      expect(() => validateProviderUrl("http://[2002:7f00:1::]", { hosted: true })).toThrow();
      // [2002:a9fe:a9fe::] addresses 169.254.169.254 via 6to4 (cloud-metadata bypass)
      expect(() => validateProviderUrl("http://[2002:a9fe:a9fe::]", { hosted: true })).toThrow();
    });

    it("blocks NAT64 well-known prefix (64:ff9b::/96)", () => {
      // [64:ff9b::a9fe:a9fe] addresses 169.254.169.254 via NAT64
      expect(() => validateProviderUrl("http://[64:ff9b::a9fe:a9fe]", { hosted: true })).toThrow();
      // [64:ff9b::7f00:1] addresses 127.0.0.1 via NAT64
      expect(() => validateProviderUrl("http://[64:ff9b::7f00:1]", { hosted: true })).toThrow();
    });

    it("blocks IPv4-compatible IPv6 (`::a.b.c.d` deprecated form)", () => {
      // [::127.0.0.1] canonicalizes to [::7f00:1] — reaches 127.0.0.1
      expect(() => validateProviderUrl("http://[::127.0.0.1]", { hosted: true })).toThrow();
      expect(() => validateProviderUrl("http://[::169.254.169.254]", { hosted: true })).toThrow();
    });

    it("blocks non-canonical IPv6 forms via WHATWG canonicalization", () => {
      // [0::1] and [0:0:0:0:0:0:0:1] both canonicalize to [::1]
      expect(() => validateProviderUrl("http://[0::1]", { hosted: true })).toThrow();
      expect(() => validateProviderUrl("http://[0:0:0:0:0:0:0:1]", { hosted: true })).toThrow();
      // [::ffff:0:127.0.0.1] canonicalizes to [::ffff:0:7f00:1] (matches ::ffff:)
      expect(() => validateProviderUrl("http://[::ffff:0:127.0.0.1]", { hosted: true })).toThrow();
      // Expanded ::ffff:a9fe:a9fe form
      expect(() => validateProviderUrl("http://[0:0:0:0:0:ffff:a9fe:a9fe]", { hosted: true })).toThrow();
    });

    it("allows public hosts in hosted mode", () => {
      expect(validateProviderUrl("https://api.example.com", { hosted: true })).toBe("https://api.example.com");
      expect(validateProviderUrl("https://1.1.1.1", { hosted: true })).toBe("https://1.1.1.1");
    });
  });

  describe("self-hosted mode permissiveness", () => {
    it("allows loopback in self-hosted mode", () => {
      expect(validateProviderUrl("http://localhost:11434", { hosted: false })).toBe(
        "http://localhost:11434",
      );
      expect(validateProviderUrl("http://127.0.0.1", { hosted: false })).toBe("http://127.0.0.1");
    });

    it("allows RFC1918 in self-hosted mode", () => {
      expect(validateProviderUrl("http://10.0.0.1", { hosted: false })).toBe("http://10.0.0.1");
      expect(validateProviderUrl("http://192.168.1.100", { hosted: false })).toBe(
        "http://192.168.1.100",
      );
    });
  });

  describe("default hosted detection", () => {
    it("defaults to hosted when SELF_HOSTED env is unset", () => {
      delete process.env.SELF_HOSTED;
      expect(() => validateProviderUrl("http://localhost")).toThrow(/private/);
    });

    it("defaults to self-hosted when SELF_HOSTED=true", () => {
      process.env.SELF_HOSTED = "true";
      expect(validateProviderUrl("http://localhost")).toBe("http://localhost");
      delete process.env.SELF_HOSTED;
    });
  });
});
