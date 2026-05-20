import { describe, it, expect } from "bun:test";
import { isLocalServer } from "../commands/review";

describe("isLocalServer", () => {
  it("treats localhost as local", () => {
    expect(isLocalServer("http://localhost:3000")).toBe(true);
    expect(isLocalServer("https://LOCALHOST")).toBe(true);
  });

  it("treats IPv4 loopback as local", () => {
    expect(isLocalServer("http://127.0.0.1")).toBe(true);
    expect(isLocalServer("http://127.42.0.5:8080")).toBe(true);
  });

  it("treats IPv6 loopback as local", () => {
    expect(isLocalServer("http://[::1]:3000")).toBe(true);
  });

  it("treats RFC1918 private IPv4 as local", () => {
    expect(isLocalServer("http://10.0.0.5")).toBe(true);
    expect(isLocalServer("http://192.168.1.10:3000")).toBe(true);
    expect(isLocalServer("http://172.16.5.5")).toBe(true);
    expect(isLocalServer("http://172.31.255.255")).toBe(true);
  });

  it("treats *.local mDNS hosts as local", () => {
    expect(isLocalServer("http://my-laptop.local:3000")).toBe(true);
  });

  it("rejects IPv4 outside RFC1918 ranges", () => {
    expect(isLocalServer("http://172.15.0.1")).toBe(false);
    expect(isLocalServer("http://172.32.0.1")).toBe(false);
    expect(isLocalServer("http://8.8.8.8")).toBe(false);
  });

  it("rejects public hostnames", () => {
    expect(isLocalServer("https://octopus-review.ai")).toBe(false);
    expect(isLocalServer("https://example.com")).toBe(false);
  });

  it("rejects unparseable URLs", () => {
    expect(isLocalServer("not a url")).toBe(false);
    expect(isLocalServer("")).toBe(false);
  });
});
