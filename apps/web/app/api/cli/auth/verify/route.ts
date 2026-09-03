import { authenticateApiToken } from "@/lib/api-auth";

export async function POST(request: Request) {
  const result = await authenticateApiToken(request);
  if (result instanceof Response) return result; // account-standing hold (403), pass through
  if (!result) {
    return Response.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  return Response.json({
    user: {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
    },
    organization: {
      id: result.org.id,
      name: result.org.name,
      slug: result.org.slug,
    },
  });
}
