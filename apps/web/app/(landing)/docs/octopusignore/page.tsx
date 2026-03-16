import { IconFileText } from "@tabler/icons-react";
import { TrackedAnchor } from "@/components/tracked-link";

export const metadata = {
  title: ".octopusignore — Octopus Docs",
  description:
    "Configure .octopusignore to exclude files from AI-powered code review and indexing.",
};

export default function OctopusIgnorePage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconFileText className="size-4" />
          Configuration
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          .octopusignore
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Control which files Octopus reviews and indexes. Same syntax as{" "}
          <Mono>.gitignore</Mono>.
        </p>
      </div>

      {/* Quick start */}
      <Section title="Quick Start">
        <Paragraph>
          Create a <Mono>.octopusignore</Mono> file at the root of your
          repository:
        </Paragraph>
        <CodeBlock
          title=".octopusignore"
          lang="gitignore"
        >{`# Generated documentation
docs/generated/**

# Test fixtures and snapshots
tests/fixtures/**
**/__snapshots__/**

# Vendor / third-party code
third-party/**
vendor/**

# Large data files
*.csv
*.parquet
*.sql`}</CodeBlock>
      </Section>

      {/* Syntax */}
      <Section title="Syntax">
        <Paragraph>
          The file uses the same pattern syntax as <Mono>.gitignore</Mono>,
          powered by the{" "}
          <TrackedAnchor
            href="https://www.npmjs.com/package/ignore"
            target="_blank"
            rel="noopener noreferrer"
            event="docs_external_click"
            eventParams={{ label: "npm_ignore_package", page: "octopusignore" }}
            className="text-white underline decoration-white/30 underline-offset-2 transition-colors hover:decoration-white"
          >ignore</TrackedAnchor>{" "}
          npm package.
        </Paragraph>
        <div className="mb-4 overflow-x-auto rounded-lg border border-white/[0.06]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] text-left">
                <th className="px-4 py-2 font-medium text-[#999]">Pattern</th>
                <th className="px-4 py-2 font-medium text-[#999]">Matches</th>
              </tr>
            </thead>
            <tbody className="text-[#888]">
              <tr className="border-b border-white/[0.04]">
                <td className="px-4 py-2">
                  <Mono>*.csv</Mono>
                </td>
                <td className="px-4 py-2">All CSV files</td>
              </tr>
              <tr className="border-b border-white/[0.04]">
                <td className="px-4 py-2">
                  <Mono>docs/**</Mono>
                </td>
                <td className="px-4 py-2">Everything in the docs directory</td>
              </tr>
              <tr className="border-b border-white/[0.04]">
                <td className="px-4 py-2">
                  <Mono>!docs/API.md</Mono>
                </td>
                <td className="px-4 py-2">
                  Negate — include this file even if parent is ignored
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2">
                  <Mono>**/generated/**</Mono>
                </td>
                <td className="px-4 py-2">
                  Any &quot;generated&quot; folder at any depth
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Paragraph>
          Lines starting with <Mono>#</Mono> are comments. Blank lines are
          ignored.
        </Paragraph>
      </Section>

      {/* How it works */}
      <Section title="How It Works">
        <h3 className="mb-3 text-base font-semibold text-white">
          During Indexing
        </h3>
        <Paragraph>
          When Octopus indexes your repository, it checks for a{" "}
          <Mono>.octopusignore</Mono> file. Matched files are never chunked or
          embedded — they won&apos;t appear in code search results or be used as
          review context.
        </Paragraph>
        <FlowDiagram
          steps={[
            "Repository tree fetched",
            ".octopusignore parsed",
            "Matched files skipped",
            "Remaining files chunked & embedded",
          ]}
        />

        <h3 className="mb-3 mt-6 text-base font-semibold text-white">
          During Review
        </h3>
        <Paragraph>
          When reviewing a PR, Octopus filters out diff sections for ignored
          files. The AI reviewer never sees changes to those files, so it
          won&apos;t comment on them.
        </Paragraph>
        <FlowDiagram
          steps={[
            "PR diff fetched",
            ".octopusignore parsed",
            "Ignored file diffs removed",
            "AI reviews clean diff",
          ]}
        />
      </Section>

      {/* Build artifact detection */}
      <Section title="Build Artifact Detection">
        <Paragraph>
          Octopus automatically detects committed build artifacts and dependency
          folders — even without a <Mono>.octopusignore</Mono> file. If your PR
          includes files from these directories, a critical finding is created:
        </Paragraph>
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            "node_modules/",
            ".next/",
            ".nuxt/",
            "dist/",
            "build/",
            "__pycache__/",
            ".turbo/",
            "coverage/",
            ".svelte-kit/",
            ".output/",
            "vendor/",
          ].map((p) => (
            <span
              key={p}
              className="rounded-md border border-red-500/20 bg-red-500/[0.06] px-2 py-1 text-xs text-red-400"
            >
              {p}
            </span>
          ))}
        </div>
        <Paragraph>
          This automatically triggers <Mono>REQUEST_CHANGES</Mono> on GitHub,
          blocking the PR until the artifacts are removed. This check runs on
          the raw diff before <Mono>.octopusignore</Mono> filtering, so it
          can&apos;t be bypassed.
        </Paragraph>
      </Section>

      {/* Common patterns */}
      <Section title="Common Patterns">
        <CodeBlock title="Monorepo" lang="gitignore">
          {`# Ignore shared configs
.eslintrc.*
prettier.config.*

# Ignore generated types
**/generated/**
**/*.generated.ts

# Ignore migrations (review manually)
**/migrations/**`}
        </CodeBlock>

        <CodeBlock title="Frontend" lang="gitignore">
          {`# Ignore bundled assets
public/assets/**
dist/**

# Ignore lockfiles (too noisy)
pnpm-lock.yaml
package-lock.json
bun.lock`}
        </CodeBlock>

        <CodeBlock title="Data / ML" lang="gitignore">
          {`# Ignore data files
*.csv
*.parquet
*.h5
*.pkl

# Ignore model checkpoints
checkpoints/**
models/**/*.bin`}
        </CodeBlock>
      </Section>

      {/* Providers */}
      <Section title="Provider Support">
        <Paragraph>
          <Mono>.octopusignore</Mono> works with both supported providers:
        </Paragraph>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
            <h4 className="text-sm font-medium text-white">GitHub</h4>
            <p className="mt-1 text-xs text-[#666]">
              Fetched via Contents API from the PR&apos;s base branch.
            </p>
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
            <h4 className="text-sm font-medium text-white">Bitbucket</h4>
            <p className="mt-1 text-xs text-[#666]">
              Fetched via Source endpoint from the PR&apos;s base branch.
            </p>
          </div>
        </div>
        <Paragraph>
          If the file doesn&apos;t exist or can&apos;t be fetched, Octopus
          continues normally without any ignore rules.
        </Paragraph>
      </Section>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
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


function CodeBlock({
  children,
  title,
  lang,
}: {
  children: React.ReactNode;
  title?: string;
  lang?: string;
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-white/[0.06]">
      {title && (
        <div className="border-b border-white/[0.06] bg-white/[0.02] px-4 py-1.5 text-xs text-[#666]">
          {title}
        </div>
      )}
      <pre className="overflow-x-auto bg-[#161616] px-4 py-3">
        <code className="text-sm text-[#ccc]">{children}</code>
      </pre>
    </div>
  );
}

function FlowDiagram({ steps }: { steps: string[] }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="rounded-md border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 text-xs text-[#999]">
            {step}
          </span>
          {i < steps.length - 1 && (
            <span className="text-[#333]">&rarr;</span>
          )}
        </div>
      ))}
    </div>
  );
}
