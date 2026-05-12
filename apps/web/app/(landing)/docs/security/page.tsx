import Link from "@/components/link";
import { IconBug } from "@tabler/icons-react";

export const metadata = {
  title: "Security Policy & Bug Bounty — Octopus",
  description:
    "Octopus security policy and bug bounty program. Report vulnerabilities responsibly, earn rewards, and join our hall of fame.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/security",
  },
};

export default function SecurityPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconBug className="size-4" />
          Security
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Security Policy &amp; Bug Bounty
        </h1>
        <p className="mt-3 text-sm text-[#555]">Last updated: May 2026</p>
      </div>

      <Section title="1. Overview">
        <P>
          We take the security of Octopus seriously. If you believe you have
          found a security vulnerability in our cloud-hosted service, we
          encourage you to report it through our coordinated disclosure
          program. Eligible reports may receive a monetary reward and
          recognition in our hall of fame.
        </P>
      </Section>

      <Section title="2. How to Report">
        <P>
          Send a detailed report to{" "}
          <a
            href="mailto:security@octopus-review.ai"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            security@octopus-review.ai
          </a>
          . Please include:
        </P>
        <UL>
          <li>A clear description of the vulnerability and its impact</li>
          <li>Step-by-step reproduction instructions</li>
          <li>Affected endpoints, parameters, or components</li>
          <li>Proof-of-concept code or screenshots where applicable</li>
          <li>Your name or handle for hall-of-fame credit (optional)</li>
        </UL>
        <P>
          For sensitive reports, request our PGP key in your initial message.
          Please do not disclose the issue publicly until we have confirmed a
          fix.
        </P>
      </Section>

      <Section title="3. Response Timeline">
        <UL>
          <li>
            <strong className="text-white">Initial acknowledgement:</strong>{" "}
            within 3 business days
          </li>
          <li>
            <strong className="text-white">Triage &amp; severity rating:</strong>{" "}
            within 7 business days
          </li>
          <li>
            <strong className="text-white">Fix target:</strong> 30 days for
            critical/high, 90 days for medium/low
          </li>
          <li>
            <strong className="text-white">Public disclosure:</strong>{" "}
            coordinated, typically after the fix is deployed and customers have
            had time to update
          </li>
        </UL>
      </Section>

      <Section title="4. Scope">
        <P>The following assets are in scope for the bug bounty program:</P>
        <UL>
          <li>
            <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-white">
              octopus-review.ai
            </code>{" "}
            and its subdomains
          </li>
          <li>The Octopus cloud application and its public APIs</li>
          <li>Authentication and session handling on the cloud service</li>
          <li>Billing and payment flows on the cloud service</li>
        </UL>
      </Section>

      <Section title="5. Out of Scope">
        <P>
          The following are <strong className="text-white">not</strong>{" "}
          eligible for rewards under this program:
        </P>
        <UL>
          <li>
            Self-hosted Octopus instances (please report through our public
            issue tracker as security advisories)
          </li>
          <li>
            Third-party services we depend on (GitHub, Bitbucket, Stripe,
            OpenAI, Anthropic, Qdrant, Cloudflare) — report to them directly
          </li>
          <li>Denial-of-service attacks, volumetric or otherwise</li>
          <li>
            Social engineering, phishing, or physical attacks against Octopus
            staff or infrastructure
          </li>
          <li>
            Automated scanner output without a demonstrated, verified impact
          </li>
          <li>
            Missing security headers, SPF/DKIM/DMARC, or TLS configuration
            issues without a concrete exploit
          </li>
          <li>Self-XSS or clickjacking on non-sensitive pages</li>
          <li>Rate-limiting issues on non-authentication endpoints</li>
          <li>Version or stack disclosure without further impact</li>
          <li>Issues requiring outdated browsers or rooted devices</li>
          <li>Best-practice recommendations without a working proof of concept</li>
          <li>Vulnerabilities in third-party dependencies already disclosed upstream</li>
        </UL>
      </Section>

      <Section title="6. Rules of Engagement">
        <P>To remain eligible, security researchers must:</P>
        <UL>
          <li>
            Test only against accounts and organizations you own or have
            explicit permission to test
          </li>
          <li>
            Never access, modify, or delete data belonging to other users —
            stop and report as soon as access is demonstrated
          </li>
          <li>Not run automated scans that degrade service for other users</li>
          <li>Not perform denial-of-service or load testing</li>
          <li>Not use social engineering against staff, customers, or vendors</li>
          <li>
            Report findings as soon as possible and avoid public disclosure
            until we have shipped a fix
          </li>
          <li>Comply with all applicable laws</li>
        </UL>
      </Section>

      <Section title="7. Rewards">
        <P>
          Reward amounts are determined at our discretion based on severity
          (CVSS 3.1), exploitability, and report quality. Indicative ranges:
        </P>
        <UL>
          <li>
            <strong className="text-white">Critical</strong> (e.g. remote code
            execution, authentication bypass, large-scale data exposure):{" "}
            $500 to $2,000
          </li>
          <li>
            <strong className="text-white">High</strong> (e.g. account
            takeover, privilege escalation, sensitive data leak):{" "}
            $200 to $500
          </li>
          <li>
            <strong className="text-white">Medium</strong> (e.g. stored XSS,
            SSRF, IDOR with limited impact): $50 to $200
          </li>
          <li>
            <strong className="text-white">Low</strong> (e.g. open redirects,
            state-changing CSRF): $25 to $50
          </li>
        </UL>
        <P>
          Only the first reporter of a given vulnerability is eligible.
          Duplicate reports, theoretical issues, and out-of-scope findings do
          not qualify. Payouts are made via bank transfer or PayPal once a fix
          has been verified.
        </P>
      </Section>

      <Section title="8. Hall of Fame">
        <P>
          Researchers who responsibly disclose valid vulnerabilities are
          credited (with their consent) in our public hall of fame at{" "}
          <Link
            href="/docs/security/hall-of-fame"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            /docs/security/hall-of-fame
          </Link>
          . You may choose to remain anonymous or use a handle.
        </P>
      </Section>

      <Section title="9. Safe Harbor">
        <P>
          We will not pursue legal action against, or support law-enforcement
          investigation of, security researchers who:
        </P>
        <UL>
          <li>Make a good-faith effort to comply with this policy</li>
          <li>
            Avoid privacy violations, destruction of data, and interruption or
            degradation of our services
          </li>
          <li>Only interact with accounts they own or have permission to test</li>
          <li>
            Give us reasonable time to investigate and fix an issue before any
            public disclosure
          </li>
        </UL>
        <P>
          Activity conducted in accordance with this policy is considered
          authorized under our{" "}
          <Link
            href="/docs/terms"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            Terms and Conditions
          </Link>{" "}
          and is exempt from the Acceptable Use restrictions found there. If
          legal action is initiated by a third party against you for activity
          conducted under this policy, we will make this authorization known.
        </P>
      </Section>

      <Section title="10. Contact">
        <P>
          Security reports:{" "}
          <a
            href="mailto:security@octopus-review.ai"
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >
            security@octopus-review.ai
          </a>
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

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mb-3 list-inside list-disc space-y-1.5 text-sm text-[#888]">{children}</ul>;
}
