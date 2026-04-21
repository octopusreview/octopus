const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return trimmed;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (GMAIL_DOMAINS.has(domain)) {
    const base = local.split("+")[0].replace(/\./g, "");
    if (!base) return trimmed;
    return `${base}@gmail.com`;
  }

  return trimmed;
}
