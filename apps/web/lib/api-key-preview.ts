import { decryptStringMaybeLegacy } from "@/lib/crypto";

export function maskStoredKey(stored: string | null): string | null {
  if (!stored) return null;
  const key = decryptStringMaybeLegacy(stored);
  if (key.length <= 15) return "••••••••";
  return key.slice(0, 7) + "••••••••" + key.slice(-4);
}
