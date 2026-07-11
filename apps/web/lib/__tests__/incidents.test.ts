import { describe, expect, test } from "bun:test";
import {
  INCIDENT_KEY_RE,
  MAX_CREDIT_USD,
  buildCreditNote,
  parseSince,
} from "../incidents";

const NOW = new Date("2026-07-11T12:00:00.000Z");

describe("parseSince", () => {
  test("parses minute/hour/day shorthands relative to now", () => {
    expect(parseSince("45m", NOW)?.toISOString()).toBe("2026-07-11T11:15:00.000Z");
    expect(parseSince("3h", NOW)?.toISOString()).toBe("2026-07-11T09:00:00.000Z");
    expect(parseSince("2d", NOW)?.toISOString()).toBe("2026-07-09T12:00:00.000Z");
  });

  test("parses an ISO date inside the window", () => {
    expect(parseSince("2026-07-10T00:00:00Z", NOW)?.toISOString()).toBe(
      "2026-07-10T00:00:00.000Z",
    );
  });

  test("rejects zero, garbage, and unknown units", () => {
    expect(parseSince("0h", NOW)).toBeNull();
    expect(parseSince("xyz", NOW)).toBeNull();
    expect(parseSince("3w", NOW)).toBeNull();
    expect(parseSince("", NOW)).toBeNull();
  });

  test("rejects windows beyond the 30-day ceiling (typo guard)", () => {
    expect(parseSince("31d", NOW)).toBeNull();
    expect(parseSince("300d", NOW)).toBeNull();
    expect(parseSince("2026-01-01T00:00:00Z", NOW)).toBeNull();
    expect(parseSince("30d", NOW)).not.toBeNull();
  });

  test("rejects future dates", () => {
    expect(parseSince("2026-07-12T00:00:00Z", NOW)).toBeNull();
  });
});

describe("buildCreditNote", () => {
  test("empty when no credit is granted", () => {
    expect(buildCreditNote(0)).toBe("");
    expect(buildCreditNote(-1)).toBe("");
  });

  test("formats the amount as USD with two decimals", () => {
    expect(buildCreditNote(5)).toContain("$5.00");
    expect(buildCreditNote(12.5)).toContain("$12.50");
  });
});

describe("INCIDENT_KEY_RE", () => {
  test("accepts kebab-case incident keys", () => {
    expect(INCIDENT_KEY_RE.test("openai-429-2026-07-11")).toBe(true);
    expect(INCIDENT_KEY_RE.test("abc")).toBe(true);
  });

  test("rejects uppercase, leading dash, too short, too long", () => {
    expect(INCIDENT_KEY_RE.test("OpenAI-429")).toBe(false);
    expect(INCIDENT_KEY_RE.test("-leading")).toBe(false);
    expect(INCIDENT_KEY_RE.test("ab")).toBe(false);
    expect(INCIDENT_KEY_RE.test("x".repeat(65))).toBe(false);
  });
});

describe("MAX_CREDIT_USD", () => {
  test("cap is a sane positive ceiling", () => {
    expect(MAX_CREDIT_USD).toBeGreaterThan(0);
    expect(MAX_CREDIT_USD).toBeLessThanOrEqual(100);
  });
});
