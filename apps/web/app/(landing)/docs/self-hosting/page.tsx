import { IconServer } from "@tabler/icons-react";
import { CodeBlock } from "./code-block";
import { EnvGenerator } from "./env-generator";

export const metadata = {
  title: "Self-Hosting — Octopus Docs",
  description:
    "Deploy Octopus on your own infrastructure. Docker setup, environment variables, and production configuration.",
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
          <RequirementCard title="OpenAI API Key" description="For generating code embeddings (text-embedding-3-large)." />
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

        <Step number={3} title="Start with Docker Compose">
          <Paragraph>
            The project includes a <Mono>docker-compose.yml</Mono> that runs
            Octopus, PostgreSQL, and Qdrant together. Database and Qdrant URLs
            are automatically configured for Docker&apos;s internal network.
          </Paragraph>
          <CodeBlock title="docker-compose.yml">{`services:
  octopus:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://octopus:octopus@postgres:5432/octopus
      QDRANT_URL: http://qdrant:6333
    depends_on:
      postgres:
        condition: service_healthy
      qdrant:
        condition: service_started
    restart: unless-stopped

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: octopus
      POSTGRES_USER: octopus
      POSTGRES_PASSWORD: octopus
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U octopus"]
      interval: 5s
      timeout: 5s
      retries: 5

  qdrant:
    image: qdrant/qdrant:latest
    volumes:
      - qdrant_data:/qdrant/storage

volumes:
  pgdata:
  qdrant_data:`}</CodeBlock>
        </Step>

        <Step number={4} title="Build and run">
          <CodeBlock>{`docker compose up -d --build`}</CodeBlock>
          <Paragraph>
            First run will build the Octopus image from source — this may take a
            few minutes. Subsequent starts use the cached image.
          </Paragraph>
        </Step>

        <Step number={5} title="Run database migrations">
          <CodeBlock>{`docker compose exec octopus bun run db:migrate`}</CodeBlock>
        </Step>

        <Step number={6} title="Open Octopus">
          <Paragraph>
            Visit <Mono>http://localhost:3000</Mono> to access your self-hosted
            Octopus instance. Create your first account and connect a GitHub
            repository to get started.
          </Paragraph>
        </Step>
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
          <EnvVar name="DATABASE_URL" example="postgresql://octopus:octopus@localhost:5432/octopus" required />
          <EnvVar name="QDRANT_URL" example="http://localhost:6333" required />
          <EnvVar name="BETTER_AUTH_SECRET" example="Auto-generated (64-char hex)" required />
          <EnvVar name="BETTER_AUTH_URL" example="http://localhost:3000" required />
        </EnvGroup>

        <EnvGroup title="Optional">
          <EnvVar name="QDRANT_API_KEY" example="your-qdrant-api-key" description="If Qdrant auth is enabled" />
          <EnvVar name="COHERE_API_KEY" example="..." description="For reranking search results" />
          <EnvVar name="STRIPE_SECRET_KEY" example="sk_..." description="For billing" />
        </EnvGroup>
      </Section>

      {/* Database setup */}
      <Section title="Database Setup">
        <Paragraph>Run migrations to set up the database schema:</Paragraph>
        <CodeBlock>{`# If running from source
bun run db:migrate

# If running with Docker
docker exec -it octopus-web bun run db:migrate`}</CodeBlock>
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
