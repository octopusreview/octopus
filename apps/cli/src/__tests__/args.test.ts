import { describe, it, expect } from "bun:test";
import { flagValue, hasFlag, positionals } from "../lib/args.js";

describe("flagValue", () => {
  it("returns the token after a flag", () => {
    expect(flagValue(["--format", "json"], "--format")).toBe("json");
  });
  it("returns undefined when absent or when the next token is a flag", () => {
    expect(flagValue(["--staged"], "--format")).toBeUndefined();
    expect(flagValue(["--format", "--strict"], "--format")).toBeUndefined();
    expect(flagValue(["--format"], "--format")).toBeUndefined();
  });
});

describe("hasFlag", () => {
  it("matches any of the given flags", () => {
    expect(hasFlag(["--verbose", "-x"], "-v", "--verbose")).toBe(true);
    expect(hasFlag(["--staged"], "-h", "--help")).toBe(false);
  });
});

describe("positionals", () => {
  it("returns non-flag tokens", () => {
    expect(positionals(["set", "model", "gpt-4o"])).toEqual(["set", "model", "gpt-4o"]);
  });
  it("skips flags and the values they consume", () => {
    expect(positionals(["--format", "json", "status", "repo"], ["--format"])).toEqual([
      "status",
      "repo",
    ]);
    expect(positionals(["-g", "chat", "x"])).toEqual(["chat", "x"]);
  });
});
