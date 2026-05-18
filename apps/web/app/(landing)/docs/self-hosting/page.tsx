import Link from "@/components/link";
import { IconServer, IconBolt, IconBrain, IconRobot } from "@tabler/icons-react";
import { CodeBlock } from "./code-block";
import { EnvGenerator } from "./env-generator";

export const metadata = {
  title: "Self-Hosting — Octopus Docs",
  description:
    "Deploy Octopus on your own infrastructure with Docker. The fastest path is a single docker compose up; alternatively run Postgres, Qdrant, and Node by hand. Supports local Ollama, Claude Code subscription, and other harnesses for reviews.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/self-hosting",
  },
};

export default function SelfHostingPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconServer className="size-4" />
          Deployment
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Self-Hosting
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Deploy Octopus on your own infrastructure. Your code never leaves your
          servers.
        </p>
      </div>

      {/* Fastest path */}
      <Section title="Fastest path — 3 commands">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-3 py-2 text-xs text-cyan-200">
          <IconBolt className="size-4 shrink-0" />
          <span>
            <strong>Only Docker is required.</strong> The compose file ships
            Postgres and Qdrant alongside the web app — no separate installs.
          </span>
        </div>
        <CodeBlock>{`git clone https://github.com/octopusreview/octopus.git
cd octopus
docker compose up -d`}</CodeBlock>
        <Paragraph>
          Visit <Mono>http://localhost:3000</Mono> when the containers report
          healthy. The first run pulls images and runs migrations automatically.
        </Paragraph>
        <Paragraph>
          You&apos;ll still need to drop a <Mono>.env</Mono> in the repo root
          with an AI provider key (see <a href="#ai-provider" className="text-cyan-400 underline">AI provider choices</a> below)
          and a GitHub App for repo integration (see <a href="#github-app" className="text-cyan-400 underline">GitHub App setup</a>).
          For login providers see{" "}
          <Link href="/docs/oauth-setup" className="text-cyan-400 underline">
            Google &amp; GitHub login setup
          </Link>
          .
        </Paragraph>
      </Section>

      {/* AI provider choices */}
      <Section id="ai-provider" title="AI provider choices">
        <Paragraph>
          The review engine routes through any of these. Pick whatever matches
          your privacy / cost posture — multiple can coexist and orgs can
          override per-repo.
        </Paragraph>

        <ProviderCard
          icon={<IconBrain className="size-4 text-cyan-400" />}
          title="Hosted API (BYOK)"
          subtitle="Anthropic Claude · OpenAI · Google Gemini · Grok · OpenRouter"
        >
          <Paragraph>
            Drop your key in <Mono>.env</Mono>, pick a model in{" "}
            <Mono>Settings → Models</Mono>. Embeddings still need OpenAI
            (<Mono>OPENAI_API_KEY</Mono>) regardless of the review model
            you choose — that&apos;s the only hard external dependency.
          </Paragraph>
        </ProviderCard>

        <ProviderCard
          icon={<IconRobot className="size-4 text-cyan-400" />}
          title="Local — Ollama"
          subtitle="Zero cost, never leaves the machine"
        >
          <Paragraph>
            Install Ollama, pull a coding model (eg.{" "}
            <Mono>ollama pull qwen2.5-coder:32b</Mono>), then either:
          </Paragraph>
          <UL>
            <li>
              Set the repo&apos;s review model to <Mono>ollama:&lt;model-id&gt;</Mono>{" "}
              if Octopus and Ollama share a network (eg. on the same host).
            </li>
            <li>
              For cloud-hosted Octopus reviewing private repos: run{" "}
              <Mono>octp agent serve</Mono> on a developer laptop with Ollama
              installed. Tasks dispatch to that laptop. See{" "}
              <Link href="/docs/cli" className="text-cyan-400 underline">CLI docs</Link>.
            </li>
          </UL>
        </ProviderCard>

        <ProviderCard
          icon={<IconBolt className="size-4 text-cyan-400" />}
          title="Existing subscription — Claude Code, OpenCode, ACPX"
          subtitle="Use the CLI tools you already pay for"
        >
          <Paragraph>
            <strong>Claude Code</strong> in subscription mode shells out to the{" "}
            <Mono>claude</Mono> CLI which carries your Pro / Max auth —
            Octopus never sees the credential. Set{" "}
            <Mono>Organization.claudeCodeAuthMode = &quot;subscription&quot;</Mono>{" "}
            (per-org in settings) and route via the local-agent bridge.
          </Paragraph>
          <Paragraph>
            <strong>OpenCode</strong> and <strong>ACPX</strong> work the same
            way as OpenAI-compatible gateways — set the base URL + bearer
            token on the organization, pick a model with the relevant prefix
            (<Mono>opencode:</Mono>, <Mono>acp:</Mono>).
          </Paragraph>
        </ProviderCard>
      </Section>

      {/* Environment variables */}
      <Section id="environment-variables" title="Environment variables">
        <Paragraph>
          Use the generator to produce a starter <Mono>.env</Mono> with the
          required defaults filled in. A unique{" "}
          <Mono>BETTER_AUTH_SECRET</Mono> is generated for you; the AI provider
          key still needs to be pasted in.
        </Paragraph>

        <EnvGenerator />

        <EnvGroup title="Required — fill these in">
          <EnvVar
            name="OPENAI_API_KEY"
            example="sk-..."
            required
            description="Used for embeddings (text-embedding-3-large). Required even if you don't use OpenAI for reviews."
          />
          <EnvVar
            name="ANTHROPIC_API_KEY"
            example="sk-ant-..."
            description="Optional review provider. Drop one of the AI-provider keys."
          />
          <EnvVar name="GITHUB_APP_ID" example="123456" required />
          <EnvVar name="GITHUB_APP_PRIVATE_KEY" example="-----BEGIN RSA..." required />
          <EnvVar name="GITHUB_WEBHOOK_SECRET" example="whsec_..." required />
        </EnvGroup>

        <EnvGroup title="Optional review providers (BYOK)">
          <EnvVar name="GOOGLE_API_KEY" example="AIza..." description="Gemini" />
          <EnvVar name="GROK_API_KEY" example="xai-..." description="xAI Grok" />
          <EnvVar name="OPENROUTER_API_KEY" example="sk-or-..." description="OpenRouter aggregator" />
        </EnvGroup>

        <EnvGroup title="Pre-filled defaults">
          <EnvVar name="DATABASE_URL" example="postgresql://octopus:octopus@postgres:5432/octopus" required />
          <EnvVar name="QDRANT_URL" example="http://qdrant:6333" required />
          <EnvVar name="BETTER_AUTH_SECRET" example="Auto-generated (64-char hex)" required />
          <EnvVar name="BETTER_AUTH_URL" example="http://localhost:3000" required />
          <EnvVar name="NEXT_PUBLIC_OCTOPUS_SELF_HOSTED" example="true" description="Surfaces the Updates settings page." />
        </EnvGroup>

        <EnvGroup title="OAuth login (optional)">
          <EnvVar name="GITHUB_CLIENT_ID" example="Iv1.abc123" description="Sign in with GitHub button" />
          <EnvVar name="GITHUB_CLIENT_SECRET" example="secret" />
          <EnvVar name="GOOGLE_CLIENT_ID" example="...apps.googleusercontent.com" description="Sign in with Google button" />
          <EnvVar name="GOOGLE_CLIENT_SECRET" example="GOCSPX-..." />
        </EnvGroup>

        <EnvGroup title="Other optional">
          <EnvVar name="QDRANT_API_KEY" example="your-qdrant-api-key" description="If Qdrant auth is enabled" />
          <EnvVar name="COHERE_API_KEY" example="..." description="For reranking search results" />
          <EnvVar name="STRIPE_SECRET_KEY" example="sk_..." description="For billing (not required for free self-hosted use)" />
        </EnvGroup>
      </Section>

      {/* GitHub App */}
      <Section id="github-app" title="GitHub App setup">
        <Paragraph>
          Octopus needs a GitHub App to receive webhook events and post review
          comments:
        </Paragraph>
        <ol className="mb-4 list-inside list-decimal space-y-2 text-sm text-[#888]">
          <li>
            Go to <Mono>GitHub Settings → Developer settings → GitHub Apps</Mono>
          </li>
          <li>
            Create a new GitHub App with webhook URL{" "}
            <Mono>https://your-domain/api/github/webhook</Mono>
          </li>
          <li>
            Permissions: <Mono>Pull requests</Mono> (read/write),{" "}
            <Mono>Contents</Mono> (read), <Mono>Checks</Mono> (read/write)
          </li>
          <li>
            Events: <Mono>Pull request</Mono>, <Mono>Pull request review</Mono>
          </li>
          <li>Generate a private key, paste it into <Mono>GITHUB_APP_PRIVATE_KEY</Mono></li>
        </ol>
        <Paragraph>
          This is a separate thing from OAuth login — see{" "}
          <Link href="/docs/oauth-setup" className="text-cyan-400 underline">
            OAuth setup
          </Link>{" "}
          if you also want &quot;Sign in with GitHub&quot;.
        </Paragraph>
      </Section>

      {/* Updates */}
      <Section title="Updating">
        <Paragraph>
          With <Mono>NEXT_PUBLIC_OCTOPUS_SELF_HOSTED=true</Mono> set, an admin
          can visit <Mono>/settings/updates</Mono> in the running app to see
          the current version against the latest GitHub release and get a
          ready-to-paste upgrade snippet:
        </Paragraph>
        <CodeBlock>{`docker compose pull
docker compose up -d
docker compose exec web bunx prisma migrate deploy`}</CodeBlock>
      </Section>

      {/* Production tips */}
      <Section title="Production tips">
        <div className="space-y-3">
          <TipCard
            title="Pin to a release"
            description="Set OCTOPUS_VERSION=0.X.Y in your .env so docker compose pulls a specific image instead of :latest. Aligns with the version surfaced on /settings/updates."
          />
          <TipCard
            title="Use connection pooling"
            description="Use PgBouncer or Supabase pooler for Postgres connections. Next.js serverless functions can exhaust connection limits quickly."
          />
          <TipCard
            title="Secure Qdrant"
            description="Enable API key authentication on Qdrant and restrict network access. Never expose Qdrant directly to the internet."
          />
          <TipCard
            title="Set a spend limit"
            description="Configure per-organization spend limits in the admin panel to control AI costs (no-op when using local Ollama)."
          />
          <TipCard
            title="Enable HTTPS"
            description="Use a reverse proxy (nginx, Caddy, Traefik) with TLS termination. Required for OAuth callbacks."
          />
        </div>
      </Section>

      {/* Alternative paths */}
      <Section title="Alternative — run components separately">
        <Paragraph>
          If you don&apos;t want to use Docker, or you want to point Octopus at
          an existing managed Postgres / Qdrant, run the web app directly. You
          provide:
        </Paragraph>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <RequirementCard title="PostgreSQL 17+" description="Primary database for all application data." />
          <RequirementCard title="Qdrant" description="Vector database for code embeddings and search." />
          <RequirementCard title="Bun 1.3+" description="Runtime for the Next.js application." />
          <RequirementCard title="An AI provider" description="Any of the options listed above — at least one." />
        </div>
        <CodeBlock>{`git clone https://github.com/octopusreview/octopus.git
cd octopus
bun install
# Point DATABASE_URL / QDRANT_URL in .env at your own instances
bun run db:generate
bunx prisma migrate deploy --schema packages/db/prisma/schema.prisma
bun run build
bun run start`}</CodeBlock>
        <Paragraph>
          The Next.js standalone output is at{" "}
          <Mono>apps/web/.next/standalone</Mono>. You can copy that directory to
          a production host and run it under a process manager (systemd, pm2,
          etc.).
        </Paragraph>
      </Section>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-10 scroll-mt-20">
      <h2 className="mb-4 text-xl font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="mb-3 list-inside list-disc space-y-2 pl-2 text-sm leading-relaxed text-[#888]">
      {children}
    </ul>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-[#ccc]">
      {children}
    </code>
  );
}

function ProviderCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="mb-2 flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-medium text-white">{title}</h3>
      </div>
      <p className="mb-3 text-xs text-[#666]">{subtitle}</p>
      {children}
    </div>
  );
}

function RequirementCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <h4 className="text-sm font-medium text-white">{title}</h4>
      <p className="mt-1 text-xs text-[#666]">{description}</p>
    </div>
  );
}

function EnvGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-sm font-medium text-[#999]">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function EnvVar({
  name,
  example,
  required,
  description,
}: {
  name: string;
  example: string;
  required?: boolean;
  description?: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2">
      <div className="flex items-center gap-2">
        <code className="text-xs text-white sm:text-sm">{name}</code>
        {required && (
          <span className="shrink-0 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[#888]">
            required
          </span>
        )}
      </div>
      <span className="mt-1 block text-xs text-[#555]">
        {description || example}
      </span>
    </div>
  );
}

function TipCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <h4 className="text-sm font-medium text-white">{title}</h4>
      <p className="mt-1 text-sm text-[#666]">{description}</p>
    </div>
  );
}
