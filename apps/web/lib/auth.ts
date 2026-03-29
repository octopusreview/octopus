import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@octopus/db";
import { sendEmail } from "./email";
import { writeAuditLog } from "./audit";

export const auth = betterAuth({
  trustedOrigins: [process.env.BETTER_AUTH_URL!],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { email: true },
          });
          await writeAuditLog({
            action: "auth.login",
            category: "auth",
            actorId: session.userId,
            actorEmail: user?.email ?? null,
            targetType: "session",
            targetId: session.id,
            ipAddress: session.ipAddress ?? null,
            userAgent: session.userAgent ?? null,
          });
        },
      },
    },
    user: {
      create: {
        after: async (user) => {
          await writeAuditLog({
            action: "auth.signup",
            category: "auth",
            actorId: user.id,
            actorEmail: user.email,
            targetType: "user",
            targetId: user.id,
          });
        },
      },
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: email,
          subject: "Sign in to Octopus",
          html: `<p>Click <a href="${url}">here</a> to sign in to Octopus.</p>`,
        });
        await writeAuditLog({
          action: "email.magic_link_sent",
          category: "email",
          actorEmail: email,
          targetType: "user",
          metadata: { recipient: email },
        });
      },
    }),
  ],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
});
