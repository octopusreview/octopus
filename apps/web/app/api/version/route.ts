export function GET() {
  return Response.json({
    buildId: process.env.NEXT_PUBLIC_BUILD_ID,
    server: process.env.OCTOPUS_SERVER_ID || "unknown",
  });
}
