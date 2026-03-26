import fs from "node:fs";
import path from "node:path";
import {
  IconWand,
  IconGitPullRequest,
  IconCategory,
  IconGitBranch,
  IconReportAnalytics,
  IconArrowsSplit,
  IconBugOff,
} from "@tabler/icons-react";
import { SkillCodeBlock } from "./skill-code-block";
import { SkillCard } from "./skill-card";

export const metadata = {
  title: "Skills | Octopus Docs",
  description:
    "AI-powered automation skills that streamline your development workflow, from code review to shipping PRs, fully automated.",
};

function readSkillFile(filename: string): string {
  const filePath = path.join(process.cwd(), "public", "skills", filename);
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    console.error(`[skills] Could not read skill file: ${filePath}`);
    return "";
  }
}

export default function SkillsPage() {
  const octopusFixMd = readSkillFile("octopus-fix.md");
  const splitAndShipMd = readSkillFile("split-and-ship.md");

  return (
    <article className="max-w-3xl">
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#555]">
          <IconWand className="size-4" />
          Skills
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
          Automate Your Entire Review
        </h1>
        <p className="mt-3 text-lg text-[#888]">
          Skills are reusable AI-powered workflows that handle the repetitive
          parts of your development cycle, categorize changes, create issues,
          open PRs, and ship code, all fully automated.
        </p>
      </div>

      {/* What are Skills */}
      <Section title="What are Skills?">
        <Paragraph>
          Each skill encapsulates a multi-step workflow that would otherwise
          require manual effort, context switching, and coordination across
          tools. Instead of sorting through diffs, writing commit messages, and
          opening PRs one by one. Let AI handle it.
        </Paragraph>
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <FeatureCard
            icon={<IconCategory className="size-4" />}
            title="Smart Categorization"
            description="AI analyzes your changes and groups them into logical, shippable units."
          />
          <FeatureCard
            icon={<IconGitPullRequest className="size-4" />}
            title="Auto PR Creation"
            description="Each category becomes a separate PR with proper branching and issue linking."
          />
          <FeatureCard
            icon={<IconReportAnalytics className="size-4" />}
            title="Full Traceability"
            description="Every PR references a GitHub issue. Nothing gets lost in the process."
          />
        </div>
      </Section>

      {/* Skills */}
      <Section title="Available Skills">
        {/* Skill: Split and Ship */}
        <SkillCard
          icon={<IconArrowsSplit className="size-5" />}
          title="Split and Ship"
          subtitle="Analyze, categorize, and ship all your changes as separate PRs"
          filename="split-and-ship.md"
          content={splitAndShipMd}
        >
          <Paragraph>
            You&apos;ve been working on multiple things at once. Your working
            tree has a mix of features, fixes, and refactors. Instead of
            manually sorting, committing, and opening PRs one by one, Split and
            Ship handles the entire flow automatically.
          </Paragraph>

          <SubHeading>How it works</SubHeading>
          <div className="mb-6 space-y-3">
            <StepCard
              step={1}
              title="Analyze"
              description="Scans git status, diffs, and untracked files to understand every change in your working tree."
            />
            <StepCard
              step={2}
              title="Categorize"
              description="Groups files into logical, independently shippable units (features, bug fixes, refactors) and presents them for your approval."
            />
            <StepCard
              step={3}
              title="Create Issues"
              description="Opens a GitHub issue for each category with a clear description and appropriate labels."
            />
            <StepCard
              step={4}
              title="Ship PRs"
              description="For each category: creates a branch, commits only the relevant files, pushes, and opens a PR that closes the corresponding issue."
            />
            <StepCard
              step={5}
              title="Report"
              description="Prints a summary table with issue numbers, branch names, PR URLs, and file counts."
            />
          </div>

          <SubHeading>Branch naming</SubHeading>
          <Paragraph>
            Follows conventional naming:{" "}
            <Code>{"<type>/<short-description>"}</Code> where type is{" "}
            <Code>feat</Code>, <Code>fix</Code>, <Code>refactor</Code>,{" "}
            <Code>chore</Code>, or <Code>docs</Code>.
          </Paragraph>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <BranchExample name="feat/multi-prompt-field" />
            <BranchExample name="fix/credit-calculation" />
            <BranchExample name="refactor/provider-factory" />
          </div>

          <SubHeading>Rules</SubHeading>
          <ul className="mb-6 space-y-2">
            <RuleItem text="Each file belongs to exactly one category, no overlaps." />
            <RuleItem text="Categories are confirmed by you before any issues or PRs are created." />
            <RuleItem text="Every PR references and closes its corresponding GitHub issue." />
            <RuleItem text="If a file logically belongs to multiple categories, you'll be asked to decide." />
          </ul>

          <SubHeading>Skill file</SubHeading>
          <Paragraph>
            Copy or download the markdown file below and add it to your project
            to use this skill with Claude Code.
          </Paragraph>
          <SkillCodeBlock
            title="split-and-ship.md"
            filename="split-and-ship.md"
          >
            {splitAndShipMd}
          </SkillCodeBlock>
        </SkillCard>

        {/* Skill: Octopus Fix */}
        <SkillCard
          icon={<IconBugOff className="size-5" />}
          title="Octopus Fix"
          subtitle="Check open PRs for review comments, apply fixes, and push updates"
          filename="octopus-fix.md"
          content={octopusFixMd}
        >
          <Paragraph>
            After Octopus reviews your PRs, this skill checks all open PRs for
            pending review comments and requested changes. It analyzes the
            feedback, applies the necessary fixes, and pushes the updates
            automatically.
          </Paragraph>

          <SubHeading>How it works</SubHeading>
          <div className="mb-6 space-y-3">
            <StepCard
              step={1}
              title="Discover Open PRs"
              description="Lists all open PRs authored by you and checks their review status."
            />
            <StepCard
              step={2}
              title="Check Reviews"
              description="Fetches review comments, inline suggestions, and conversation threads for each PR. Automatically skips PRs where the latest bot review shows 0 findings."
            />
            <StepCard
              step={3}
              title="Present Summary"
              description="Shows each review comment with the proposed fix and asks for your confirmation before making changes."
            />
            <StepCard
              step={4}
              title="Apply Fixes"
              description="Checks out each PR branch, applies the minimal changes to address feedback, commits, and pushes."
            />
            <StepCard
              step={5}
              title="Report"
              description="Prints a summary table with PR numbers, comments addressed, and what was changed."
            />
          </div>

          <SubHeading>Review handling</SubHeading>
          <ul className="mb-6 space-y-2">
            <RuleItem text="PRs where the latest bot review shows 0 findings are automatically skipped — nothing to fix." />
            <RuleItem text="Valid suggestions get a thumbs up reaction and are fixed with a reply describing the change." />
            <RuleItem text="False positives get a thumbs down reaction with an explanation." />
            <RuleItem text="Review threads are resolved after fixes are applied." />
            <RuleItem text="A final PR comment tags @octopus to notify that updates are ready." />
          </ul>

          <SubHeading>Rules</SubHeading>
          <ul className="mb-6 space-y-2">
            <RuleItem text="Never force-push. Always use regular git push." />
            <RuleItem text="Always show proposed fixes and get confirmation before committing." />
            <RuleItem text="Make minimal changes. Only fix what the reviewer asked for." />
            <RuleItem text="If a review comment is unclear, ask the user rather than guessing." />
            <RuleItem text="If there are merge conflicts, inform the user and stop." />
            <RuleItem text="Preserve existing commit history. No squash, rebase, or amend." />
          </ul>

          <SubHeading>Skill file</SubHeading>
          <Paragraph>
            Copy or download the markdown file below and add it to your project
            to use this skill with Claude Code.
          </Paragraph>
          <SkillCodeBlock
            title="octopus-fix.md"
            filename="octopus-fix.md"
          >
            {octopusFixMd}
          </SkillCodeBlock>
        </SkillCard>
      </Section>

      {/* More skills coming */}
      <Section title="More Skills Coming Soon">
        <Paragraph>
          We&apos;re building more automation skills to cover the entire
          development lifecycle, from automated test generation to release
          management. Have an idea for a skill? Open an issue on GitHub.
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
  return (
    <p className="mb-3 text-sm leading-relaxed text-[#888]">{children}</p>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-[0.15em] text-[#555]">
      {children}
    </h3>
  );
}

function FeatureCard({
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

function StepCard({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-xs font-bold text-white">
        {step}
      </div>
      <div>
        <div className="text-sm font-medium text-white">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[#666]">
          {description}
        </div>
      </div>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-xs text-white">
      {children}
    </code>
  );
}

function BranchExample({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
      <IconGitBranch className="size-3.5 shrink-0 text-[#555]" />
      <code className="text-xs text-[#888]">{name}</code>
    </div>
  );
}

function RuleItem({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2 text-sm text-[#888]">
      <span className="mt-1.5 block size-1.5 shrink-0 rounded-full bg-white/20" />
      {text}
    </li>
  );
}
