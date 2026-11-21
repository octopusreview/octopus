import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Cloud runs seven containers at once during a rolling update against max_connections=100;
// 8 here plus 4 for pg-boss (lib/queue.ts) keeps the worst case near 80.
// shortcut: fixed numbers, make them env settings when a deployment needs others.
export const DATABASE_POOL_MAX = 8;

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  max: DATABASE_POOL_MAX,
});

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";
