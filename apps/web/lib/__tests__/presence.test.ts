import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

const NOW = 1_800_000_000_000;
const originalDateNow = Date.now;

const redisSet = mock((..._args: unknown[]) => Promise.resolve("OK"));
const redisZadd = mock((..._args: unknown[]) => Promise.resolve(1));
const redisExpire = mock((..._args: unknown[]) => Promise.resolve(1));
const redisDel = mock((..._args: unknown[]) => Promise.resolve(1));
const redisZrem = mock((..._args: unknown[]) => Promise.resolve(1));
const redisZremrangebyscore = mock((..._args: unknown[]) => Promise.resolve(0));
const redisZrangebyscore = mock((..._args: unknown[]) => Promise.resolve([] as string[]));
const redisMget = mock((..._args: unknown[]) => Promise.resolve([] as Array<string | null>));

type RedisDouble = {
  set: typeof redisSet;
  zadd: typeof redisZadd;
  expire: typeof redisExpire;
  del: typeof redisDel;
  zrem: typeof redisZrem;
  zremrangebyscore: typeof redisZremrangebyscore;
  zrangebyscore: typeof redisZrangebyscore;
  mget: typeof redisMget;
};

let redisClient: RedisDouble | null = null;

const presenceUpsert = mock(() => Promise.resolve({}));
const presenceDeleteMany = mock(() => Promise.resolve({ count: 1 }));
const presenceFindMany = mock(() =>
  Promise.resolve(
    [] as Array<{
      userId: string;
      currentActivity: string | null;
      lastSeenAt: Date;
    }>,
  ),
);

mock.module("server-only", () => ({}));

mock.module("@/lib/redis", () => ({
  getRedis: () => redisClient,
}));

mock.module("@octopus/db", () => ({
  prisma: {
    userPresence: {
      upsert: presenceUpsert,
      deleteMany: presenceDeleteMany,
      findMany: presenceFindMany,
    },
  },
}));

const {
  PRESENCE_STALE_MS,
  PRESENCE_TTL_SECONDS,
  clearPresence,
  getOnlinePresence,
  presenceIndexKey,
  presenceKey,
  recordPresence,
} = await import("@/lib/presence");

function connectedRedis(): RedisDouble {
  return {
    set: redisSet,
    zadd: redisZadd,
    expire: redisExpire,
    del: redisDel,
    zrem: redisZrem,
    zremrangebyscore: redisZremrangebyscore,
    zrangebyscore: redisZrangebyscore,
    mget: redisMget,
  };
}

beforeEach(() => {
  Date.now = () => NOW;
  redisClient = connectedRedis();
  redisSet.mockClear();
  redisZadd.mockClear();
  redisExpire.mockClear();
  redisDel.mockClear();
  redisZrem.mockClear();
  redisZremrangebyscore.mockClear();
  redisZrangebyscore.mockClear();
  redisMget.mockClear();
  presenceUpsert.mockClear();
  presenceDeleteMany.mockClear();
  presenceFindMany.mockClear();
});

afterAll(() => {
  Date.now = originalDateNow;
});

describe("Redis presence index", () => {
  it("does not make a heartbeat wait for Redis", async () => {
    redisSet.mockImplementationOnce(() => new Promise<string>(() => {}));
    redisZadd.mockImplementationOnce(() => new Promise<number>(() => {}));

    await expect(recordPresence("org_1", "user_1", null)).resolves.toBeUndefined();
    expect(redisSet).toHaveBeenCalledTimes(1);
    expect(redisZadd).toHaveBeenCalledTimes(1);
  });

  it("records the expiring presence key in an org-scoped sorted set", async () => {
    await recordPresence("org_1", "user_1", "reviewing");

    const key = presenceKey("org_1", "user_1");
    expect(redisSet).toHaveBeenCalledWith(
      key,
      JSON.stringify({
        userId: "user_1",
        currentActivity: "reviewing",
        lastSeenAt: NOW,
      }),
      "EX",
      PRESENCE_TTL_SECONDS,
    );
    expect(redisZadd).toHaveBeenCalledWith(
      presenceIndexKey("org_1"),
      NOW + PRESENCE_TTL_SECONDS * 1000,
      key,
    );
    expect(redisExpire).toHaveBeenCalledWith(
      presenceIndexKey("org_1"),
      PRESENCE_TTL_SECONDS * 2,
    );
    expect(presenceUpsert).not.toHaveBeenCalled();
  });

  it("removes expired members, MGETs only the active org index, and prunes missing values", async () => {
    const validKey = presenceKey("org_1", "user_1");
    const missingKey = presenceKey("org_1", "user_2");
    const invalidKey = presenceKey("org_1", "user_3");
    redisZrangebyscore.mockResolvedValueOnce([validKey, missingKey, invalidKey]);
    redisMget.mockResolvedValueOnce([
      JSON.stringify({
        userId: "user_1",
        currentActivity: "dashboard",
        lastSeenAt: NOW - 1_000,
      }),
      null,
      "not-json",
    ]);

    await expect(getOnlinePresence("org_1")).resolves.toEqual([
      {
        userId: "user_1",
        currentActivity: "dashboard",
        lastSeenAt: NOW - 1_000,
      },
    ]);

    const indexKey = presenceIndexKey("org_1");
    expect(redisZremrangebyscore).toHaveBeenCalledWith(indexKey, "-inf", NOW);
    expect(redisZrangebyscore).toHaveBeenCalledWith(indexKey, `(${NOW}`, "+inf");
    expect(redisMget).toHaveBeenCalledWith(validKey, missingKey, invalidKey);
    expect(redisZrem).toHaveBeenCalledWith(indexKey, missingKey, invalidKey);
  });

  it("removes the presence key and its index membership on clear", async () => {
    await clearPresence("org_1", "user_1");

    const key = presenceKey("org_1", "user_1");
    expect(redisDel).toHaveBeenCalledWith(key);
    expect(redisZrem).toHaveBeenCalledWith(presenceIndexKey("org_1"), key);
    expect(presenceDeleteMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1", userId: "user_1" },
    });
  });
});

describe("presence degraded fallback", () => {
  it("keeps the Postgres fallback when Redis is unavailable", async () => {
    redisClient = null;
    presenceFindMany.mockResolvedValueOnce([
      {
        userId: "user_1",
        currentActivity: null,
        lastSeenAt: new Date(NOW - 5_000),
      },
    ]);

    await recordPresence("org_1", "user_1", null);
    await expect(getOnlinePresence("org_1")).resolves.toEqual([
      { userId: "user_1", currentActivity: null, lastSeenAt: NOW - 5_000 },
    ]);

    expect(presenceUpsert).toHaveBeenCalled();
    expect(presenceFindMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org_1",
        lastSeenAt: { gte: new Date(NOW - PRESENCE_STALE_MS) },
      },
      select: { userId: true, currentActivity: true, lastSeenAt: true },
    });
  });
});
