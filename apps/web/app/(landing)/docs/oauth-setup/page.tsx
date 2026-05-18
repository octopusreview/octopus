import Link from "@/components/link";
import { IconShield, IconBrandGoogle, IconBrandGithub } from "@tabler/icons-react";

export const metadata = {
  title: "Google & GitHub login setup — Octopus Docs",
  description:
    "Configure Google and GitHub OAuth sign-in for a self-hosted Octopus instance. Step-by-step: create the OAuth app, copy the client ID/secret, drop them in .env.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/oauth-setup",
  },
};

export default function OauthSetupPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconShield className="size-4" />
          Setup
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Google &amp; GitHub login
        </h1>
        <p className="mt-3 text-sm text-[#888]">
          Octopus uses Better Auth for sign-in. Magic-link email works out of the box;
          Google and GitHub need OAuth credentials. This page walks you through both.
        </p>
      </div>

      <Section title="Why">
        <P>
          The login page shows three options: Google, GitHub, and email magic link.
          The two social buttons are only enabled when the relevant client ID /
          client secret are set in your environment. If you launched the dev server
          without them, those buttons surface a clear error pointing back here.
        </P>
        <P>
          If you don&apos;t want to set up OAuth, just use the magic-link email
          flow — no config needed beyond a working SMTP provider.
        </P>
      </Section>

      <Section title="Environment variables">
        <P>
          Add these to <Mono>.env</Mono> at the repo root (or whatever env file your
          deployment loads):
        </P>
        <CodeBlock>{`# Google OAuth
GOOGLE_CLIENT_ID=…
GOOGLE_CLIENT_SECRET=…

# GitHub OAuth
GITHUB_CLIENT_ID=…
GITHUB_CLIENT_SECRET=…

# Required for OAuth callback URLs to be computed correctly
BETTER_AUTH_URL=http://localhost:3000   # or your real deployment URL`}</CodeBlock>
        <P>
          Restart the server after editing the file. Better Auth logs a warning on
          boot if either provider is partially configured — check the server output
          if the buttons stay disabled.
        </P>
      </Section>

      <Section title="Google OAuth — step by step">
        <div className="mb-3 flex items-center gap-2 text-sm text-[#888]">
          <IconBrandGoogle className="size-4 text-cyan-400" />
          <span>Estimated time: 5 minutes</span>
        </div>
        <OL>
          <li>
            Open the <ExtLink href="https://console.cloud.google.com/">Google Cloud Console</ExtLink>{" "}
            and create a new project (or pick an existing one).
          </li>
          <li>
            Navigate to <Mono>APIs &amp; Services → OAuth consent screen</Mono>.
            Choose <strong>External</strong>, fill in the app name (&quot;Octopus
            self-hosted&quot; works), your email, and a support email. Add any
            scopes you want — Octopus only needs <Mono>email</Mono> and{" "}
            <Mono>profile</Mono>.
          </li>
          <li>
            Go to <Mono>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</Mono>.
            Choose application type <strong>Web application</strong>.
          </li>
          <li>
            Add an <strong>Authorized redirect URI</strong>:
            <CodeBlock>{`http://localhost:3000/api/auth/callback/google
# replace localhost:3000 with your real domain on a hosted deployment`}</CodeBlock>
          </li>
          <li>
            Click <strong>Create</strong>. Copy the <Mono>Client ID</Mono> and{" "}
            <Mono>Client Secret</Mono> from the modal that appears.
          </li>
          <li>
            Paste them into <Mono>.env</Mono> as <Mono>GOOGLE_CLIENT_ID</Mono> and{" "}
            <Mono>GOOGLE_CLIENT_SECRET</Mono>, restart the server.
          </li>
        </OL>
      </Section>

      <Section title="GitHub OAuth — step by step">
        <div className="mb-3 flex items-center gap-2 text-sm text-[#888]">
          <IconBrandGithub className="size-4 text-cyan-400" />
          <span>Estimated time: 3 minutes</span>
        </div>
        <OL>
          <li>
            Open{" "}
            <ExtLink href="https://github.com/settings/developers">
              github.com/settings/developers
            </ExtLink>
            {" "}(or for an org:{" "}
            <Mono>Settings → Developer settings → OAuth Apps</Mono>).
          </li>
          <li>
            Click <strong>New OAuth App</strong>.
          </li>
          <li>
            Fill in:
            <UL>
              <li>
                <strong>Application name</strong>: Octopus self-hosted (or whatever
                you want users to see on the consent screen)
              </li>
              <li>
                <strong>Homepage URL</strong>: <Mono>http://localhost:3000</Mono>
                {" "}(or your deployment URL)
              </li>
              <li>
                <strong>Authorization callback URL</strong>:{" "}
                <Mono>http://localhost:3000/api/auth/callback/github</Mono>
              </li>
            </UL>
          </li>
          <li>
            Click <strong>Register application</strong>.
          </li>
          <li>
            On the resulting page, copy the <Mono>Client ID</Mono>. Click{" "}
            <strong>Generate a new client secret</strong> and copy that too.
          </li>
          <li>
            Paste them into <Mono>.env</Mono> as <Mono>GITHUB_CLIENT_ID</Mono> and{" "}
            <Mono>GITHUB_CLIENT_SECRET</Mono>, restart the server.
          </li>
        </OL>
        <P>
          <strong>Heads up</strong> — this is the OAuth app used for{" "}
          <em>signing in</em>, not the GitHub App used for repo access and webhooks.
          Those are separate and live under <Mono>GitHub Apps</Mono> in the same
          Developer Settings page.
        </P>
      </Section>

      <Section title="Verifying">
        <P>
          After restarting:
        </P>
        <OL>
          <li>Visit <Mono>/login</Mono>.</li>
          <li>The Google and GitHub buttons should be clickable (not greyed out).</li>
          <li>
            Click one — you should be redirected to the provider&apos;s consent
            screen, approve, then land back on the Octopus dashboard.
          </li>
        </OL>
        <P>
          If a button is still disabled, the server didn&apos;t pick up your env
          changes — confirm the variables are spelled correctly and the dev server
          was fully restarted (not just hot-reloaded).
        </P>
      </Section>

      <Section title="Self-hosting checklist">
        <P>
          See the <Link href="/docs/self-hosting" className="text-cyan-400 underline">self-hosting guide</Link>{" "}
          for the full env-var reference. The OAuth pair is optional; magic-link
          email auth works without it as long as you&apos;ve set up an SMTP provider.
        </P>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>;
}

function OL({ children }: { children: React.ReactNode }) {
  return (
    <ol className="mb-3 list-inside list-decimal space-y-2 text-sm leading-relaxed text-[#888]">
      {children}
    </ol>
  );
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mt-2 mb-1 list-inside list-disc space-y-1 pl-4 text-sm text-[#888]">
      {children}
    </ul>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-[#1a1a1a] px-1.5 py-0.5 font-mono text-[12px] text-[#ccc]">
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="my-3 overflow-x-auto rounded-lg border border-white/[0.06] bg-[#0a0a0a] p-4 text-xs leading-relaxed text-[#ccc]">
      <code>{children}</code>
    </pre>
  );
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-cyan-400 underline decoration-cyan-400/30 underline-offset-2 hover:decoration-cyan-400"
    >
      {children}
    </a>
  );
}
