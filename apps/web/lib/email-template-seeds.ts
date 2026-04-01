import { prisma } from "@octopus/db";

interface TemplateSeed {
  slug: string;
  name: string;
  category: "transactional" | "notification" | "marketing";
  fromType: "personal" | "system";
  subject: string;
  body: string;
  buttonText?: string;
  buttonUrl?: string;
  signatureName?: string;
  signatureTitle?: string;
  variables: string[];
}

// Resolved at seed time from env
function getFromConfig(type: "personal" | "system") {
  if (type === "personal") {
    return {
      fromName: process.env.EMAIL_PERSONAL_FROM_NAME || "Octopus",
      fromEmail: process.env.EMAIL_PERSONAL_FROM_EMAIL || process.env.EMAIL_SYSTEM_FROM_EMAIL || "hello@example.com",
    };
  }
  return {
    fromName: process.env.EMAIL_SYSTEM_FROM_NAME || "Octopus",
    fromEmail: process.env.EMAIL_SYSTEM_FROM_EMAIL || "notifications@example.com",
  };
}

const templates: TemplateSeed[] = [
  {
    slug: "welcome",
    name: "Welcome Email",
    category: "transactional",
    fromType: "personal",
    subject: "Welcome to Octopus! Let's review your first PR",
    body: `Hey {{firstName}},

Welcome to Octopus, AI-powered code reviews that actually catch real issues.

One thing to know: Octopus gets smarter the more it knows your codebase. Your first review is a starting point.

A few tips to get the most out of it:

- Connect your GitHub or Bitbucket repo and Octopus will start reviewing PRs automatically
- Add knowledge docs (style guides, architecture decisions) to make reviews more relevant
- React to review comments on GitHub/Bitbucket with thumbs up/down so Octopus learns from your team's preferences

Reply anytime, this goes straight to my inbox :)`,
    buttonText: "Connect your first repo",
    buttonUrl: "{{appUrl}}/dashboard",
    variables: ["firstName", "appUrl"],
  },
  {
    slug: "magic-link",
    name: "Magic Link (Sign In)",
    category: "transactional",
    fromType: "system",
    subject: "Sign in to Octopus",
    body: `Hey,

Click the button below to sign in to Octopus. This link expires in 10 minutes.

If you didn't request this, you can safely ignore this email.`,
    buttonText: "Sign in to Octopus",
    buttonUrl: "{{magicLinkUrl}}",
    variables: ["magicLinkUrl"],
  },
  {
    slug: "invitation",
    name: "Organization Invitation",
    category: "transactional",
    fromType: "personal",
    subject: "You've been invited to join {{organizationName}} on Octopus",
    body: `Hey,

**{{inviterName}}** has invited you to join **{{organizationName}}** as a **{{role}}**.

This invitation expires in 7 days. If you don't want to join, you can ignore this email.`,
    buttonText: "Accept Invitation",
    buttonUrl: "{{acceptUrl}}",
    variables: ["inviterName", "organizationName", "role", "acceptUrl", "declineUrl"],
  },
  {
    slug: "repo-indexed",
    name: "Repository Indexed",
    category: "notification",
    fromType: "system",
    subject: "Repository Indexed: {{repoFullName}}",
    body: `**{{repoFullName}}** has been successfully indexed.

{{details}}`,
    variables: ["repoFullName", "details"],
  },
  {
    slug: "repo-index-failed",
    name: "Repository Indexing Failed",
    category: "notification",
    fromType: "system",
    subject: "Repository Indexing Failed: {{repoFullName}}",
    body: `**{{repoFullName}}** indexing failed.

Error: {{error}}`,
    variables: ["repoFullName", "error"],
  },
  {
    slug: "repo-analyzed",
    name: "Repository Analyzed",
    category: "notification",
    fromType: "system",
    subject: "Repository Analyzed: {{repoFullName}}",
    body: `**{{repoFullName}}** analysis is complete.`,
    variables: ["repoFullName"],
  },
  {
    slug: "review-requested",
    name: "Review Requested",
    category: "notification",
    fromType: "system",
    subject: "Review Requested: PR #{{prNumber}} {{prTitle}}",
    body: `A new review has been requested for [PR #{{prNumber}}: {{prTitle}}]({{prUrl}}).

Author: **{{prAuthor}}**`,
    variables: ["prNumber", "prTitle", "prUrl", "prAuthor"],
  },
  {
    slug: "review-completed",
    name: "Review Completed",
    category: "notification",
    fromType: "system",
    subject: "Review Completed: PR #{{prNumber}} {{prTitle}}",
    body: `Review is done for [PR #{{prNumber}}: {{prTitle}}]({{prUrl}}).

{{findingsCount}} finding(s), {{filesChanged}} file(s) reviewed.`,
    buttonText: "View Review",
    buttonUrl: "{{prUrl}}",
    variables: ["prNumber", "prTitle", "prUrl", "findingsCount", "filesChanged"],
  },
  {
    slug: "review-failed",
    name: "Review Failed",
    category: "notification",
    fromType: "system",
    subject: "Review Failed: PR #{{prNumber}} {{prTitle}}",
    body: `Review failed for PR #{{prNumber}}: **{{prTitle}}**.

Error: {{error}}`,
    variables: ["prNumber", "prTitle", "error"],
  },
  {
    slug: "knowledge-ready",
    name: "Knowledge Document Ready",
    category: "notification",
    fromType: "system",
    subject: "Knowledge Document {{actionLabel}}: {{documentTitle}}",
    body: `"**{{documentTitle}}**" is now available.

{{totalChunks}} chunks, {{totalVectors}} vectors.`,
    variables: ["documentTitle", "actionLabel", "totalChunks", "totalVectors"],
  },
  {
    slug: "new-login",
    name: "New Login Detected",
    category: "transactional",
    fromType: "system",
    subject: "New sign-in to your Octopus account",
    body: `Hey {{firstName}},

We noticed a new sign-in to your Octopus account.

- **IP Address:** {{ipAddress}}
- **Location:** {{location}}
- **Browser:** {{browser}}
- **Time:** {{loginTime}}

If this was you, you can ignore this email. If you don't recognize this activity, please change your password immediately and contact us.`,
    buttonText: "Review account activity",
    buttonUrl: "{{appUrl}}/settings",
    variables: ["firstName", "appUrl", "ipAddress", "location", "browser", "loginTime"],
  },
  {
    slug: "credit-low",
    name: "Credit Balance Low",
    category: "transactional",
    fromType: "system",
    subject: "Credit Balance Low: {{balance}} remaining",
    body: `Your organization's credit balance has dropped to **{{balance}}**.

When credits run out, PR reviews and other AI-powered features will stop working.`,
    buttonText: "Add Credits",
    buttonUrl: "{{appUrl}}/settings/billing",
    variables: ["balance", "appUrl"],
  },

  // ── Marketing templates (for Send Email) ──────────────────────────────

  {
    slug: "win-back-inactive",
    name: "Win Back Inactive Users",
    category: "marketing",
    fromType: "personal",
    subject: "We miss you, {{firstName}}!",
    body: `Hey {{firstName}},

We noticed you haven't been around for a while. A lot has changed since your last visit.

Here's what's new:

- Smarter reviews that learn from your team's feedback
- Knowledge docs to make reviews more relevant to your codebase
- Faster indexing and better context understanding

Your repos are still connected and ready to go. Just open a PR and Octopus will jump back in.

Would love to hear what made you drift away. Just reply to this email.`,
    buttonText: "Open dashboard",
    buttonUrl: "{{appUrl}}/dashboard",
    variables: ["firstName", "appUrl"],
  },
  {
    slug: "get-started-new-user",
    name: "Getting Started (New Users)",
    category: "marketing",
    fromType: "personal",
    subject: "Quick tips to get the most out of Octopus, {{firstName}}",
    body: `Hey {{firstName}},

You signed up recently and we want to make sure you're set up for success.

Here's what most teams do in their first week:

- **Connect a repo** and enable auto-review so every PR gets reviewed automatically
- **Add a knowledge doc** (your style guide, architecture decisions, or coding standards) so Octopus reviews like a team member who actually read the docs
- **React to findings** with thumbs up/down on GitHub/Bitbucket so Octopus learns what matters to your team

Takes about 5 minutes to get everything running. Let us know if you need help.`,
    buttonText: "Connect your first repo",
    buttonUrl: "{{appUrl}}/repositories",
    variables: ["firstName", "appUrl"],
  },
  {
    slug: "connect-repo-reminder",
    name: "Connect a Repository Reminder",
    category: "marketing",
    fromType: "personal",
    subject: "{{firstName}}, you're one step away from automated code reviews",
    body: `Hey {{firstName}},

You've got an Octopus account but haven't connected a repository yet. Without a repo, Octopus can't do its thing.

Connecting takes less than a minute:

- Click "Add Repository" in the dashboard
- Pick a GitHub or Bitbucket repo
- That's it. Octopus will start reviewing your next PR automatically.

If you're running into issues or have questions, just reply to this email.`,
    buttonText: "Add a repository",
    buttonUrl: "{{appUrl}}/repositories",
    variables: ["firstName", "appUrl"],
  },
  {
    slug: "first-review-nudge",
    name: "Get Your First Review",
    category: "marketing",
    fromType: "personal",
    subject: "{{firstName}}, your repo is ready for its first review",
    body: `Hey {{firstName}},

Your repository is connected but Octopus hasn't reviewed any PRs yet.

To get your first review:

- Make sure auto-review is enabled in your repository settings
- Open a pull request (or push to an existing one)
- Octopus will automatically review it and post findings as comments

Pro tip: add a knowledge doc with your coding standards so reviews are tailored to your team's preferences.

Let us know how your first review goes!`,
    buttonText: "Check repository settings",
    buttonUrl: "{{appUrl}}/repositories",
    variables: ["firstName", "appUrl"],
  },
];

/**
 * Seed email templates — only creates missing ones, never overwrites edits.
 */
export async function seedEmailTemplates(): Promise<{
  created: number;
  skipped: number;
}> {
  let created = 0;
  let skipped = 0;

  for (const t of templates) {
    const existing = await prisma.emailTemplate.findUnique({
      where: { slug: t.slug },
    });

    if (existing) {
      skipped++;
      continue;
    }

    const fromConfig = getFromConfig(t.fromType);

    await prisma.emailTemplate.create({
      data: {
        slug: t.slug,
        name: t.name,
        category: t.category,
        fromName: fromConfig.fromName,
        fromEmail: fromConfig.fromEmail,
        subject: t.subject,
        body: t.body,
        buttonText: t.buttonText ?? null,
        buttonUrl: t.buttonUrl ?? null,
        signatureName: t.signatureName ?? null,
        signatureTitle: t.signatureTitle ?? null,
        variables: t.variables,
        system: true,
      },
    });
    created++;
  }

  return { created, skipped };
}
