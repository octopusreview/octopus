import {
  IconInfoCircle,
  IconBrandGithub,
  IconHeart,
  IconCode,
  IconEye,
  IconRocket,
} from "@tabler/icons-react";
import { GetInTouchModal } from "@/components/get-in-touch-modal";
import { TrackedAnchor } from "@/components/tracked-link";

export const metadata = {
  title: "About — Octopus Docs",
  description:
    "Learn the story behind Octopus, an open source AI code review tool built to catch bugs before humans do. Meet the team and see where we are headed.",
  alternates: {
    canonical: "https://octopus-review.ai/docs/about",
  },
};

export default function AboutPage() {
  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconInfoCircle className="size-4" />
          About
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          The Story Behind Octopus
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          An open source code review tool, built by an independent developer.
        </p>
      </div>

      {/* Story */}
      <Section title="Why Octopus?">
        <Paragraph>
          Every developer knows the pain: you open a pull request, and it sits
          there for hours, sometimes days, waiting for someone to review it.
          When the review finally comes, it&apos;s often a quick &quot;LGTM&quot;
          or a surface-level check that misses the real issues.
        </Paragraph>
        <Paragraph>
          Octopus was born from this frustration. The idea was simple: what if
          every PR could get an instant, thorough review that understands
          your codebase, catches real bugs, and never gets tired?
        </Paragraph>
        <Paragraph>
          As an independent developer, I built Octopus to solve a problem I
          faced every day. Not as a side project or a weekend experiment, but as
          a serious tool that teams can rely on. It indexes your entire
          codebase, learns your patterns and architecture, and reviews every
          pull request with deep context awareness.
        </Paragraph>
      </Section>

      {/* Open Source */}
      <Section title="Open Source, Always">
        <Paragraph>
          Octopus is fully open source under the MIT license. This isn&apos;t an
          afterthought. It&apos;s a core principle.
        </Paragraph>
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <ValueCard
            icon={<IconEye className="size-4" />}
            title="Transparency"
            description="Every line of code is public. You can see exactly how your code is processed, what data is stored, and how reviews are generated."
          />
          <ValueCard
            icon={<IconCode className="size-4" />}
            title="No Vendor Lock-in"
            description="Self-host on your own infrastructure. Your code never has to leave your servers. Switch providers or fork the project at any time."
          />
          <ValueCard
            icon={<IconHeart className="size-4" />}
            title="Community Driven"
            description="Bug reports, feature requests, and pull requests are all welcome. The best ideas come from the people who use the tool every day."
          />
          <ValueCard
            icon={<IconRocket className="size-4" />}
            title="Free Forever"
            description="The core product is free and always will be. No artificial limitations, no feature gates for essential functionality."
          />
        </div>
      </Section>

      {/* Tech Stack */}
      <Section title="Built With">
        <Paragraph>
          Octopus is built on modern, battle-tested technologies:
        </Paragraph>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <TechCard name="Next.js" detail="App Router, React 19" />
          <TechCard name="Prisma" detail="PostgreSQL ORM" />
          <TechCard name="Qdrant" detail="Vector search" />
          <TechCard name="Claude & OpenAI" detail="AI review engine" />
          <TechCard name="Tailwind CSS" detail="Styling" />
          <TechCard name="TypeScript" detail="End-to-end type safety" />
        </div>
        <Paragraph>
          The codebase is a TypeScript monorepo managed with Turborepo. The web
          app, CLI, database layer, and shared configs all live in one
          repository, making it easy to contribute and self-host.
        </Paragraph>
      </Section>

      {/* Vision */}
      <Section title="Where We&apos;re Going">
        <Paragraph>
          Octopus is actively developed and evolving. Here&apos;s what&apos;s on the
          horizon:
        </Paragraph>
        <ul className="mb-4 space-y-2">
          <VisionItem text="Deeper integration with more Git providers beyond GitHub and Bitbucket" />
          <VisionItem text="Smarter review engine that learns from your team's feedback over time" />
          <VisionItem text="Expanded CLI capabilities for CI/CD pipeline integration" />
          <VisionItem text="Plugin system for custom review rules and checks" />
        </ul>
        <Paragraph>
          Have an idea? Open an issue on GitHub. The roadmap is shaped by the
          community.
        </Paragraph>
      </Section>

      {/* Developer */}
      <Section title="The Developer">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
          <div className="flex items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-full bg-white/[0.06] text-[#888]">
              <IconCode className="size-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">
                S. Ferit Arslan
              </h3>
              <p className="text-sm text-[#666]">Independent Developer</p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-[#888]">
            Building Octopus as an independent developer. Designing,
            coding, and shipping every feature from scratch. Passionate about
            developer tools and making code review less painful for everyone.
          </p>
          <div className="mt-4">
            <TrackedAnchor
              href="https://github.com/redoh"
              target="_blank"
              rel="noopener noreferrer"
              event="docs_external_click"
              eventParams={{ label: "developer_github", page: "about" }}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-4 py-2 text-sm text-[#888] transition-colors hover:border-white/[0.15] hover:text-white"
            >
              <IconBrandGithub className="size-4" />
              @redoh
            </TrackedAnchor>
          </div>
        </div>
      </Section>
      {/* Contact */}
      <Section title="Get in Touch">
        <Paragraph>
          Have a question, partnership inquiry, or just want to say hi?
        </Paragraph>
        <GetInTouchModal className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] px-4 py-2 text-sm text-[#888] transition-colors hover:border-white/[0.15] hover:text-white">
          Get in Touch
        </GetInTouchModal>
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
  return (
    <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>
  );
}

function ValueCard({
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

function TechCard({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-center">
      <div className="text-sm font-medium text-white">{name}</div>
      <div className="mt-0.5 text-xs text-[#555]">{detail}</div>
    </div>
  );
}

function VisionItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-sm text-[#888]">
      <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-white/20" />
      {text}
    </li>
  );
}
