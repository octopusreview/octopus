import {
  IconBrandGithub,
  IconBrandBitbucket,
  IconBrandGitlab,
  IconBrandSlack,
  IconPlugConnected,
  IconWebhook,
  IconMessage,
  IconGitPullRequest,
  IconCode,
  IconChecklist,
  IconBug,
  IconServer,
} from "@tabler/icons-react";
import { docsPageJsonLd, jsonLd } from "@/lib/structured-data";
import { CodeBlock } from "../self-hosting/code-block";

export const metadata = {
  title: "Integrations",
  description:
    "Connect Octopus to GitHub, GitLab (including self-hosted), Bitbucket, Forgejo, Linear, Jira, and Slack. Automate AI code review across your team's pull request workflow in a few minutes.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/integrations",
  },
};

export default function IntegrationsPage() {
  return (
    <article className="max-w-3xl">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLd(
            docsPageJsonLd({
              title: metadata.title,
              description: metadata.description,
              path: "/docs/integrations",
              crumb: "Integrations",
            }),
          ),
        }}
      />
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconPlugConnected className="size-4" />
          Integrations
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Integrations
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Connect Octopus with your existing tools for automated code reviews
          and seamless team workflows.
        </p>
      </div>

      <section id="setup-checks" className="mb-10 scroll-mt-24">
        <h2 className="mb-3 text-xl font-semibold text-white">Setup checks and recovery</h2>
        <P>Settings → Integrations shows authorization, repository sync and webhook configuration separately. Not checked means there is no setup evidence yet. A configured webhook does not prove that a PR event has reached Octopus; follow the <a href="/docs/getting-started" className="text-cyan-400 underline">first-review guide</a> to confirm the review completes. Forgejo webhooks remain manually configured and unconfirmed until a successful review.</P>
        <P>An organization owner or admin can use Retry setup or Check setup for the affected provider. The check preserves credentials and checks existing repositories as well as newly discovered ones. GitLab uses project webhooks; Bitbucket uses a workspace webhook.</P>
        <P>If an existing GitLab or Bitbucket webhook has ambiguous ownership, Octopus leaves it unchanged and does not create a duplicate. Open Repair an existing webhook in the integration card only after identifying it from your saved hook ID or team records. A matching callback URL alone is not proof of ownership. Leave unclear hooks untouched and ask the person who configured them.</P>
        <P>For a confirmed hook, use the current connection secret and exact callback URL shown in the repair details, plus the description for Bitbucket. Follow the event and TLS instructions there, save the provider settings, then run the setup check again. After disconnecting and reconnecting, reload the details and save the current secret and connection marker together; an old hook does not establish readiness for a new connection.</P>
        <P>Reauthorizing the same GitLab host and namespace or Bitbucket workspace preserves its signing secret. To replace that binding, an owner or admin must explicitly disconnect and reconnect; the new connection has a distinct signing secret. Disconnecting leaves remote hooks in place. Remove obsolete hooks you own in the provider settings, or repair them for the new connection using the steps above.</P>
      </section>

      {/* GitHub */}
      <IntegrationSection
        icon={<IconBrandGithub className="size-5" />}
        name="GitHub"
        description="Install the Octopus GitHub App to enable automatic PR reviews, check runs, and inline code comments."
        setup={[
          "Install the Octopus GitHub App from the settings page",
          "Select which repositories to monitor",
          "PRs are reviewed automatically on open and update",
        ]}
      >
        <FeatureGrid>
          <Feature
            icon={<IconGitPullRequest className="size-4" />}
            title="Automatic PR Reviews"
            description="Every new or updated pull request gets an AI-powered review with severity levels and inline comments."
          />
          <Feature
            icon={<IconChecklist className="size-4" />}
            title="Check Runs"
            description="Review results appear as GitHub check runs. Critical findings block merge with REQUEST_CHANGES."
          />
          <Feature
            icon={<IconCode className="size-4" />}
            title="Inline Comments"
            description="Findings are posted as line-by-line review comments directly on the diff."
          />
          <Feature
            icon={<IconBug className="size-4" />}
            title="Issue Creation"
            description="Create GitHub issues directly from review findings for tracking and follow-up."
          />
        </FeatureGrid>
      </IntegrationSection>

      {/* GitLab */}
      <IntegrationSection
        icon={<IconBrandGitlab className="size-5" />}
        name="GitLab"
        description="Connect your GitLab account for automatic merge request reviews. Works with both gitlab.com and self-hosted GitLab instances."
        setup={[
          "Connect GitLab from the settings page via OAuth",
          "For self-hosted GitLab, register your own OAuth application and enter the instance URL and credentials",
          "Select projects to monitor — project webhooks are created automatically",
          "MRs are reviewed automatically on open and update",
        ]}
      >
        <P>
          If GitLab is unreachable, times out, rejects authorization or returns an
          invalid response during connection, Octopus returns you to Settings →
          Integrations with an error and keeps any existing connection unchanged.
          Start the connection again from there. For repeated authorization
          failures, check your OAuth app settings; for namespace errors, check
          the group or username and your access. If the instance is unavailable,
          wait until it recovers before trying again.
        </P>
        <FeatureGrid>
          <Feature
            icon={<IconGitPullRequest className="size-4" />}
            title="MR Reviews"
            description="Automatic reviews on merge request creation and updates, with severity-rated findings."
          />
          <Feature
            icon={<IconCode className="size-4" />}
            title="Inline Comments"
            description="Findings posted as line-by-line discussion notes directly on the MR diff."
          />
          <Feature
            icon={<IconServer className="size-4" />}
            title="Self-Hosted Support"
            description="Bring your own GitLab instance. Per-org OAuth credentials override gitlab.com defaults."
          />
          <Feature
            icon={<IconWebhook className="size-4" />}
            title="Project Webhooks"
            description="One webhook per project is registered at sync time — no Premium tier required."
          />
        </FeatureGrid>
      </IntegrationSection>

      {/* Bitbucket */}
      <IntegrationSection
        icon={<IconBrandBitbucket className="size-5" />}
        name="Bitbucket"
        description="Connect your Bitbucket workspace for automated PR reviews with OAuth-based authentication."
        setup={[
          "Connect Bitbucket from the settings page via OAuth",
          "Octopus checks or creates the workspace webhook during repository sync; see setup checks above for recovery",
          "Reviews are posted as PR comments with inline code feedback",
        ]}
      >
        <FeatureGrid>
          <Feature
            icon={<IconGitPullRequest className="size-4" />}
            title="PR Reviews"
            description="Automatic reviews on pull request creation and updates."
          />
          <Feature
            icon={<IconCode className="size-4" />}
            title="Inline Comments"
            description="Findings posted as inline comments on specific lines in the diff."
          />
          <Feature
            icon={<IconWebhook className="size-4" />}
            title="Webhooks"
            description="Automatic webhook management for real-time PR event processing."
          />
        </FeatureGrid>
      </IntegrationSection>

      <IntegrationSection
        icon={<IconServer className="size-5" />}
        name="Forgejo"
        description="Choose a connection based on where Octopus runs and whether your Forgejo instance is reachable from the internet. All three options review pull requests and post comments and commit statuses."
      >
        <nav aria-label="Forgejo connection options" className="mb-6 grid gap-3">
          {[
            ["forgejo-cloud-public", "1. Octopus Cloud + public HTTPS", "Connect directly to an internet-reachable Forgejo instance."],
            ["forgejo-cloud-private", "2. Octopus Cloud + private LAN/VPN", "Run the local connector. Your Forgejo instance stays private."],
            ["forgejo-self-hosted", "3. Self-hosted Octopus + private LAN/VPN", "Connect directly from your own Octopus deployment."],
          ].map(([id, title, description]) => (
            <a key={id} href={`#${id}`} className="rounded-lg border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-cyan-400/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400">
              <span className="text-sm font-medium text-white">{title}</span>
              <span className="mt-1 block text-sm text-[#888]">{description}</span>
            </a>
          ))}
        </nav>
        <h3 id="forgejo-token-requirements" className="mb-2 scroll-mt-24 text-base font-semibold text-white">Before you connect</h3>
        <P>
          Create a dedicated Forgejo account with admin access only to the
          repositories you want reviewed. It does not need instance administrator
          access. In that account&apos;s Settings → Applications, generate a token
          with <code>read:user</code>, <code>write:repository</code> and{" "}
          <code>write:issue</code>. For private repositories, choose the token&apos;s{" "}
          <strong className="text-[#ccc]">All (public, private, and limited)</strong>{" "}repository
          access option. Restrict access through the dedicated account&apos;s
          repository permissions: Forgejo&apos;s <strong className="text-[#ccc]">Specific repositories</strong> tokens
          cannot include <code>read:user</code>, which Octopus uses to identify the
          connected account. See{" "}
          <a href="https://forgejo.org/docs/latest/user/authentication/token-scope/" className="text-cyan-400 underline">Forgejo&apos;s token scope guide</a>.
        </P>
        <P>One Forgejo instance can be connected per Octopus organization. Only repositories the connected account administers are synced.</P>

        <section id="forgejo-cloud-public" className="my-6 scroll-mt-24">
          <h3 className="mb-2 text-base font-semibold text-white">1. Octopus Cloud + public HTTPS</h3>
          <P>Use this when Octopus Cloud can reach your Forgejo instance over public HTTPS. Forgejo also needs outbound HTTPS access to Octopus Cloud for webhooks.</P>
          <ol className="mb-3 list-outside list-decimal space-y-2 pl-5 text-sm text-[#888]">
            <li>Open Octopus Cloud → Settings → Integrations → Forgejo and choose <strong className="text-[#ccc]">Public HTTPS instance</strong>.</li>
            <li>Enter the public HTTPS instance URL and the Forgejo personal access token. Connect and sync repositories. Octopus stores this token encrypted.</li>
            <li>Add the <a href="#forgejo-webhooks" className="text-cyan-400 underline">signed repository webhooks</a>, then <a href="#forgejo-connector-step-7" className="text-cyan-400 underline">prepare your repository and enable reviews</a>.</li>
          </ol>
        </section>

        <section id="forgejo-cloud-private" className="my-10 scroll-mt-24">
          <h3 className="mb-3 text-xl font-semibold text-white">2. Octopus Cloud + private LAN/VPN</h3>
          <div className="mb-6 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-5 sm:p-6">
            <h4 className="text-base font-semibold text-white">Where is the connector?</h4>
            <p className="mt-2 text-sm leading-6 text-[#ccc]">
              The Forgejo connector is a small Docker container. Run it on an
              always-on machine in the same LAN or VPN as Forgejo. Docker downloads
              the connector image automatically when you run the command in <a href="#forgejo-connector-step-4" className="text-cyan-400 underline underline-offset-4">step 4</a>.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 text-sm">
              <a href="https://github.com/orgs/octopusreview/packages/container/octopus-selfhost/1269975499" className="text-cyan-400 underline underline-offset-4">View connector image</a>
              <a href="https://docs.docker.com/get-started/get-docker/" className="text-cyan-400 underline underline-offset-4">Install Docker</a>
              <a href="https://github.com/octopusreview/octopus/tree/v1.2.0/packages/forgejo-connector" className="text-cyan-400 underline underline-offset-4">Connector source</a>
            </div>
          </div>

          <div className="mb-6 rounded-xl border border-white/10 p-5 sm:p-6">
            <h4 className="text-base font-semibold text-white">Have these ready</h4>
            <ul className="mt-3 list-outside list-disc space-y-3 pl-5 text-sm leading-6 text-[#bbb]">
              <li><strong className="text-white">Owner or admin access in your Octopus organization.</strong> You need this to create and manage the connector.</li>
              <li><strong className="text-white">Docker on the connector machine.</strong> The container must be able to reach Forgejo through your LAN/VPN routes and DNS. Access from your laptop&apos;s browser alone is not enough.</li>
              <li><strong className="text-white">A verified HTTPS Forgejo address.</strong> Use its hostname or LAN/VPN IP, including a port if needed, without a path. HTTP, redirects, localhost, loopback, link-local and metadata addresses are blocked. An internal certificate authority needs the <a href="#forgejo-connector-tls" className="text-cyan-400 underline underline-offset-4">trusted CA setup in step 4</a>.</li>
              <li><strong className="text-white">Outbound internet access.</strong> Both Forgejo and the connector need HTTPS access to <code className="break-words">octopus-review.ai</code> on port 443. Forgejo sends webhooks directly to Cloud. You do not need a tunnel, a public Forgejo address or inbound ports on the connector.</li>
            </ul>
            <p className="mt-4 border-t border-white/10 pt-4 text-sm leading-6 text-[#bbb]">
              Your Forgejo token stays on the connector machine. Code, diffs and
              review context still travel to Octopus Cloud and your configured AI
              services. This keeps Forgejo private; review processing happens in Cloud.
            </p>
          </div>

          <ol role="list" className="space-y-5">
            <ForgejoSetupStep number={1} location="In Forgejo" title="Create the Forgejo access token">
              <p>Sign in with a dedicated account that administers only the repositories you want reviewed. It does not need instance administrator access.</p>
              <p>Open that account&apos;s <strong className="text-white">Settings → Applications</strong> and generate a personal access token with <code>read:user</code>, <code>write:repository</code> and <code>write:issue</code>.</p>
              <p>For private repositories, choose <strong className="text-white">All (public, private, and limited)</strong>; limit access through the account&apos;s repository permissions. <a href="#forgejo-token-requirements" className="text-cyan-400 underline underline-offset-4">Full token requirements</a>.</p>
              <p className="rounded-lg bg-white/[0.04] p-3"><strong className="text-white">Keep this token locally.</strong> It becomes <code>FORGEJO_TOKEN</code> in step 3. You do not paste it into Octopus Cloud.</p>
            </ForgejoSetupStep>

            <ForgejoSetupStep number={2} location="In Octopus Cloud" title="Create the connector token">
              <a href="/settings/integrations#forgejo" className="inline-flex min-h-10 items-center rounded-lg bg-cyan-400 px-4 py-2 font-medium text-black transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400">Open Forgejo settings</a>
              <p>In <strong className="text-white">Settings → Integrations → Forgejo</strong>, select <strong className="text-white">Private network connector</strong>. Enter your exact HTTPS Forgejo address and click <strong className="text-white">Create connector</strong>.</p>
              <p>Click <strong className="text-white">Copy connector token</strong> and save it securely; it is shown only once. This separate token pairs your local connector with Octopus and becomes <code className="break-all">OCTOPUS_CONNECTOR_TOKEN</code> below.</p>
            </ForgejoSetupStep>

            <ForgejoSetupStep number={3} location="On the connector machine" title="Create your configuration file">
              <p>Create a file named <code>connector.env</code> and paste this template. Replace the example address and both token placeholders.</p>
              <CodeBlock title="connector.env">{`OCTOPUS_URL=https://octopus-review.ai
OCTOPUS_CONNECTOR_TOKEN=YOUR_CONNECTOR_CREDENTIAL
FORGEJO_URL=https://forgejo.internal.example
FORGEJO_TOKEN=YOUR_FORGEJO_PERSONAL_ACCESS_TOKEN`}</CodeBlock>
              <dl className="space-y-3 rounded-lg bg-white/[0.04] p-3">
                <div><dt className="font-medium text-white"><code className="break-all">OCTOPUS_CONNECTOR_TOKEN</code></dt><dd>The one-time token from Octopus in step 2.</dd></div>
                <div><dt className="font-medium text-white"><code>FORGEJO_TOKEN</code></dt><dd>The personal access token from Forgejo in step 1.</dd></div>
              </dl>
              <p>Keep this file private and out of your Git repositories.</p>
            </ForgejoSetupStep>

            <ForgejoSetupStep number={4} location="On the connector machine" title="Start the connector with Docker">
              <p>Open a terminal in the folder containing <code>connector.env</code> and run this command. It downloads the connector and starts it in the background. Keep the container running for indexing and reviews.</p>
              <p>If Forgejo uses an internal certificate authority, use the trusted CA command below instead.</p>
              <CodeBlock title="Terminal — start the connector">{String.raw`chmod 600 connector.env
docker run -d --name octopus-forgejo-connector \
  --restart unless-stopped --stop-timeout 120 --read-only \
  --env-file connector.env \
  ghcr.io/octopusreview/octopus-selfhost:forgejo-connector-1.2.0`}</CodeBlock>
              <details id="forgejo-connector-tls" className="scroll-mt-24 rounded-lg border border-white/10">
                <summary className="cursor-pointer rounded-lg px-4 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400">Using an internal certificate authority?</summary>
                <div className="space-y-3 border-t border-white/10 p-4">
                  <p>Before starting the container, add this line to <code>connector.env</code>:</p>
                  <CodeBlock title="Add to connector.env">{"NODE_EXTRA_CA_CERTS=/certs/forgejo-ca.pem"}</CodeBlock>
                  <p>Use the command below, replacing <code className="break-all">/absolute/path/forgejo-ca.pem</code> with the trusted PEM certificate file on your machine. The file is mounted read-only. Keep TLS certificate verification enabled.</p>
                  <CodeBlock title="Terminal — start with your trusted CA">{String.raw`chmod 600 connector.env
docker run -d --name octopus-forgejo-connector \
  --restart unless-stopped --stop-timeout 120 --read-only \
  --env-file connector.env \
  --mount type=bind,src=/absolute/path/forgejo-ca.pem,dst=/certs/forgejo-ca.pem,readonly \
  ghcr.io/octopusreview/octopus-selfhost:forgejo-connector-1.2.0`}</CodeBlock>
                </div>
              </details>
            </ForgejoSetupStep>

            <ForgejoSetupStep number={5} location="Back in Octopus Cloud" title="Check the connection and sync repositories">
              <p>Return to <a href="/settings/integrations#forgejo" className="text-cyan-400 underline underline-offset-4">Forgejo settings</a> and click <strong className="text-white">Refresh status</strong>. When the status reads <strong className="text-white">Connector online</strong>, click <strong className="text-white">Sync repositories</strong>.</p>
              <p>Only repositories the Forgejo account administers will appear. If the status stays <strong className="text-white">Waiting for connector</strong> or <strong className="text-white">Connector offline</strong>, check that its container can reach both Forgejo and Octopus Cloud before continuing.</p>
            </ForgejoSetupStep>

            <ForgejoSetupStep number={6} location="In each Forgejo repository" title="Add the signed webhook">
              <p>Open the repository&apos;s <strong className="text-white">Settings → Webhooks → Add Webhook → Forgejo</strong>. Copy the webhook URL and secret shown in <a href="/settings/integrations#forgejo" className="text-cyan-400 underline underline-offset-4">Octopus Forgejo settings</a>.</p>
              <ul className="list-outside list-disc space-y-2 pl-5">
                <li>Use <strong className="text-white">POST</strong> and <code>application/json</code>.</li>
                <li>Under <strong className="text-white">Trigger on</strong>, choose <strong className="text-white">Custom events…</strong>.</li>
                <li>Under <strong className="text-white">Pull request events</strong>, select <strong className="text-white">Modification</strong> and <strong className="text-white">Synchronized</strong> to review new pull requests and pushed commits.</li>
                <li>In that same group, select <strong className="text-white">Comments</strong> for <code>@octopus</code> or <code>/octopus</code> PR commands. Keep <strong className="text-white">Active</strong> checked and save the webhook.</li>
              </ul>
              <p>The webhook goes directly from Forgejo to Octopus Cloud. <a href="#forgejo-webhooks" className="text-cyan-400 underline underline-offset-4">Webhook and review-event details</a>.</p>
            </ForgejoSetupStep>

            <ForgejoSetupStep number={7} location="In Octopus Cloud" title="Confirm readiness and open your first PR">
              <ol className="list-outside list-decimal space-y-3 pl-5">
                <li>Open <a href="/repositories" className="text-cyan-400 underline underline-offset-4">Repositories</a> and click your Forgejo repository.</li>
                <li>Confirm <strong className="text-white">Auto Review</strong> is on in the repository panel; enable it if needed. You can change this setting while preparation is running.</li>
                <li>Octopus indexes and analyzes automatically when a review starts. You can open a PR without clicking Index now or Run Analysis. Preparation progress appears in the repository panel and the <a href="/dashboard" className="text-cyan-400 underline underline-offset-4">first-review guide</a>.</li>
              </ol>
              <div className="rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
                <p className="font-medium text-white">Try your first review</p>
                <p className="mt-1">Open a non-draft pull request in Forgejo and follow it in <a href="/review-logs" className="text-cyan-400 underline underline-offset-4">Review Logs</a>. Check that the review completes and its comments and final commit status appear on Forgejo. A successful webhook test alone does not confirm the full review flow.</p>
              </div>
            </ForgejoSetupStep>
          </ol>

          <details className="mt-6 rounded-xl border border-white/10 text-sm leading-6 text-[#bbb]">
            <summary className="cursor-pointer rounded-xl p-5 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400">Reconnect, rotate a token, or remove the connector</summary>
            <div className="space-y-4 border-t border-white/10 p-5">
              <p><strong className="text-white">Offline:</strong> restore the container&apos;s network access and click <strong className="text-white">Refresh status</strong>. Keep the connector running for indexing, reviews and comment publication.</p>
              <p><strong className="text-white">Rotate the connector token:</strong> generate a replacement in Octopus, update <code>connector.env</code>, then stop and remove the existing Docker container and run the matching command from step 4 again. A plain <code>docker restart</code> does not reload the environment file. The old connector token stops working.</p>
              <p><strong className="text-white">Paused after an uncertain write:</strong> a comment or status may have reached Forgejo even if its result was lost. Check the affected PR before choosing <strong className="text-white">Resume after checking Forgejo</strong>. Octopus does not automatically replay that write.</p>
              <p><strong className="text-white">Disconnect:</strong> disconnecting in Octopus deactivates the repositories. Remove their webhooks, stop the local connector and revoke the Forgejo personal access token too.</p>
            </div>
          </details>
        </section>

        <section id="forgejo-self-hosted" className="my-6 scroll-mt-24">
          <h3 className="mb-2 text-base font-semibold text-white">3. Self-hosted Octopus + private LAN/VPN</h3>
          <P>
            Run your own Octopus web application and review workers where both
            can reach Forgejo. Enable self-host mode and explicitly allow the
            exact HTTPS origin through <code>FORGEJO_ALLOWED_PRIVATE_ORIGINS</code>.
            This direct connection does not require the local connector.
          </P>
          <ol className="mb-3 list-outside list-decimal space-y-2 pl-5 text-sm text-[#888]">
            <li>Follow the <a href="/docs/self-hosting#forgejo" className="text-cyan-400 underline">self-hosted network, DNS and certificate setup</a> on both web and review workers.</li>
            <li>In your Octopus Settings → Integrations → Forgejo, enter the private HTTPS origin and personal access token, then click <strong className="text-[#ccc]">Connect Forgejo</strong> to connect and sync repositories.</li>
            <li>Add signed webhooks targeting your own Octopus deployment. If the target is private, allow its exact host in Forgejo&apos;s <code>[webhook] ALLOWED_HOST_LIST</code>, keeping existing entries.</li>
            <li>In your own Octopus deployment, open Repositories, select the repository and confirm Auto Review is on. Open a non-draft PR; indexing and analysis run automatically. Follow Review Logs until the first review completes.</li>
          </ol>
          <P>Your Octopus deployment and configured AI services determine where reviews are processed. Use local AI services when processing must stay on your network.</P>
        </section>

        <section id="forgejo-webhooks" className="my-6 scroll-mt-24">
          <h3 className="mb-2 text-base font-semibold text-white">Signed webhooks and review events</h3>
          <P>
            In each synced Forgejo repository, open Settings → Webhooks → Add
            Webhook → Forgejo. Use POST, <code>application/json</code>, and the
            target URL and secret shown in Octopus. Under Trigger on, choose
            Custom events… → Pull request events, then select Modification and
            Synchronized. Select Comments in that same group for <code>@octopus</code> or <code>/octopus</code>{" "}
            PR commands. Keep Active checked and save the webhook. A successful Test Delivery checks transport; a real
            pull request checks the complete review flow.
          </P>
          <P>
            With automatic reviews enabled, Octopus accepts pull_request events
            with action opened, reopened or synchronized, plus edited events
            containing changes.title.from. Removing a draft title prefix can
            trigger that title-change event. Octopus checks the current PR on
            Forgejo: only open, non-draft PRs qualify. Body-only edits do not
            trigger reviews. Automatic events skip a head with a prior review
            attempt or completed review, and cannot admit a second request while
            that head is pending, queued or reviewing.
          </P>
          <P>
            For an explicit re-review of a completed head, post a new comment
            with the complete @octopus or /octopus command, or request it from
            Octopus. Longer aliases such as @octopus-review are not accepted.
            Replaying the same signed webhook payload does not create another
            review request.
          </P>
        </section>
      </IntegrationSection>

      {/* Linear */}
      <IntegrationSection
        icon={
          <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.77 17.64a1.06 1.06 0 0 1-.27-.93l2.32-11.1a1.06 1.06 0 0 1 .62-.76l10.4-4.7a1.06 1.06 0 0 1 .93.04l5.46 3.18a1.06 1.06 0 0 1 .5.78l.77 6.26a1.06 1.06 0 0 1-.27.87l-7.7 8.32a1.06 1.06 0 0 1-.87.34l-6.26-.44a1.06 1.06 0 0 1-.82-.52L2.77 17.64z" />
          </svg>
        }
        name="Linear"
        description="Create Linear issues directly from code review findings. Track and assign bugs discovered during reviews."
        setup={[
          "Connect Linear via OAuth from the settings page",
          "Select the default team for issue creation",
          "Create issues from any review finding with one click",
        ]}
      >
        <FeatureGrid>
          <Feature
            icon={<IconBug className="size-4" />}
            title="Issue Creation"
            description="Turn review findings into Linear issues with title, description, priority, and team assignment."
          />
          <Feature
            icon={<IconChecklist className="size-4" />}
            title="Status Tracking"
            description="Track issue status directly from the Octopus dashboard."
          />
        </FeatureGrid>
      </IntegrationSection>

      {/* Jira */}
      <IntegrationSection
        icon={
          <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.53 2a4.46 4.46 0 0 0 4.46 4.46h1.78v1.72A4.46 4.46 0 0 0 22.23 12.64V2.84a.84.84 0 0 0-.84-.84zM6.77 6.77a4.46 4.46 0 0 0 4.46 4.46H13v1.72a4.46 4.46 0 0 0 4.46 4.46V7.61a.84.84 0 0 0-.84-.84zM2 11.53A4.46 4.46 0 0 0 6.46 16h1.78v1.72A4.46 4.46 0 0 0 12.7 22.18V12.37a.84.84 0 0 0-.84-.84z" />
          </svg>
        }
        name="Jira"
        description="Turn code review findings into Jira issues. Connect your Atlassian Cloud site to track bugs and improvements alongside your existing workflow."
        setup={[
          "Connect Jira via OAuth from the settings page",
          "Select the Atlassian site and default project for issue creation",
          "Create issues from any review finding with one click",
        ]}
      >
        <FeatureGrid>
          <Feature
            icon={<IconBug className="size-4" />}
            title="Issue Creation"
            description="Turn review findings into Jira issues with title, description, issue type, and project assignment."
          />
          <Feature
            icon={<IconChecklist className="size-4" />}
            title="Status Tracking"
            description="Track issue status directly from the Octopus dashboard without leaving the review."
          />
        </FeatureGrid>
      </IntegrationSection>

      {/* Slack */}
      <IntegrationSection
        icon={<IconBrandSlack className="size-5" />}
        name="Slack"
        description="Ask questions about your codebase and get notifications in Slack. Octopus searches your code, docs, and review history to answer."
        setup={[
          "Install the Octopus Slack app from the settings page",
          "Select channels and configure event notifications",
          "Use /octopus to ask questions about your codebase",
        ]}
      >
        <FeatureGrid>
          <Feature
            icon={<IconMessage className="size-4" />}
            title="/octopus Command"
            description="Ask questions about your codebase in any channel. Octopus searches code, docs, reviews, and knowledge base to answer."
          />
          <Feature
            icon={<IconWebhook className="size-4" />}
            title="Event Notifications"
            description="Get notified when reviews complete, repos are indexed, or knowledge documents are ready."
          />
        </FeatureGrid>
        <P>Configurable events:</P>
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            "review-requested",
            "review-completed",
            "review-failed",
            "repo-indexed",
            "repo-analyzed",
            "knowledge-ready",
          ].map((e) => (
            <span
              key={e}
              className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-xs text-[#888]"
            >
              {e}
            </span>
          ))}
        </div>
      </IntegrationSection>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function ForgejoSetupStep({
  number,
  location,
  title,
  children,
}: {
  number: number;
  location: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li id={`forgejo-connector-step-${number}`} className="min-w-0 scroll-mt-24 rounded-xl border border-white/10 bg-white/[0.02] p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full border border-cyan-400/30 bg-cyan-400/10 text-sm font-semibold text-cyan-400">{number}</span>
        <div className="min-w-0">
          <p className="mb-1 text-xs font-medium text-[#aaa]">{location}</p>
          <h4 className="text-base font-semibold leading-6 text-white">{title}</h4>
        </div>
      </div>
      <div className="min-w-0 space-y-3 text-sm leading-6 text-[#bbb]">{children}</div>
    </li>
  );
}

function IntegrationSection({
  icon,
  name,
  description,
  setup,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  description: string;
  setup?: string[];
  children: React.ReactNode;
}) {
  return (
    <section id={name.toLowerCase()} className="mb-12 scroll-mt-24">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-white/[0.06] text-[#888]">
          {icon}
        </div>
        <h2 className="text-xl font-semibold text-white">{name}</h2>
      </div>
      <P>{description}</P>

      {setup && <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-[#ccc]">Setup</h3>
        <ol className="list-inside list-decimal space-y-1.5 text-sm text-[#888]">
          {setup.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>}

      {children}
    </section>
  );
}

function FeatureGrid({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid gap-3 sm:grid-cols-2">{children}</div>;
}

function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-2 flex size-8 items-center justify-center rounded-lg bg-white/[0.04] text-[#888]">
        {icon}
      </div>
      <h4 className="text-sm font-medium text-white">{title}</h4>
      <p className="mt-1 text-xs leading-relaxed text-[#666]">{description}</p>
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>;
}
