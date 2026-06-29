import { describe, it, expect } from "bun:test";
import { csvCell } from "@/app/api/audit-log/export/route";

describe("csvCell — formula-injection neutralisation", () => {
  it("returns plain text unchanged", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell("Mozilla/5.0")).toBe("Mozilla/5.0");
  });

  it("RFC-4180 quotes cells containing comma, quote, newline, CR", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('quote"inside')).toBe('"quote""inside"');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("cr\rhere")).toBe('"cr\rhere"');
  });

  it("neutralises cells starting with formula characters", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\",\"x\")"))
      .toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvCell("+1+1")).toBe(`"'+1+1"`);
    expect(csvCell("-5")).toBe(`"'-5"`);
    expect(csvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
  });

  it("neutralises tab and CR prefixes (Excel-specific formula triggers)", () => {
    expect(csvCell("\tnotsafe")).toBe(`"'\tnotsafe"`);
    expect(csvCell("\rinjected")).toBe(`"'\rinjected"`);
  });

  it("does not neutralise legitimate values starting with safe punctuation", () => {
    expect(csvCell("(comment)")).toBe("(comment)");
    expect(csvCell("/path/to/thing")).toBe("/path/to/thing");
    expect(csvCell("#hashtag")).toBe("#hashtag");
  });
});
