import { IconServer } from "@tabler/icons-react";
import { CodeBlock } from "./code-block";
import { EnvGenerator } from "./env-generator";

export const metadata = {
  title: "Self-Hosting — Octopus Docs",
  description:
    "Deploy Octopus on your own infrastructure with Docker. Full setup guide, environment variables, and a production checklist for air-gapped deployments.",
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

      {/* Prerequisites */}
      <Section title="Prerequisites">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <RequirementCard title="PostgreSQL 15+" description="Primary database for all application data." />
          <RequirementCard title="Qdrant" description="Vector database for code embeddings and search." />
          <RequirementCard title="Node.js 20+ or Bun" description="Runtime for the Next.js application." />
          <RequirementCard title="OpenAI API key (default embeddings)" description="Used for code embeddings (text-embedding-3-large) — or run fully local via Ollama (see the all-local section)." />
        </div>
        <Paragraph>
          You&apos;ll also need an AI provider key (Anthropic Claude or OpenAI)
          for the review engine.
        </Paragraph>
      </Section>

      {/* Quick start */}
      <Section title="Quick Start with Docker">
        <Step number={1} title="Clone the repository">
          <CodeBlock>{`git clone https://github.com/octopusreview/octopus.git
cd octopus`}</CodeBlock>
        </Step>

        <Step number={2} title="Create your .env file">
          <Paragraph>
            Use the <a href="#environment-variables" className="text-white underline underline-offset-2 hover:text-[#ccc]">environment generator below</a> to
            create a <Mono>.env</Mono> file with a pre-generated auth secret,
            then save it to the project root. Fill in your API keys before
            continuing.
          </Paragraph>
        </Step>

        <Step number={3} title="Review the bundled docker-compose.yml">
          <Paragraph>
            The repository&apos;s <Mono>docker-compose.yml</Mono> is the source of
            truth — it runs the <Mono>web</Mono> service, PostgreSQL, and Qdrant
            together and wires the database and Qdrant URLs for Docker&apos;s
            internal network. It publishes the app on{" "}
            <Mono>43300:3000</Mono>, uses <Mono>postgres:17-alpine</Mono> (host
            port <Mono>43332</Mono>) and <Mono>qdrant/qdrant:v1.17.0</Mono> (host
            port <Mono>43333</Mono>), and sets{" "}
            <Mono>ENABLE_REVIEW_WORKERS=true</Mono>. There is nothing to copy or
            edit here — use the file as-is.
          </Paragraph>
        </Step>

        <Step number={4} title="Build and run">
          <CodeBlock>{`docker compose build --build-arg NEXT_PUBLIC_OCTOPUS_SELF_HOSTED=true
docker compose up -d`}</CodeBlock>
          <Paragraph>
            First run will build the Octopus image from source — this may take a
            few minutes. Subsequent starts use the cached image.
          </Paragraph>
          <Paragraph>
            Without <Mono>NEXT_PUBLIC_OCTOPUS_SELF_HOSTED=true</Mono> baked in at
            build time, email/password sign-in is compiled out and the first-boot
            admin cannot log in.
          </Paragraph>
        </Step>

        <Step number={5} title="Run database migrations">
          <Paragraph>
            Migrations run from the repo checkout — the runtime image doesn&apos;t
            ship the Prisma CLI or migration files.
          </Paragraph>
          <CodeBlock>{`cd packages/db
DATABASE_URL=postgresql://octopus:octopus@localhost:43332/octopus bunx prisma migrate deploy`}</CodeBlock>
        </Step>

        <Step number={6} title="Open Octopus">
          <Paragraph>
            Visit <Mono>http://localhost:43300</Mono> to access your self-hosted
            Octopus instance. Create your first account and connect a GitHub
            repository to get started.
          </Paragraph>
        </Step>
      </Section>

      <Section title="All-local with Ollama (optional)">
        <Paragraph>
          To run Octopus with no cloud API keys — both the review LLM and code
          embeddings served on your own hardware — start the optional Ollama
          overlay alongside the base compose file. It adds an{" "}
          <Mono>ollama</Mono> service and points the app at it.
        </Paragraph>
        <CodeBlock>{`docker compose -f docker-compose.yml -f docker-compose.ollama.yml up -d`}</CodeBlock>
        <Paragraph>
          Then pull at least one chat model and the embedding model — from the
          UI (Settings → Models → Local models) or the shell:
        </Paragraph>
        <CodeBlock>{`docker compose exec ollama ollama pull qwen2.5-coder:7b
docker compose exec ollama ollama pull nomic-embed-text`}</CodeBlock>
        <Paragraph>
          To also use Ollama for embeddings, set{" "}
          <Mono>OCTOPUS_EMBED_PROVIDER=ollama</Mono>,{" "}
          <Mono>OCTOPUS_EMBED_MODEL=nomic-embed-text</Mono>, and{" "}
          <Mono>OCTOPUS_EMBED_DIM=768</Mono> in your <Mono>.env</Mono> before
          first indexing — switching providers afterward requires a re-index
          since different models produce non-comparable vectors. Ollama runs
          CPU-only by default; see the overlay file for enabling NVIDIA GPU
          acceleration.
        </Paragraph>
      </Section>

      {/* Environment variables */}
      <Section id="environment-variables" title="Environment Variables">
        <Paragraph>
          Generate a default <Mono>.env</Mono> file with pre-filled defaults for
          database, Qdrant, and auth. A unique{" "}
          <Mono>BETTER_AUTH_SECRET</Mono> is generated automatically.
          Fill in the remaining values (API keys, GitHub App, etc.) before
          starting.
        </Paragraph>

        <EnvGenerator />

        <EnvGroup title="Required — fill these in">
          <EnvVar name="OPENAI_API_KEY" example="sk-..." required description="Used for embeddings" />
          <EnvVar name="ANTHROPIC_API_KEY" example="sk-ant-..." description="Claude for reviews" />
          <EnvVar name="GITHUB_APP_ID" example="123456" required />
          <EnvVar name="GITHUB_APP_PRIVATE_KEY" example="-----BEGIN RSA..." required />
          <EnvVar name="GITHUB_WEBHOOK_SECRET" example="whsec_..." required />
          <EnvVar name="GITHUB_CLIENT_ID" example="Iv1.abc123" />
          <EnvVar name="GITHUB_CLIENT_SECRET" example="secret" />
        </EnvGroup>

        <EnvGroup title="Pre-filled defaults">
          <EnvVar name="DATABASE_URL" example="postgresql://octopus:octopus@localhost:43332/octopus" required />
          <EnvVar name="QDRANT_URL" example="http://localhost:43333" required />
          <EnvVar name="BETTER_AUTH_SECRET" example="Auto-generated (64-char hex)" required />
          <EnvVar name="BETTER_AUTH_URL" example="http://localhost:43300" required />
        </EnvGroup>

        <EnvGroup title="Optional">
          <EnvVar name="GOOGLE_API_KEY" example="AIza..." description="Gemini models" />
          <EnvVar name="GROK_API_KEY" example="xai-..." description="xAI Grok models" />
          <EnvVar name="OPENROUTER_API_KEY" example="sk-or-..." description="OpenRouter — many model vendors via one key" />
          <EnvVar name="OLLAMA_SERVER_URL" example="http://localhost:11434" description="Self-hosted Ollama (ollama: model ids); optional OLLAMA_USERNAME / OLLAMA_PASSWORD for a proxied host" />
          <EnvVar name="ACP_BASE_URL" example="https://acpx.example.com" description="ACPX gateway (acp: model ids); set together with ACP_API_KEY" />
          <EnvVar name="OPENCODE_BASE_URL" example="https://opencode.example.com" description="OpenCode gateway (opencode: model ids); set together with OPENCODE_API_KEY" />
          <EnvVar name="QDRANT_API_KEY" example="your-qdrant-api-key" description="If Qdrant auth is enabled" />
          <EnvVar name="COHERE_API_KEY" example="..." description="For reranking search results" />
          <EnvVar name="STRIPE_SECRET_KEY" example="sk_..." description="For billing" />
        </EnvGroup>
      </Section>

      {/* Database setup */}
      <Section title="Database Setup">
        <Paragraph>
          Run migrations to set up the database schema. Migrations run from the
          repo checkout — the runtime image doesn&apos;t ship the Prisma CLI or
          migration files.
        </Paragraph>
        <CodeBlock>{`cd packages/db
DATABASE_URL=postgresql://octopus:octopus@localhost:43332/octopus bunx prisma migrate deploy`}</CodeBlock>
      </Section>

      {/* GitHub App */}
      <Section title="GitHub App Setup">
        <Paragraph>
          To receive webhook events, you need to create a GitHub App:
        </Paragraph>
        <ol className="mb-4 list-inside list-decimal space-y-2 text-sm text-[#888]">
          <li>
            Go to <Mono>GitHub Settings &rarr; Developer settings &rarr; GitHub Apps</Mono>
          </li>
          <li>Create a new GitHub App with a webhook URL pointing to <Mono>https://your-domain/api/github/webhook</Mono></li>
          <li>
            Enable permissions: <Mono>Pull requests</Mono> (read/write),{" "}
            <Mono>Contents</Mono> (read), <Mono>Checks</Mono> (read/write)
          </li>
          <li>Subscribe to events: <Mono>Pull request</Mono>, <Mono>Pull request review</Mono></li>
          <li>Generate a private key and add it to your environment</li>
        </ol>
      </Section>

      {/* Production tips */}
      <Section title="Production Tips">
        <div className="space-y-3">
          <TipCard
            title="Use connection pooling"
            description="Use PgBouncer or Supabase pooler for PostgreSQL connections. Next.js serverless functions can exhaust connection limits quickly."
          />
          <TipCard
            title="Secure Qdrant"
            description="Enable API key authentication on Qdrant and restrict network access. Never expose Qdrant directly to the internet."
          />
          <TipCard
            title="Set a spend limit"
            description="Configure per-organization spend limits in the admin panel to control AI costs."
          />
          <TipCard
            title="Enable HTTPS"
            description="Use a reverse proxy (nginx, Caddy, Traefik) with TLS termination. Required for OAuth callbacks."
          />
        </div>
      </Section>

      {/* From source */}
      <Section title="Running without Docker">
        <Paragraph>
          If you prefer to run Octopus directly, you&apos;ll need PostgreSQL,
          Qdrant, and Bun installed on your machine. Create your{" "}
          <Mono>.env</Mono> file first using the generator above.
        </Paragraph>
        <CodeBlock>{`git clone https://github.com/octopusreview/octopus.git
cd octopus
bun install
bun run db:generate
bun run db:migrate
bun run build
bun run start`}</CodeBlock>
        <Paragraph>
          The standalone output is at{" "}
          <Mono>apps/web/.next/standalone</Mono>. You can deploy this directory
          directly.
        </Paragraph>
      </Section>

      {/* Upgrading & rolling back */}
      <Section title="Upgrading & rolling back">
        <Paragraph>
          Check out a specific release tag in production rather than tracking{" "}
          <Mono>master</Mono> — that is what turns a rollback into re-checking-out
          the previous tag. The published GHCR image is private, so self-hosters
          build the image from source rather than pulling it.
        </Paragraph>

        <Step number={1} title="Upgrade">
          <Paragraph>
            Pull the new code, rebuild the image, restart, then apply migrations.
            Octopus migrations are <strong>additive (expand-only)</strong> and
            therefore backward-compatible — the previous image keeps working
            against the new schema, which is exactly what makes the rollback
            below safe.
          </Paragraph>
          <CodeBlock>{`git pull                       # or: git fetch --tags && git checkout vX.Y.Z
docker compose build --build-arg NEXT_PUBLIC_OCTOPUS_SELF_HOSTED=true
# migrate FIRST (expand-only, safe under the still-running old version) ...
cd packages/db && DATABASE_URL=postgresql://octopus:octopus@localhost:43332/octopus bunx prisma migrate deploy && cd ../..
# ... then start the new version
docker compose up -d`}</CodeBlock>
        </Step>

        <Step number={2} title="Verify before sending traffic">
          <Paragraph>
            Confirm the app is healthy before pointing users at the new version:
          </Paragraph>
          <CodeBlock>{`curl -fsS http://localhost:43300/api/health    # expect {"status":"ok"}
curl -fsS http://localhost:43300/api/version   # confirm the new version`}</CodeBlock>
        </Step>

        <Step number={3} title="Roll back (if needed)">
          <Paragraph>
            Check out the <strong>previous</strong> release tag, rebuild, and
            restart. <strong>Do not roll back the database.</strong> Because every
            migration is additive, the older image runs fine against the newer
            schema, so you keep all data and avoid a risky down-migration.
          </Paragraph>
          <CodeBlock>{`git checkout vX.Y.Z            # the previous release tag
docker compose build --build-arg NEXT_PUBLIC_OCTOPUS_SELF_HOSTED=true
docker compose up -d`}</CodeBlock>
        </Step>

        <Paragraph>
          This expand-only discipline is enforced in CI: the{" "}
          <Mono>migrate-check</Mono> workflow fails any change whose migration
          drops or rewrites a table/column (without an explicit override), so the
          &quot;roll back the code, keep the database&quot; path stays safe from
          one release to the next. The same property is what lets a hosted,
          blue-green / rolling deploy run both versions against a single shared
          database during cutover.
        </Paragraph>
      </Section>

      {/* Blue-green with a Cloudflare load balancer */}
      <Section title="Zero-downtime cutover (Cloudflare LB)">
        <Paragraph>
          For zero-downtime deploys, front two legs (e.g. your datacenter and a
          cloud VM) with a Cloudflare Load Balancer. Both legs are{" "}
          <strong>stateless app containers</strong> pulling the same image and
          pointing at <strong>one shared database</strong> (and Qdrant/Redis) —
          Octopus is safe to run as multiple app instances on one DB, since
          pg-boss coordinates workers and dedupes the scheduled jobs across them.
        </Paragraph>
        <ul className="mb-3 list-inside list-disc space-y-1.5 text-sm text-[#888]">
          <li>
            Create a Cloudflare LB with one <Mono>pool</Mono> per leg and a{" "}
            <Mono>monitor</Mono> that probes <Mono>/api/health</Mono> (it returns{" "}
            <Mono>200</Mono> only when the leg can reach the database, else{" "}
            <Mono>503</Mono>). Cloudflare drops an unhealthy leg from rotation
            automatically.
          </li>
          <li>
            Deploy the new tag to the <strong>idle</strong> leg, let its{" "}
            <Mono>/api/health</Mono> go green, then point the LB&apos;s default
            pool at it. Keep the previous leg running — rollback is an instant
            flip back.
          </li>
          <li>
            The included <Mono>deploy</Mono> workflow automates this
            (deploy &rarr; health-gate &rarr; Cloudflare cutover &rarr; verify);
            set the documented Cloudflare token / LB &amp; pool IDs as repo
            secrets and variables.
          </li>
        </ul>
        <Paragraph>
          Note: this is zero-downtime <em>deploys</em> against one shared DB. True
          survive-a-whole-site-outage HA additionally needs that database
          (and Qdrant) replicated across both legs with failover — a separate,
          larger piece of work.
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

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-[#ccc]">
      {children}
    </code>
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

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-semibold text-white">
          {number}
        </span>
        <h3 className="text-sm font-medium text-white">{title}</h3>
      </div>
      <div className="ml-8">{children}</div>
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
