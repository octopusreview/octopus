import { describe, it, expect } from "bun:test";
import { sanitizeTerminal } from "../lib/output.js";

describe("sanitizeTerminal", () => {
  it("passes plain text through unchanged", () => {
    expect(sanitizeTerminal("hello world")).toBe("hello world");
  });

  it("strips CSI color escapes", () => {
    expect(sanitizeTerminal("a\x1b[31mred\x1b[0mb")).toBe("aredb");
  });

  it("strips OSC sequences (title / clipboard injection)", () => {
    expect(sanitizeTerminal("x\x1b]0;pwned\x07y")).toBe("xy");
    expect(sanitizeTerminal("x\x1b]52;c;abc\x1b\\y")).toBe("xy");
  });

  it("strips bare C0 control chars but keeps newline / tab / return", () => {
    expect(sanitizeTerminal("a\x07b")).toBe("ab");
    expect(sanitizeTerminal("a\nb\tc\rd")).toBe("a\nb\tc\rd");
  });
});
