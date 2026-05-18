import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
export const magicLinkSignIn = authClient.signIn.magicLink;

// Better Auth exposes `forgetPassword` / `resetPassword` / `changePassword`
// on the client when `emailAndPassword.enabled` is true on the server side
// (see apps/web/lib/auth.ts). The generated types don't always propagate
// from the server config to the client, so we wrap them in thin typed
// helpers — runtime behaviour is identical to `authClient.<method>(args)`.
// Using `any` is intentional and bounded to this adapter layer; callers see
// a typed surface.

type ForgetPasswordArgs = { email: string; redirectTo?: string };
type ResetPasswordArgs = { newPassword: string; token: string };
type ChangePasswordArgs = {
  currentPassword: string;
  newPassword: string;
  revokeOtherSessions?: boolean;
};
type AuthResult = { error?: { message?: string } | null };

export async function forgetPassword(args: ForgetPasswordArgs): Promise<AuthResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (authClient as any).forgetPassword(args);
}

export async function resetPassword(args: ResetPasswordArgs): Promise<AuthResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (authClient as any).resetPassword(args);
}

export async function changePassword(args: ChangePasswordArgs): Promise<AuthResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (authClient as any).changePassword(args);
}
