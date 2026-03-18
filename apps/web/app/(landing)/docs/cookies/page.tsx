import Link from "next/link";
import { IconCookie } from "@tabler/icons-react";

export const metadata = {
  title: "Cookie Policy — Octopus",
  description: "How Octopus uses cookies and similar technologies.",
};

export default function CookiePolicyPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconCookie className="size-4" />
          Legal
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Cookie Policy
        </h1>
        <p className="mt-3 text-sm text-[#555]">Last updated: March 2026</p>
      </div>

      <Section title="1. What Are Cookies">
        <P>
          Cookies are small text files stored on your device when you visit a
          website. They help websites remember your preferences and improve
          your experience.
        </P>
      </Section>

      <Section title="2. How We Use Cookies">
        <P>Octopus uses cookies for the following purposes:</P>

        <H3>Essential Cookies</H3>
        <P>
          These cookies are necessary for the Service to function. They cannot
          be disabled.
        </P>
        <CookieTable
          cookies={[
            {
              name: "better-auth.session_token",
              purpose: "Authentication session",
              duration: "30 days",
            },
            {
              name: "__Secure-better-auth.session_token",
              purpose: "Secure authentication session (HTTPS)",
              duration: "30 days",
            },
          ]}
        />

        <H3>Analytics Cookies</H3>
        <P>
          We use Google Analytics to understand how visitors interact with the
          landing page. These cookies collect anonymous, aggregated data.
        </P>
        <CookieTable
          cookies={[
            {
              name: "_ga",
              purpose: "Google Analytics visitor identification",
              duration: "2 years",
            },
            {
              name: "_ga_*",
              purpose: "Google Analytics session tracking",
              duration: "2 years",
            },
          ]}
        />
      </Section>

      <Section title="3. Third-Party Cookies">
        <P>
          When you sign in through GitHub or Google OAuth, those providers may
          set their own cookies as part of the authentication flow. These
          cookies are governed by the respective provider&apos;s cookie
          policies.
        </P>
      </Section>

      <Section title="4. Managing Cookies">
        <P>
          You can control and delete cookies through your browser settings.
          Most browsers allow you to:
        </P>
        <UL>
          <li>View and delete existing cookies</li>
          <li>Block all or specific cookies</li>
          <li>Set preferences for certain websites</li>
        </UL>
        <P>
          Note that disabling essential cookies will prevent you from signing
          in to the Service.
        </P>
      </Section>

      <Section title="5. Self-Hosted Instances">
        <P>
          If you self-host Octopus, only essential session cookies are set by
          default. Analytics cookies are only present if you configure Google
          Analytics in your environment. You have full control over which
          cookies your instance uses.
        </P>
      </Section>

      <Section title="6. Changes to This Policy">
        <P>
          We may update this Cookie Policy from time to time. Changes will be
          posted on this page with an updated revision date.
        </P>
      </Section>

      <Section title="7. Contact">
        <P>
          For questions about our use of cookies, please open an issue on
          our{" "}
          <a
            href="https://github.com/octopusreview"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            GitHub repository
          </a>{" "}
          or refer to our{" "}
          <Link
            href="/docs/privacy"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            Privacy Policy
          </Link>
          .
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

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-4 text-sm font-semibold text-[#ccc]">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mb-3 list-inside list-disc space-y-1.5 text-sm text-[#888]">{children}</ul>;
}

function CookieTable({
  cookies,
}: {
  cookies: { name: string; purpose: string; duration: string }[];
}) {
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border border-white/[0.06]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-left">
            <th className="px-4 py-2 font-medium text-[#999]">Cookie</th>
            <th className="px-4 py-2 font-medium text-[#999]">Purpose</th>
            <th className="px-4 py-2 font-medium text-[#999]">Duration</th>
          </tr>
        </thead>
        <tbody className="text-[#888]">
          {cookies.map((cookie) => (
            <tr key={cookie.name} className="border-b border-white/[0.04] last:border-0">
              <td className="px-4 py-2">
                <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-[#ccc]">
                  {cookie.name}
                </code>
              </td>
              <td className="px-4 py-2">{cookie.purpose}</td>
              <td className="px-4 py-2 text-[#666]">{cookie.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
