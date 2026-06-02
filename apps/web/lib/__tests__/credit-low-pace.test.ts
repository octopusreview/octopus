import { describe, it, expect } from "bun:test";
import { buildPaceLine } from "@/lib/events/observers/email.observer";

const base = { type: "credit-low" as const, orgId: "org_1", remainingBalance: 5 };

describe("buildPaceLine", () => {
  it("returns an empty string when there is no measurable burn", () => {
    expect(buildPaceLine(base)).toBe("");
    expect(buildPaceLine({ ...base, burnRatePerHour: 0, runwayMinutes: undefined })).toBe("");
  });

  it("reports minutes for short runways", () => {
    // $5 left at $10/hour => 30 minutes
    expect(buildPaceLine({ ...base, burnRatePerHour: 10, runwayMinutes: 30 })).toBe(
      "At your current pace (~$10.00/hour), this will run out in about 30 minutes.",
    );
  });

  it("uses singular minute at exactly one minute", () => {
    expect(buildPaceLine({ ...base, burnRatePerHour: 60, runwayMinutes: 1 })).toContain(
      "about 1 minute.",
    );
  });

  it("still reports minutes at the 60-minute boundary", () => {
    expect(buildPaceLine({ ...base, burnRatePerHour: 5, runwayMinutes: 60 })).toBe(
      "At your current pace (~$5.00/hour), this will run out in about 60 minutes.",
    );
  });

  it("switches to hours at the 90-minute boundary", () => {
    expect(buildPaceLine({ ...base, burnRatePerHour: 4, runwayMinutes: 90 })).toBe(
      "At your current pace (~$4.00/hour), this will run out in about 2 hours.",
    );
  });

  it("switches to hours once runway reaches 90 minutes", () => {
    expect(buildPaceLine({ ...base, burnRatePerHour: 4, runwayMinutes: 120 })).toBe(
      "At your current pace (~$4.00/hour), this will run out in about 2 hours.",
    );
  });

  it("returns empty string for a non-finite burn rate", () => {
    expect(buildPaceLine({ ...base, burnRatePerHour: Infinity, runwayMinutes: 0 })).toBe("");
  });
});
