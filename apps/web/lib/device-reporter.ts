"use client";

import { generateFingerprint, getSecondarySignals } from "./fingerprint";

let reported = false;

/**
 * Report device fingerprint to server after login.
 * Safe to call multiple times per session, only runs once.
 */
export async function reportDevice(): Promise<void> {
  if (reported) return;
  reported = true;

  try {
    const fingerprint = await generateFingerprint();
    const secondarySignals = getSecondarySignals();

    await fetch("/api/auth/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprint, secondarySignals }),
    });
  } catch {
    // Reset so it retries on next call
    reported = false;
  }
}
