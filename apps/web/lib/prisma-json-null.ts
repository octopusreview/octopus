import "server-only";

import { Prisma } from "@octopus/db";

/** Prisma's explicit sentinel for clearing a nullable JSON column to SQL NULL. */
export const PRISMA_DB_NULL = Prisma.DbNull;
