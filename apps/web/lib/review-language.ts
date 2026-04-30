/**
 * Languages the user can choose for review prose output.
 * Code is BCP-47; name is what we tell the LLM.
 */
export const REVIEW_LANGUAGES: { code: string; label: string; promptName: string }[] = [
  { code: "en", label: "English", promptName: "English" },
  { code: "tr", label: "Türkçe", promptName: "Turkish" },
  { code: "zh-CN", label: "简体中文", promptName: "Simplified Chinese" },
  { code: "zh-TW", label: "繁體中文", promptName: "Traditional Chinese" },
  { code: "ja", label: "日本語", promptName: "Japanese" },
  { code: "ko", label: "한국어", promptName: "Korean" },
  { code: "de", label: "Deutsch", promptName: "German" },
  { code: "fr", label: "Français", promptName: "French" },
  { code: "es", label: "Español", promptName: "Spanish" },
  { code: "pt", label: "Português", promptName: "Portuguese" },
  { code: "ru", label: "Русский", promptName: "Russian" },
];

const CODE_TO_NAME = new Map(REVIEW_LANGUAGES.map((l) => [l.code, l.promptName]));

export function isSupportedReviewLanguage(code: string): boolean {
  return CODE_TO_NAME.has(code);
}

export function reviewLanguageName(code: string | null | undefined): string {
  if (!code) return "English";
  return CODE_TO_NAME.get(code) ?? "English";
}

/**
 * Resolve the effective review language for a (org, repo) pair.
 * Repo override wins; otherwise falls back to org default; otherwise "en".
 */
export function resolveReviewLanguage(
  orgLanguage: string | null | undefined,
  repoLanguage: string | null | undefined,
): { code: string; promptName: string } {
  const candidate = repoLanguage?.trim() || orgLanguage?.trim() || "en";
  const code = isSupportedReviewLanguage(candidate) ? candidate : "en";
  return { code, promptName: reviewLanguageName(code) };
}
