import { prisma } from "@octopus/db";

export type AnnouncementIcon =
  | "heart-handshake"
  | "rocket"
  | "sparkles"
  | "bell"
  | "megaphone"
  | "info"
  | "gift"
  | "flame";

export type AnnouncementTone =
  | "teal"
  | "amber"
  | "violet"
  | "rose"
  | "emerald"
  | "sky";

export interface Announcement {
  id: string;
  message: string;
  prefix?: string;
  ctaLabel?: string;
  href?: string;
  icon: AnnouncementIcon;
  tone: AnnouncementTone;
  enabled: boolean;
  sortOrder: number;
}

const VALID_ICONS: AnnouncementIcon[] = [
  "heart-handshake",
  "rocket",
  "sparkles",
  "bell",
  "megaphone",
  "info",
  "gift",
  "flame",
];

const VALID_TONES: AnnouncementTone[] = [
  "teal",
  "amber",
  "violet",
  "rose",
  "emerald",
  "sky",
];

function isValidIcon(v: unknown): v is AnnouncementIcon {
  return typeof v === "string" && (VALID_ICONS as string[]).includes(v);
}

function isValidTone(v: unknown): v is AnnouncementTone {
  return typeof v === "string" && (VALID_TONES as string[]).includes(v);
}

// Allowlist hrefs to absolute http(s) and same-origin paths starting with "/".
// Blocks javascript:, data:, vbscript:, and other URI schemes from a
// compromised or misconfigured admin entry rendering an XSS / open redirect.
function sanitizeHref(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return undefined;
}

function normalize(raw: unknown): Announcement | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const message = typeof o.message === "string" ? o.message.trim() : "";
  if (!message) return null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : Math.random().toString(36).slice(2),
    message,
    prefix: typeof o.prefix === "string" && o.prefix.trim() ? o.prefix.trim() : undefined,
    ctaLabel:
      typeof o.ctaLabel === "string" && o.ctaLabel.trim() ? o.ctaLabel.trim() : undefined,
    href: sanitizeHref(o.href),
    icon: isValidIcon(o.icon) ? o.icon : "megaphone",
    tone: isValidTone(o.tone) ? o.tone : "teal",
    enabled: o.enabled !== false,
    sortOrder: typeof o.sortOrder === "number" ? o.sortOrder : 0,
  };
}

export async function loadActiveAnnouncements(): Promise<Announcement[]> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { id: "singleton" },
      select: { announcements: true },
    });
    const raw = row?.announcements;
    if (!Array.isArray(raw)) return [];
    return raw
      .map(normalize)
      .filter((a): a is Announcement => a !== null && a.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  } catch {
    return [];
  }
}
