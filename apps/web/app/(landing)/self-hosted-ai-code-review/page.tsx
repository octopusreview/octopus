import type { Metadata } from "next";
import Link from "@/components/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { LandingFooter } from "@/components/landing-footer";
import { LandingMobileNav } from "@/components/landing-mobile-nav";
import { LandingDesktopNav } from "@/components/landing-desktop-nav";

const title = "Self-hosted AI code review with Docker";
const description =
  "Run Octopus AI code review on your own servers with Docker. See where your code and model calls go, what you need, what it costs and how to start.";
const url = "https://octopus-review.ai/self-hosted-ai-code-review";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, url, type: "website" },
  alternates: { canonical: url },
};

const linkClass = "text-white underline decoration-white/30 underline-offset-2 hover:decoration-white";
const codeClass = "rounded bg-white/[0.06] px-1.5 py-0.5 text-sm text-[#ccc] [overflow-wrap:anywhere]";

export default async function SelfHostedAiCodeReviewPage() {
  const session = await auth.api.getSession({ headers: await headers() }).catch(() => null);

  return (
    <div className="dark relative min-h-screen bg-background text-[#a0a0a0] selection:bg-white/20">
      <LandingMobileNav isLoggedIn={!!session} />
      <LandingDesktopNav isLoggedIn={!!session} />

      <section className="relative z-10 px-6 pt-32 pb-16 md:px-8 md:pt-40 md:pb-20">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl md:text-6xl">
            Self-hosted AI code review
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-[#888]">
            Octopus is an AI code review service for pull requests on GitHub,
            GitLab, Bitbucket and Forgejo. It indexes your whole repository, so
            each review has context beyond the diff. Findings are posted as
            inline comments with a severity rating. You can run it on your own
            infrastructure with Docker Compose. Octopus is source-available
            under a Modified MIT licence.
          </p>
        </div>
      </section>

      <section className="relative z-10 px-6 pb-20 md:px-8">
        <div className="mx-auto max-w-3xl space-y-12">
          <Section title="Where your code and model calls go">
            <P>
              When you self-host, every stage of a review runs on your
              infrastructure, from the webhook to the posted comments.
              Self-hosted Octopus stores everything, including the code index,
              in your own PostgreSQL, Qdrant and object storage.
            </P>
            <P>
              The model calls go to the AI services you configure. For each
              review, Octopus sends the diff and the relevant parts of your
              repository to that provider, using your own API key. The default
              setup also sends code to OpenAI to create the index embeddings.
            </P>
            <P>
              Self-hosting on its own does not keep code inside your network. If
              code must stay there, run the review model and embeddings on your
              own hardware with the optional Ollama setup, which needs no cloud
              API keys.
            </P>
            <P>
              Octopus also calls your git host&apos;s API to read code and post
              comments. The{" "}
              <Link href="/docs/security-overview" className={linkClass}>
                security overview
              </Link>{" "}
              lists the outbound calls.
            </P>
          </Section>

          <Section title="What you need to run it">
            <P>
              The recommended setup is the prebuilt Docker image. It needs no
              build step and starts the app, PostgreSQL and Qdrant together. You
              also need a checkout of the repository, because the database
              migrations run from it.
            </P>
            <P>
              Unless you run Ollama, you need an OpenAI key for embeddings and a
              key for the model that writes the reviews. The docs name Anthropic
              Claude or OpenAI for reviews, with Google Gemini, xAI Grok,
              Alibaba Cloud Qwen and OpenRouter as optional settings.
            </P>
            <P>
              For production, add a reverse proxy with TLS, because OAuth
              callbacks require HTTPS. GitHub repositories also need your own
              GitHub App.
            </P>
          </Section>

          <Section title="What it costs">
            <P>
              Octopus charges nothing for self-hosting. There are no credits and
              no platform fees. You pay your AI provider directly for the tokens
              you use, and you run the servers yourself.
            </P>
          </Section>

          <Section title="How it differs from Octopus Cloud">
            <P>
              The review stages are the same in both. Octopus Cloud runs them on
              managed infrastructure and bills AI usage at 2x the
              provider&apos;s list price, with no other fees. You can also bring
              your own API keys to Cloud and pay the provider instead. When you
              self-host, you run the service and control retention and backups.
              Self-hosted Octopus can also connect directly to Forgejo on a
              private LAN or VPN.
            </P>
          </Section>

          <Section title="Get started">
            <ol className="mt-4 list-outside list-decimal space-y-2 pl-5 text-base leading-relaxed text-[#a0a0a0]">
              <li>Clone the repository from GitHub.</li>
              <li>
                Create a <code className={codeClass}>.env</code> file with the
                generator in the docs, then add your API keys.
              </li>
              <li>
                Pull the image and start it:{" "}
                <code className={codeClass}>docker compose -f docker-compose.selfhost.yml up -d</code>.
              </li>
              <li>Run the database migrations from your checkout.</li>
              <li>
                Open <code className={codeClass}>http://localhost:43300</code>,
                create the first account and connect a repository.
              </li>
            </ol>
            <P>
              The{" "}
              <Link href="/docs/self-hosting" className={linkClass}>
                self-hosting docs
              </Link>{" "}
              cover each step, plus upgrades and rollbacks.
            </P>
          </Section>

          <Section title="When Octopus Cloud is the better choice">
            <P>
              When you self-host, you apply upgrades and migrations, secure
              Qdrant, manage backups and keep HTTPS working.
            </P>
            <P>
              If you plan to use an external AI provider anyway, that provider
              receives your code in both setups. In that case Cloud saves you
              the operations work. Cloud starts with free credits and no
              subscription, and the GitHub App reviews every pull request
              automatically.
            </P>
            <P>
              The trade is that Octopus Cloud processes your code on our
              infrastructure. Diffs are discarded when the review completes. The
              index is kept while the repository is connected and deleted within
              24 hours of disconnecting.
            </P>
          </Section>
        </div>
      </section>

      <section className="relative z-10 px-6 pb-24 md:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Next steps
          </h2>
          <ul className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <li>
              <Link
                href="/docs/self-hosting"
                className="inline-flex items-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-semibold text-black transition-all hover:bg-[#e0e0e0]"
              >
                Read the self-hosting docs
              </Link>
            </li>
            <li>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full border border-white/[0.1] px-8 py-3 text-sm font-medium text-[#999] transition-all hover:border-white/[0.2] hover:text-white"
              >
                Sign up for Octopus Cloud
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-base leading-relaxed text-[#a0a0a0]">{children}</p>;
}
