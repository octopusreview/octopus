import { prisma } from "@octopus/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json({
      status: "ready",
      checks: {
        database: "ok",
      },
    });
  } catch (error) {
    console.error("Readiness check failed", error);

    return Response.json(
      {
        status: "not_ready",
        checks: {
          database: "error",
        },
      },
      { status: 503 }
    );
  }
}
