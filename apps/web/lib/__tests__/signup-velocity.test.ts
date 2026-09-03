import { beforeEach, describe, expect, it, mock } from "bun:test";

// Unit tests for the hard signup-velocity cap (lib/signup-velocity.ts), the
// pre-create block wired into auth.ts databaseHooks.user.create.before.
// @octopus/db is mocked; user.count answers the exact-IP query with ipCount
// and the /24 startsWith query with subnetCount.

let ipCount: number;
let subnetCount: number;

const userCount = mock(
  (args: {
    where: {
      signupIp: string | { startsWith: string };
      createdAt?: { gte: Date };
    };
  }) =>
    Promise.resolve(
      typeof args.where.signupIp === "string" ? ipCount : subnetCount,
    ),
);

mock.module("@octopus/db", () => ({
  prisma: { user: { count: userCount } },
}));

const { checkSignupVelocity } = await import("@/lib/signup-velocity");

beforeEach(() => {
  ipCount = 0;
  subnetCount = 0;
  userCount.mockClear();
  delete process.env.SIGNUP_VELOCITY_CAP;
  delete process.env.SIGNUP_MAX_PER_IP_DAY;
  delete process.env.SIGNUP_MAX_PER_SUBNET_DAY;
});

describe("checkSignupVelocity", () => {
  it("allows a signup under both caps", async () => {
    ipCount = 4; // < default 5
    subnetCount = 14; // < default 15
    const result = await checkSignupVelocity("94.23.11.7");
    expect(result.blocked).toBe(false);
    expect(userCount).toHaveBeenCalledTimes(2);
  });

  it("blocks at the per-IP cap", async () => {
    ipCount = 5; // this signup would be the 6th from the IP today
    const result = await checkSignupVelocity("94.23.11.7");
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.reason).toBe("ip");
      expect(result.ipCount).toBe(5);
    }
  });

  it("blocks at the /24 subnet cap", async () => {
    ipCount = 2;
    subnetCount = 15; // this signup would be the 16th from the /24 today
    const result = await checkSignupVelocity("94.23.11.7");
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.reason).toBe("subnet");
      expect(result.subnetCount).toBe(15);
    }
    // The subnet query must count on the first-three-octets prefix.
    const subnetCall = userCount.mock.calls.find(
      (c) => typeof c[0].where.signupIp !== "string",
    );
    expect(subnetCall?.[0].where.signupIp).toEqual({
      startsWith: "94.23.11.",
    });
    // Both counts must be windowed to the last 24h — without the createdAt
    // clause the daily cap silently becomes an all-time cap.
    expect(userCount.mock.calls.length).toBe(2);
    for (const call of userCount.mock.calls) {
      const gte = call[0].where.createdAt?.gte;
      expect(gte).toBeInstanceOf(Date);
      expect(gte!.getTime()).toBeGreaterThan(Date.now() - 24.1 * 3600e3);
      expect(gte!.getTime()).toBeLessThan(Date.now() - 23.9 * 3600e3);
    }
  });

  it("honours env overrides for both caps", async () => {
    process.env.SIGNUP_MAX_PER_IP_DAY = "2";
    ipCount = 2;
    const perIp = await checkSignupVelocity("94.23.11.7");
    expect(perIp.blocked).toBe(true);

    process.env.SIGNUP_MAX_PER_IP_DAY = "10";
    process.env.SIGNUP_MAX_PER_SUBNET_DAY = "3";
    ipCount = 1;
    subnetCount = 3;
    const perSubnet = await checkSignupVelocity("94.23.11.7");
    expect(perSubnet.blocked).toBe(true);
  });

  it("skips missing IPs", async () => {
    for (const ip of [null, undefined, ""]) {
      const result = await checkSignupVelocity(ip);
      expect(result.blocked).toBe(false);
    }
    expect(userCount).not.toHaveBeenCalled();
  });

  it("skips private and loopback IPs", async () => {
    ipCount = 100;
    subnetCount = 100;
    for (const ip of [
      "10.0.0.5",
      "127.0.0.1",
      "192.168.1.20",
      "172.16.4.2",
      "172.31.255.1",
      "169.254.0.9",
      "::1",
      // better-auth's getIp masks IPv6 to /64, so ::1 / :: reach the check
      // as the expanded all-zeros form — must be treated as loopback too.
      "0000:0000:0000:0000:0000:0000:0000:0000",
      "fd12:3456::1",
      "fe80::abcd",
    ]) {
      const result = await checkSignupVelocity(ip);
      expect(result.blocked).toBe(false);
    }
    expect(userCount).not.toHaveBeenCalled();
  });

  it("caps public IPv6 by the getIp-normalized (/64-masked) form", async () => {
    // The auth.ts hook resolves the IP with better-auth's getIp, which hands
    // us the expanded /64-masked lowercase form — the same string
    // session.create.after stamps into signupIp. The exact-IP query must run
    // on that string verbatim (an effective per-/64 cap), and no /24 query.
    const normalized = "2001:0db8:0000:0000:0000:0000:0000:0000";
    ipCount = 5;
    const result = await checkSignupVelocity(normalized);
    expect(result.blocked).toBe(true);
    if (result.blocked) expect(result.reason).toBe("ip");
    expect(userCount).toHaveBeenCalledTimes(1);
    expect(userCount.mock.calls[0]?.[0].where.signupIp).toBe(normalized);
  });

  it("honours the kill switch", async () => {
    process.env.SIGNUP_VELOCITY_CAP = "off";
    ipCount = 1000;
    subnetCount = 1000;
    const result = await checkSignupVelocity("94.23.11.7");
    expect(result.blocked).toBe(false);
    expect(userCount).not.toHaveBeenCalled();
  });
});
