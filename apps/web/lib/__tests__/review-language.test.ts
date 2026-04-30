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

  it("resolves the org-level setting", () => {
    expect(resolveReviewLanguage("zh-CN").code).toBe("zh-CN");
    expect(resolveReviewLanguage("ja").code).toBe("ja");
  });

  it("falls back to en for unsupported values", () => {
    expect(resolveReviewLanguage("xx").code).toBe("en");
    expect(resolveReviewLanguage(null).code).toBe("en");
    expect(resolveReviewLanguage(undefined).code).toBe("en");
    expect(resolveReviewLanguage("").code).toBe("en");
  });

  it("includes the prompt name in the resolved result", () => {
    const r = resolveReviewLanguage("ja");
    expect(r.code).toBe("ja");
    expect(r.promptName).toBe("Japanese");
  });
});
