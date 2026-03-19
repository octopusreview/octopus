import {
  IconBrandGithub,
  IconBrandBitbucket,
  IconBrandSlack,
  IconPlugConnected,
  IconWebhook,
  IconMessage,
  IconGitPullRequest,
  IconCode,
  IconChecklist,
  IconBug,
} from "@tabler/icons-react";

export const metadata = {
  title: "Integrations — Octopus Docs",
  description:
    "Connect Octopus with GitHub, Bitbucket, Linear, and Slack for automated code reviews and team workflows.",
};

export default function IntegrationsPage() {
  return (
    <article className="max-w-3xl">
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
        <EnvBlock
          vars={[
            { name: "GITHUB_APP_ID", description: "Your GitHub App ID" },
            { name: "GITHUB_APP_PRIVATE_KEY", description: "RSA private key (PEM or base64-encoded)" },
            { name: "GITHUB_APP_WEBHOOK_SECRET", description: "Webhook secret for event verification" },
          ]}
        />
      </IntegrationSection>

      {/* Bitbucket */}
      <IntegrationSection
        icon={<IconBrandBitbucket className="size-5" />}
        name="Bitbucket"
        description="Connect your Bitbucket workspace for automated PR reviews with OAuth-based authentication."
        setup={[
          "Connect Bitbucket from the settings page via OAuth",
          "Webhooks are created automatically for selected repositories",
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
        <EnvBlock
          vars={[
            { name: "BITBUCKET_CLIENT_ID", description: "OAuth consumer key" },
            { name: "BITBUCKET_CLIENT_SECRET", description: "OAuth consumer secret" },
          ]}
        />
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
  setup: string[];
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-white/[0.06] text-[#888]">
          {icon}
        </div>
        <h2 className="text-xl font-semibold text-white">{name}</h2>
      </div>
      <P>{description}</P>

      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-[#ccc]">Setup</h3>
        <ol className="list-inside list-decimal space-y-1.5 text-sm text-[#888]">
          {setup.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

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

function EnvBlock({
  vars,
}: {
  vars: { name: string; description: string }[];
}) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-semibold text-[#ccc]">
        Environment Variables
      </h3>
      <div className="space-y-1">
        {vars.map((v) => (
          <div
            key={v.name}
            className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2"
          >
            <code className="text-xs text-white sm:text-sm">{v.name}</code>
            <span className="mt-1 block text-xs text-[#555]">
              {v.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
