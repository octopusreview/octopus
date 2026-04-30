import { describe, it, expect } from "bun:test";
import {
  isSupportedReviewLanguage,
  reviewLanguageName,
  resolveReviewLanguage,
} from "@/lib/review-language";

describe("review-language", () => {
  it("recognizes supported language codes", () => {
    expect(isSupportedReviewLanguage("en")).toBe(true);
    expect(isSupportedReviewLanguage("zh-CN")).toBe(true);
    expect(isSupportedReviewLanguage("tr")).toBe(true);
    expect(isSupportedReviewLanguage("xx")).toBe(false);
    expect(isSupportedReviewLanguage("")).toBe(false);
  });

  it("returns the prompt-friendly name", () => {
    expect(reviewLanguageName("zh-CN")).toBe("Simplified Chinese");
    expect(reviewLanguageName("ja")).toBe("Japanese");
    expect(reviewLanguageName(null)).toBe("English");
    expect(reviewLanguageName("xx")).toBe("English");
  });

  it("resolves repo override over org default", () => {
    expect(resolveReviewLanguage("en", "zh-CN").code).toBe("zh-CN");
    expect(resolveReviewLanguage("zh-CN", null).code).toBe("zh-CN");
    expect(resolveReviewLanguage("zh-CN", "").code).toBe("zh-CN");
  });

  it("falls back to en for unsupported values", () => {
    expect(resolveReviewLanguage("xx", null).code).toBe("en");
    expect(resolveReviewLanguage(null, "yy").code).toBe("en");
    expect(resolveReviewLanguage(undefined, undefined).code).toBe("en");
  });

  it("includes the prompt name in the resolved result", () => {
    const r = resolveReviewLanguage("en", "ja");
    expect(r.code).toBe("ja");
    expect(r.promptName).toBe("Japanese");
  });
});
