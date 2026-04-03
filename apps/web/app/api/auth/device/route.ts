import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { sendEmail } from "@/lib/email";
import { renderEmailTemplate } from "@/lib/email-renderer";
import { headers } from "next/headers";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fingerprint, secondarySignals } = await request.json();
  if (!fingerprint || typeof fingerprint !== "string") {
    return NextResponse.json(
      { error: "Fingerprint required" },
      { status: 400 },
    );
  }

  const userId = session.user.id;

  // Check if this device is known
  const existing = await prisma.userDevice.findUnique({
    where: { userId_fingerprint: { userId, fingerprint } },
  });

  if (existing) {
    // Known device, update lastSeenAt and refresh secondary signals
    await prisma.userDevice.update({
      where: { id: existing.id },
      data: {
        lastSeenAt: new Date(),
        ...(secondarySignals ? { metadata: secondarySignals } : {}),
      },
    });
    return NextResponse.json({ known: true });
  }

  // New device — save it
  const reqHeaders = await headers();
  // Prefer server-set headers that can't be spoofed by the client
  const ip =
    reqHeaders.get("cf-connecting-ip") ||
    reqHeaders.get("x-real-ip") ||
    reqHeaders.get("x-forwarded-for")?.split(",").pop()?.trim() ||
    "Unknown";
  const ua = reqHeaders.get("user-agent") || "";
  const browser = parseBrowser(ua);

  // Resolve geolocation before creating the device record so it's available for the email
  const location = await fetchIpLocation(ip);

  await prisma.userDevice.create({
    data: {
      userId,
      fingerprint,
      browser,
      ipAddress: ip,
      location,
      ...(secondarySignals ? { metadata: secondarySignals } : {}),
    },
  });

  // Check if user has any OTHER devices (first device = first login, don't alert)
  const deviceCount = await prisma.userDevice.count({ where: { userId } });

  if (deviceCount > 1) {
    // New device on existing account, send alert
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (user) {
      const firstName = user.name?.split(" ")[0] || "there";
      const appUrl =
        process.env.BETTER_AUTH_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000";

      const result = await renderEmailTemplate("new-login", {
        firstName,
        appUrl,
        ipAddress: ip,
        location,
        browser,
        loginTime: new Date().toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      });

      if (result) {
        sendEmail({
          to: user.email,
          subject: result.subject,
          html: result.html,
        }).catch((err) =>
          console.error("[device] Failed to send new-login email:", err),
        );
      }
    }
  }

  return NextResponse.json({ known: false, deviceCount });
}

function parseBrowser(userAgent: string): string {
  if (!userAgent) return "Unknown";
  if (userAgent.includes("Firefox")) return "Firefox";
  if (userAgent.includes("Edg/")) return "Edge";
  if (userAgent.includes("Chrome")) return "Chrome";
  if (userAgent.includes("Safari")) return "Safari";
  if (userAgent.includes("Opera") || userAgent.includes("OPR")) return "Opera";
  return "Unknown browser";
}

async function fetchIpLocation(ip: string): Promise<string> {
  if (!ip || ip === "Unknown" || ip === "127.0.0.1" || ip === "::1") {
    return "Localhost";
  }
  try {
    const res = await fetch(
      `https://ipapi.co/${ip}/json/`,
    );
    if (!res.ok) return "Unknown";
    const data = await res.json();
    if (data.city && data.country) return `${data.city}, ${data.country}`;
    if (data.country) return data.country;
    return "Unknown";
  } catch {
    return "Unknown";
  }
}
