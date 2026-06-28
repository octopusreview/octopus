import { IconBrandGithub, IconShieldCheck } from "@tabler/icons-react";

export const metadata = {
  title: "GitHub App setup — Octopus Docs",
  description:
    "Create the GitHub App that Octopus uses to receive PR webhooks and post review comments. Step-by-step instructions plus the staging vs production recommendation.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/github-app",
  },
};

export default function GithubAppPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconBrandGithub className="size-4" />
          Setup
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          GitHub App setup
        </h1>
        <p className="mt-3 text-sm text-[#888]">
          Octopus uses a GitHub App (not OAuth, not the gh CLI) to receive PR
          webhooks and post review comments as a bot identity. This page walks
          you through creating one. Estimated time: 5 minutes.
        </p>
      </div>

      <Section title="Why a GitHub App and not the gh CLI">
        <P>
          Three things only the App model gives you, and they matter for a
          continuous-review tool:
        </P>
        <UL>
          <li>
            <strong>Webhooks.</strong> GitHub pushes <Mono>pull_request</Mono>{" "}
            events to your server when PRs open or get new commits. The{" "}
            <Mono>gh</Mono> CLI has no webhook registration; you&apos;d have to
            poll, which is slow and rate-limited.
          </li>
          <li>
            <strong>Bot identity.</strong> Review comments appear as{" "}
            <Mono>your-app[bot]</Mono>, distinct from any human reviewer.
            User-OAuth comments show up under whoever&apos;s token you used.
          </li>
          <li>
            <strong>Per-repo scoped permissions.</strong> An org admin picks
            exactly which repos Octopus can see. Survives users leaving the org
            and key rotations.
          </li>
        </UL>
        <P>
          For one-off <Mono>octp review &lt;PR&gt;</Mono> from the CLI, a
          personal token works fine. The web app + auto-review-every-PR flow
          needs the App.
        </P>
      </Section>

      <Section title="Step-by-step">
        <div className="mb-3 flex items-center gap-2 text-sm text-[#888]">
          <IconShieldCheck className="size-4 text-cyan-400" />
          <span>Org owner / admin permission required on the GitHub side</span>
        </div>

        <OL>
          <li>
            Open{" "}
            <ExtLink href="https://github.com/settings/apps/new">
              github.com/settings/apps/new
            </ExtLink>{" "}
            (or for an org: <Mono>Settings → Developer settings → GitHub Apps → New GitHub App</Mono>).
          </li>
          <li>
            <strong>GitHub App name</strong> — pick anything; this is what
            shows up as the comment author. Examples: <Mono>octopus-review</Mono>{" "}
            for production, <Mono>octopus-staging</Mono> for staging.
            Names must be globally unique on GitHub.
          </li>
          <li>
            <strong>Homepage URL</strong> — your deployment URL, eg.{" "}
            <Mono>https://octopus.example.com</Mono>.
          </li>
          <li>
            <strong>Callback URL</strong> — leave blank.
          </li>
          <li>
            <strong>Setup URL</strong> (under <em>Post installation</em>) — set
            to <Mono>https://your-domain/api/github/callback</Mono>, and check
            <em> Redirect on update</em>. GitHub redirects users here after
            install, carrying the <Mono>installation_id</Mono> and signed{" "}
            <Mono>state</Mono> the callback needs to link the installation back
            to the org. Without it the install completes on github.com, the
            callback never fires, and reviews never start.
          </li>
          <li>
            <strong>Webhook</strong> — check <em>Active</em>. URL:
            <CodeBlock>{`https://your-domain/api/github/webhook`}</CodeBlock>
            Generate a random <strong>webhook secret</strong> (any high-entropy
            string, eg. <Mono>openssl rand -hex 32</Mono>) and paste it. Keep
            a copy — you&apos;ll need it for <Mono>GITHUB_WEBHOOK_SECRET</Mono>.
          </li>
          <li>
            <strong>Permissions</strong> — repository permissions:
            <UL>
              <li>
                <Mono>Contents</Mono>: Read-only (Octopus clones to index)
              </li>
              <li>
                <Mono>Pull requests</Mono>: Read & write (post review comments)
              </li>
              <li>
                <Mono>Checks</Mono>: Read & write (set the review status check)
              </li>
              <li>
                <Mono>Metadata</Mono>: Read-only (automatic — leave default)
              </li>
            </UL>
          </li>
          <li>
            <strong>Subscribe to events</strong>:
            <UL>
              <li>
                <Mono>Pull request</Mono> — main trigger
              </li>
              <li>
                <Mono>Pull request review</Mono> — to react to human reviewer
                actions
              </li>
            </UL>
          </li>
          <li>
            <strong>Where can this App be installed?</strong> — pick
            <em> Any account </em>if you want other orgs to install it; pick
            <em> Only on this account </em>for a private/self-hosted setup.
          </li>
          <li>
            Click <strong>Create GitHub App</strong>. You&apos;ll land on the
            App&apos;s settings page.
          </li>
          <li>
            Note the <strong>App ID</strong> at the top — this is your{" "}
            <Mono>GITHUB_APP_ID</Mono>.
          </li>
          <li>
            Note the <strong>slug</strong> from the URL bar
            (<Mono>github.com/settings/apps/<strong>this-part</strong></Mono>) — this is your{" "}
            <Mono>NEXT_PUBLIC_GITHUB_APP_SLUG</Mono>.
          </li>
          <li>
            Scroll to <strong>Private keys → Generate a private key</strong>.
            A <Mono>.pem</Mono> file downloads. Open it; the contents are your{" "}
            <Mono>GITHUB_APP_PRIVATE_KEY</Mono> (paste with newlines preserved).
          </li>
        </OL>
      </Section>

      <Section title="Env vars">
        <P>Drop these into your <Mono>.env</Mono>:</P>
        <CodeBlock>{`GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...lines from the .pem file...
-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=<the secret you generated above>
NEXT_PUBLIC_GITHUB_APP_SLUG=<the slug from the App's URL>`}</CodeBlock>
        <P>
          Restart the server. The &quot;Install GitHub App&quot; button on{" "}
          <Mono>/settings/integrations</Mono> should now appear and link to{" "}
          <Mono>https://github.com/apps/&lt;slug&gt;/installations/new</Mono>.
        </P>
      </Section>

      <Section title="Installing the App into your repos">
        <P>
          From <Mono>/settings/integrations</Mono> click{" "}
          <strong>Install GitHub App</strong>. GitHub asks the user (must be a
          repo or org admin) to pick:
        </P>
        <UL>
          <li>
            <strong>All repositories</strong> — every repo the org has, now and
            in the future. Simplest; fine when Octopus runs reviews for the
            whole org.
          </li>
          <li>
            <strong>Only select repositories</strong> — explicit allowlist.
            Recommended for shared orgs where you only want Octopus on a
            subset.
          </li>
        </UL>
        <P>
          After approval GitHub redirects back to{" "}
          <Mono>/api/github/callback</Mono>, Octopus stores the{" "}
          <Mono>installation_id</Mono> on your <Mono>Organization</Mono> row,
          and reviews start flowing on the next PR push.
        </P>
      </Section>

      <Section title="Staging vs production — use separate Apps">
        <P>
          <strong>Don&apos;t share one App across environments.</strong> Webhook
          URLs are fixed per-App, and you don&apos;t want production traffic
          hitting your staging server (or vice versa). Create one App per
          environment with a distinct webhook URL:
        </P>
        <UL>
          <li>
            <strong>Production</strong>:{" "}
            <Mono>octopus-review</Mono> →{" "}
            <Mono>https://octopus.example.com/api/github/webhook</Mono>
          </li>
          <li>
            <strong>Staging</strong>:{" "}
            <Mono>octopus-staging</Mono> →{" "}
            <Mono>https://staging.example.com/api/github/webhook</Mono>
          </li>
          <li>
            <strong>Local dev</strong>: <Mono>octopus-dev</Mono> →{" "}
            <Mono>https://your-ngrok-tunnel.app/api/github/webhook</Mono>
          </li>
        </UL>
        <P>
          Each App has its own App ID, private key, slug, and webhook secret —
          set them as distinct env values per environment. Test orgs install
          the staging App; real orgs install production. Local development
          installs the dev App into a sandbox org (eg. a personal account with
          one test repo).
        </P>
      </Section>

      <Section title="Troubleshooting">
        <H3>Webhook deliveries failing</H3>
        <P>
          Open your App&apos;s <Mono>Advanced</Mono> tab on GitHub →{" "}
          <Mono>Recent deliveries</Mono>. Failed deliveries show the response
          status. Common causes:
        </P>
        <UL>
          <li>
            <Mono>401 invalid signature</Mono> — webhook secret mismatch. The
            secret you set on the App must equal the env var{" "}
            <Mono>GITHUB_WEBHOOK_SECRET</Mono>.
          </li>
          <li>
            <Mono>404</Mono> — wrong webhook URL on the App, or your server
            isn&apos;t reachable from GitHub&apos;s IPs.
          </li>
          <li>
            <Mono>500</Mono> — check your server logs. Often a database not
            being reachable.
          </li>
        </UL>

        <H3>Reviews aren&apos;t posting</H3>
        <P>
          Webhooks are arriving but no review comment shows up. Check:
        </P>
        <UL>
          <li>
            App has <Mono>Pull requests: Read & write</Mono> — not just read.
          </li>
          <li>
            App is actually installed on the repo (it&apos;s possible for an
            org to install for &quot;selected repos&quot; that excludes the
            one you&apos;re testing).
          </li>
          <li>
            The review worker is running — if jobs are never picked up, set{" "}
            <Mono>ENABLE_REVIEW_WORKERS=true</Mono> on the review-engine process.
          </li>
        </UL>

        <H3>&quot;GitHub App not configured&quot; on /settings/integrations</H3>
        <P>
          <Mono>NEXT_PUBLIC_GITHUB_APP_SLUG</Mono> isn&apos;t set. Restart the
          server after editing <Mono>.env</Mono> — Next.js inlines{" "}
          <Mono>NEXT_PUBLIC_*</Mono> vars at build time, so a hot reload
          isn&apos;t enough.
        </P>
      </Section>

    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-4 text-sm font-semibold text-[#ccc]">{children}</h3>;
}

function OL({ children }: { children: React.ReactNode }) {
  return (
    <ol className="mb-3 list-inside list-decimal space-y-3 text-sm leading-relaxed text-[#888]">
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
