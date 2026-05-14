import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "dotenv";
import path from "path";

config({ path: path.resolve(__dirname, "../../../.env") });

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

const KEEP_EMAIL = process.env.SEED_USER_EMAIL || "admin@example.com";

// ── Helpers ──────────────────────────────────────────────────────────────
function cuid() {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function hoursAgo(n: number) {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log("🔍 Finding user:", KEEP_EMAIL);
  const user = await prisma.user.findUnique({ where: { email: KEEP_EMAIL } });
  if (!user) {
    console.error("❌ User not found:", KEEP_EMAIL);
    process.exit(1);
  }
  console.log("✅ Found user:", user.id, user.name);

  // ── Clear everything except user auth data ───────────────────────────
  console.log("🗑️  Clearing database (keeping user auth)...");

  // Order matters: children first
  await prisma.reviewIssue.deleteMany();
  await prisma.pullRequest.deleteMany();
  await prisma.favoriteRepository.deleteMany();
  await prisma.collabProjectMapping.deleteMany();
  await prisma.collabIntegration.deleteMany();
  await prisma.slackEventConfig.deleteMany();
  await prisma.slackIntegration.deleteMany();
  await prisma.bitbucketIntegration.deleteMany();
  await prisma.chatQueue.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.chatConversation.deleteMany();
  await prisma.knowledgeAuditLog.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.aiUsage.deleteMany();
  await prisma.daySummary.deleteMany();
  await prisma.organizationInvitation.deleteMany();
  await prisma.repository.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.organization.deleteMany();

  // Delete other users (keep only our user)
  await prisma.session.deleteMany({ where: { userId: { not: user.id } } });
  await prisma.account.deleteMany({ where: { userId: { not: user.id } } });
  await prisma.user.deleteMany({ where: { id: { not: user.id } } });

  // Ensure user is fully onboarded and not banned
  await prisma.user.update({
    where: { id: user.id },
    data: {
      onboardingCompleted: true,
      onboardingStep: 3,
      bannedAt: null,
      bannedReason: null,
    },
  });

  console.log("✅ Database cleared");

  // ── Organization ─────────────────────────────────────────────────────
  const orgId = cuid();
  const org = await prisma.organization.create({
    data: {
      id: orgId,
      name: "Acme Inc",
      slug: "acme-inc",
      githubInstallationId: 58201347,
      needsPermissionGrant: false,
    },
  });
  console.log("✅ Organization created:", org.name);

  await prisma.organizationMember.create({
    data: {
      id: cuid(),
      role: "owner",
      organizationId: orgId,
      userId: user.id,
    },
  });

  // ── Repositories ─────────────────────────────────────────────────────
  const repos = [
    {
      id: cuid(),
      name: "octopus",
      fullName: "acme-inc/octopus",
      provider: "github",
      externalId: "901234567",
      defaultBranch: "main",
      isActive: true,
      autoReview: true,
      installationId: 58201347,
      indexStatus: "indexed",
      indexedAt: daysAgo(1),
      indexedFiles: 247,
      totalFiles: 312,
      totalChunks: 1843,
      totalVectors: 1843,
      indexDurationMs: 34200,
      contributorCount: 4,
      contributors: JSON.stringify([
        { login: "alice-dev", avatarUrl: "https://avatars.githubusercontent.com/u/12345678?v=4", contributions: 187 },
        { login: "bob-dev", avatarUrl: "https://avatars.githubusercontent.com/u/23456789?v=4", contributions: 94 },
        { login: "carol-dev", avatarUrl: "https://avatars.githubusercontent.com/u/34567890?v=4", contributions: 62 },
        { login: "dave-dev", avatarUrl: "https://avatars.githubusercontent.com/u/45678901?v=4", contributions: 38 },
      ]),
      summary: "AI-powered code review platform that automates pull request analysis, provides intelligent code insights, and integrates with GitHub/Bitbucket workflows.",
      purpose: "Helps development teams ship higher quality code faster by catching bugs, security vulnerabilities, and architectural issues before they reach production.",
      analysis: `## Architecture Overview\n\n\`\`\`mermaid\ngraph TD\n    A[Next.js Frontend] --> B[API Routes]\n    B --> C[Review Engine]\n    B --> D[Indexing Pipeline]\n    C --> E[Claude AI]\n    D --> F[Vector Store]\n    B --> G[PostgreSQL]\n    H[GitHub Webhooks] --> B\n    I[Bitbucket Webhooks] --> B\n\`\`\`\n\n### Key Components\n- **Review Engine**: Orchestrates AI-powered code reviews using Claude\n- **Indexing Pipeline**: Processes repository files into searchable vector embeddings\n- **Knowledge Base**: Custom documentation storage for context-aware reviews\n- **Real-time Updates**: WebSocket-based live notifications via Pubby`,
      analysisStatus: "completed",
      analyzedAt: daysAgo(1),
      organizationId: orgId,
    },
    {
      id: cuid(),
      name: "backend-api",
      fullName: "acme-inc/backend-api",
      provider: "github",
      externalId: "901234568",
      defaultBranch: "main",
      isActive: true,
      autoReview: true,
      installationId: 58201347,
      indexStatus: "indexed",
      indexedAt: daysAgo(3),
      indexedFiles: 189,
      totalFiles: 224,
      totalChunks: 1245,
      totalVectors: 1245,
      indexDurationMs: 21800,
      contributorCount: 5,
      contributors: JSON.stringify([
        { login: "alice-dev", avatarUrl: "https://avatars.githubusercontent.com/u/12345678?v=4", contributions: 312 },
        { login: "eve-dev", avatarUrl: "https://avatars.githubusercontent.com/u/56789012?v=4", contributions: 156 },
        { login: "bob-dev", avatarUrl: "https://avatars.githubusercontent.com/u/23456789?v=4", contributions: 89 },
        { login: "carol-dev", avatarUrl: "https://avatars.githubusercontent.com/u/34567890?v=4", contributions: 73 },
        { login: "frank-dev", avatarUrl: "https://avatars.githubusercontent.com/u/67890123?v=4", contributions: 41 },
      ]),
      summary: "Core REST API powering the Acme platform — handles user management, billing, workspace orchestration, and third-party integrations.",
      purpose: "Central backend service that exposes a unified API for all Acme client applications and internal microservices.",
      analysis: `## Architecture Overview\n\n\`\`\`mermaid\ngraph TD\n    A[Express Server] --> B[Auth Middleware]\n    B --> C[Route Handlers]\n    C --> D[Service Layer]\n    D --> E[PostgreSQL]\n    D --> F[Redis Cache]\n    D --> G[S3 Storage]\n    H[Rate Limiter] --> A\n\`\`\`\n\n### Key Components\n- **Auth Middleware**: JWT + session-based authentication\n- **Service Layer**: Business logic abstraction\n- **Caching**: Redis for session and query caching\n- **Storage**: S3 for file uploads and assets`,
      analysisStatus: "completed",
      analyzedAt: daysAgo(3),
      organizationId: orgId,
    },
    {
      id: cuid(),
      name: "frontend-web",
      fullName: "acme-inc/frontend-web",
      provider: "github",
      externalId: "901234569",
      defaultBranch: "main",
      isActive: true,
      autoReview: true,
      installationId: 58201347,
      indexStatus: "indexed",
      indexedAt: daysAgo(2),
      indexedFiles: 423,
      totalFiles: 510,
      totalChunks: 2890,
      totalVectors: 2890,
      indexDurationMs: 52400,
      contributorCount: 6,
      contributors: JSON.stringify([
        { login: "carol-dev", avatarUrl: "https://avatars.githubusercontent.com/u/34567890?v=4", contributions: 245 },
        { login: "alice-dev", avatarUrl: "https://avatars.githubusercontent.com/u/12345678?v=4", contributions: 198 },
        { login: "dave-dev", avatarUrl: "https://avatars.githubusercontent.com/u/45678901?v=4", contributions: 134 },
        { login: "frank-dev", avatarUrl: "https://avatars.githubusercontent.com/u/67890123?v=4", contributions: 97 },
        { login: "eve-dev", avatarUrl: "https://avatars.githubusercontent.com/u/56789012?v=4", contributions: 76 },
        { login: "bob-dev", avatarUrl: "https://avatars.githubusercontent.com/u/23456789?v=4", contributions: 52 },
      ]),
      summary: "Modern React-based web application for the Acme platform — built with Next.js 15, featuring SSR, real-time collaboration, and responsive design.",
      purpose: "Primary user-facing interface providing workspace management, project dashboards, real-time chat, and analytics visualizations.",
      analysis: `## Architecture Overview\n\n\`\`\`mermaid\ngraph TD\n    A[Next.js App Router] --> B[Server Components]\n    A --> C[Client Components]\n    B --> D[Server Actions]\n    D --> E[API Layer]\n    C --> F[Zustand Store]\n    C --> G[WebSocket Client]\n    A --> H[Tailwind CSS]\n\`\`\`\n\n### Key Components\n- **App Router**: File-based routing with layouts and nested routes\n- **Server Actions**: Direct database operations from components\n- **State Management**: Zustand for client-side state\n- **Real-time**: WebSocket integration for live updates`,
      analysisStatus: "completed",
      analyzedAt: daysAgo(2),
      organizationId: orgId,
    },
    {
      id: cuid(),
      name: "infra",
      fullName: "acme-inc/infra",
      provider: "github",
      externalId: "901234570",
      defaultBranch: "main",
      isActive: true,
      autoReview: false,
      installationId: 58201347,
      indexStatus: "indexed",
      indexedAt: daysAgo(5),
      indexedFiles: 67,
      totalFiles: 82,
      totalChunks: 412,
      totalVectors: 412,
      indexDurationMs: 8900,
      contributorCount: 2,
      contributors: JSON.stringify([
        { login: "alice-dev", avatarUrl: "https://avatars.githubusercontent.com/u/12345678?v=4", contributions: 89 },
        { login: "eve-dev", avatarUrl: "https://avatars.githubusercontent.com/u/56789012?v=4", contributions: 34 },
      ]),
      summary: "Infrastructure-as-code repository managing AWS resources, Docker configurations, CI/CD pipelines, and monitoring setup using Terraform and Pulumi.",
      purpose: "Single source of truth for all Acme infrastructure definitions, deployment pipelines, and operational configurations.",
      analysisStatus: "none",
      organizationId: orgId,
    },
    {
      id: cuid(),
      name: "mobile-app",
      fullName: "acme-inc/mobile-app",
      provider: "github",
      externalId: "901234571",
      defaultBranch: "develop",
      isActive: true,
      autoReview: true,
      installationId: 58201347,
      indexStatus: "indexed",
      indexedAt: daysAgo(4),
      indexedFiles: 156,
      totalFiles: 198,
      totalChunks: 987,
      totalVectors: 987,
      indexDurationMs: 18300,
      contributorCount: 3,
      contributors: JSON.stringify([
        { login: "dave-dev", avatarUrl: "https://avatars.githubusercontent.com/u/45678901?v=4", contributions: 178 },
        { login: "frank-dev", avatarUrl: "https://avatars.githubusercontent.com/u/67890123?v=4", contributions: 112 },
        { login: "carol-dev", avatarUrl: "https://avatars.githubusercontent.com/u/34567890?v=4", contributions: 45 },
      ]),
      summary: "Cross-platform mobile application built with React Native and Expo — provides on-the-go access to code reviews, notifications, and team chat.",
      purpose: "Enables developers to stay connected with their team, review code, and manage tasks from their mobile devices.",
      analysis: `## Architecture Overview\n\n\`\`\`mermaid\ngraph TD\n    A[Expo Router] --> B[Screens]\n    B --> C[Components]\n    C --> D[React Query]\n    D --> E[API Client]\n    C --> F[Zustand]\n    B --> G[Push Notifications]\n\`\`\`\n\n### Key Components\n- **Expo Router**: File-based navigation\n- **React Query**: Server state management with caching\n- **Push Notifications**: Firebase Cloud Messaging integration`,
      analysisStatus: "completed",
      analyzedAt: daysAgo(4),
      organizationId: orgId,
    },
    {
      id: cuid(),
      name: "design-system",
      fullName: "acme-inc/design-system",
      provider: "github",
      externalId: "901234572",
      defaultBranch: "main",
      isActive: true,
      autoReview: false,
      installationId: 58201347,
      indexStatus: "pending",
      indexedFiles: 0,
      totalFiles: 0,
      totalChunks: 0,
      totalVectors: 0,
      contributorCount: 0,
      contributors: JSON.stringify([]),
      summary: null,
      purpose: null,
      analysisStatus: "none",
      organizationId: orgId,
    },
  ];

  for (const repo of repos) {
    await prisma.repository.create({ data: repo });
  }
  console.log(`✅ ${repos.length} repositories created`);

  // ── Pull Requests ────────────────────────────────────────────────────
  // Spread completed PRs across all 7 days with varying merge durations
  // so charts show natural wave patterns, not flat lines with a spike.
  // Key: updatedAt = merge date (determines bucket), createdAt determines TTM.

  const authors = ["alice-dev", "bob-dev", "carol-dev", "dave-dev", "eve-dev", "frank-dev"];

  const prData = [
    // ── Day 0 (today) — 3 completed + 2 in-progress ──
    { id: cuid(), number: 55, title: "fix: Resolve memory leak in WebSocket reconnection handler",
      url: "https://github.com/acme-inc/octopus/pull/55", author: "alice-dev",
      status: "completed", triggerCommentId: BigInt(1001), triggerCommentBody: "/review",
      headSha: "a1b2c3d", reviewCommentId: BigInt(2001),
      reviewBody: "## Code Review Summary\n\n**Overall**: Critical memory leak fix.\n\n### Changes\n- Properly cleanup event listeners on reconnect\n- Added WeakRef for subscription tracking\n\n### LGTM ✅",
      mergedAt: daysAgo(0), createdAt: hoursAgo(18), repositoryId: repos[0].id, issueCount: 0 },
    { id: cuid(), number: 236, title: "feat: Add bulk webhook retry endpoint",
      url: "https://github.com/acme-inc/backend-api/pull/236", author: "eve-dev",
      status: "completed", triggerCommentId: BigInt(1002), triggerCommentBody: "/review",
      headSha: "b2c3d4e", reviewCommentId: BigInt(2002),
      reviewBody: "## Code Review Summary\n\n**Overall**: Clean implementation of bulk retry.\n\n### Highlights\n- Batched processing with configurable chunk size\n- Proper dead letter queue integration\n- Good error handling per-item",
      mergedAt: daysAgo(0), createdAt: hoursAgo(36), repositoryId: repos[1].id, issueCount: 1 },
    { id: cuid(), number: 180, title: "fix: Dark mode contrast issues on settings page",
      url: "https://github.com/acme-inc/frontend-web/pull/180", author: "frank-dev",
      status: "completed", triggerCommentId: BigInt(1003), triggerCommentBody: "/review",
      headSha: "c3d4e5f", reviewCommentId: BigInt(2003),
      reviewBody: "## Code Review Summary\n\n**Overall**: Good accessibility improvements.\n\n### Changes\n- Fixed low contrast text in dark mode\n- Updated focus ring visibility\n\n### LGTM ✅",
      mergedAt: daysAgo(0), createdAt: hoursAgo(8), repositoryId: repos[2].id, issueCount: 0 },
    { id: cuid(), number: 56, title: "feat: Add support for custom review rules per repository",
      url: "https://github.com/acme-inc/octopus/pull/56", author: "dave-dev",
      status: "reviewing", triggerCommentId: BigInt(1004), triggerCommentBody: "/review",
      headSha: "d4e5f6g", createdAt: hoursAgo(4), repositoryId: repos[0].id, issueCount: 0 },
    { id: cuid(), number: 237, title: "feat: Add webhook retry queue with dead letter handling",
      url: "https://github.com/acme-inc/backend-api/pull/237", author: "bob-dev",
      status: "pending", triggerCommentId: BigInt(1005), triggerCommentBody: "/review",
      headSha: "e5f6g7h", createdAt: hoursAgo(2), repositoryId: repos[1].id, issueCount: 0 },

    // ── Day 1 — 2 completed ──
    { id: cuid(), number: 54, title: "feat: Real-time review status updates via WebSocket",
      url: "https://github.com/acme-inc/octopus/pull/54", author: "alice-dev",
      status: "completed", triggerCommentId: BigInt(1006), triggerCommentBody: "/review",
      headSha: "f6g7h8i", reviewCommentId: BigInt(2006),
      reviewBody: "## Code Review Summary\n\n**Overall**: Strong WebSocket integration.\n\n### Highlights\n- Clean event-driven architecture\n- Good reconnection logic\n\n### Suggestions\n- Add rate limiting for broadcasts",
      mergedAt: daysAgo(1), createdAt: daysAgo(3), repositoryId: repos[0].id, issueCount: 2 },
    { id: cuid(), number: 91, title: "fix: Infinite scroll pagination in review list",
      url: "https://github.com/acme-inc/mobile-app/pull/91", author: "frank-dev",
      status: "completed", triggerCommentId: BigInt(1007), triggerCommentBody: "/review",
      headSha: "g7h8i9j", reviewCommentId: BigInt(2007),
      reviewBody: "## Code Review Summary\n\n**Overall**: Good pagination fix.\n\n### Changes\n- Fixed cursor-based offset\n- Prevented duplicate fetches on fast scroll\n\n### LGTM ✅",
      mergedAt: daysAgo(1), createdAt: daysAgo(2), repositoryId: repos[4].id, issueCount: 0 },

    // ── Day 2 — 4 completed (busy day) ──
    { id: cuid(), number: 53, title: "refactor: Extract review engine into standalone module",
      url: "https://github.com/acme-inc/octopus/pull/53", author: "carol-dev",
      status: "completed", triggerCommentId: BigInt(1008), triggerCommentBody: "/review",
      headSha: "h8i9j0k", reviewCommentId: BigInt(2008),
      reviewBody: "## Code Review Summary\n\n**Overall**: Excellent modularization.\n\n### Key Changes\n- Separated review logic from API routes\n- Clean dependency injection pattern\n- Reduced coupling between components",
      mergedAt: daysAgo(2), createdAt: daysAgo(4), repositoryId: repos[0].id, issueCount: 1 },
    { id: cuid(), number: 234, title: "feat: Workspace-level rate limiting",
      url: "https://github.com/acme-inc/backend-api/pull/234", author: "eve-dev",
      status: "completed", triggerCommentId: BigInt(1009), triggerCommentBody: "/review",
      headSha: "i9j0k1l", reviewCommentId: BigInt(2009),
      reviewBody: "## Code Review Summary\n\n**Overall**: Solid rate limiting.\n\n### Issues Found\n- Race condition in token refresh\n- Missing rate limit headers in 429 responses",
      mergedAt: daysAgo(2), createdAt: daysAgo(5), repositoryId: repos[1].id, issueCount: 2 },
    { id: cuid(), number: 178, title: "feat: Redesign dashboard with analytics charts",
      url: "https://github.com/acme-inc/frontend-web/pull/178", author: "carol-dev",
      status: "completed", triggerCommentId: BigInt(1010), triggerCommentBody: "/review",
      headSha: "j0k1l2m", reviewCommentId: BigInt(2010),
      reviewBody: "## Code Review Summary\n\n**Overall**: Beautiful dashboard redesign.\n\n### Highlights\n- Clean Recharts implementation\n- Responsive grid layout\n\n### Suggestions\n- Add data caching",
      mergedAt: daysAgo(2), createdAt: daysAgo(3), repositoryId: repos[2].id, issueCount: 1 },
    { id: cuid(), number: 90, title: "feat: Push notification deep linking",
      url: "https://github.com/acme-inc/mobile-app/pull/90", author: "dave-dev",
      status: "completed", triggerCommentId: BigInt(1011), triggerCommentBody: "/review",
      headSha: "k1l2m3n", reviewCommentId: BigInt(2011),
      reviewBody: "## Code Review Summary\n\n**Overall**: Well-implemented deep linking.\n\n### Issues\n- Missing notification channel for Android 13+",
      mergedAt: daysAgo(2), createdAt: daysAgo(4), repositoryId: repos[4].id, issueCount: 2 },

    // ── Day 3 — 1 completed (light day) ──
    { id: cuid(), number: 177, title: "fix: SSR hydration mismatch in theme provider",
      url: "https://github.com/acme-inc/frontend-web/pull/177", author: "frank-dev",
      status: "completed", triggerCommentId: BigInt(1012), triggerCommentBody: "/review",
      headSha: "l2m3n4o", reviewCommentId: BigInt(2012),
      reviewBody: "## Code Review Summary\n\n**Overall**: Clean hydration fix.\n\n### LGTM ✅",
      mergedAt: daysAgo(3), createdAt: daysAgo(4), repositoryId: repos[2].id, issueCount: 0 },

    // ── Day 4 — 3 completed ──
    { id: cuid(), number: 52, title: "fix: Handle edge case in diff parser for binary files",
      url: "https://github.com/acme-inc/octopus/pull/52", author: "bob-dev",
      status: "completed", triggerCommentId: BigInt(1013), triggerCommentBody: "/review",
      headSha: "m3n4o5p", reviewCommentId: BigInt(2013),
      reviewBody: "## Code Review Summary\n\n**Overall**: Good binary file handling.\n\n### No issues found. LGTM! ✅",
      mergedAt: daysAgo(4), createdAt: daysAgo(5), repositoryId: repos[0].id, issueCount: 0 },
    { id: cuid(), number: 233, title: "fix: OAuth token refresh race condition",
      url: "https://github.com/acme-inc/backend-api/pull/233", author: "alice-dev",
      status: "completed", triggerCommentId: BigInt(1014), triggerCommentBody: "/review",
      headSha: "n4o5p6q", reviewCommentId: BigInt(2014),
      reviewBody: "## Code Review Summary\n\n**Overall**: Critical bug fix.\n\n### Changes\n- Added distributed lock using Redis SETNX\n- Exponential backoff for retry\n\n### LGTM ✅",
      mergedAt: daysAgo(4), createdAt: daysAgo(6), repositoryId: repos[1].id, issueCount: 1 },
    { id: cuid(), number: 89, title: "feat: Push notification support for reviews",
      url: "https://github.com/acme-inc/mobile-app/pull/89", author: "dave-dev",
      status: "completed", triggerCommentId: BigInt(1015), triggerCommentBody: "/review",
      headSha: "o5p6q7r", reviewCommentId: BigInt(2015),
      reviewBody: "## Code Review Summary\n\n**Overall**: Well-implemented push notifications.\n\n### Issues\n- Missing Android 13+ notification channel\n- No notification grouping",
      mergedAt: daysAgo(4), createdAt: daysAgo(6), repositoryId: repos[4].id, issueCount: 2 },

    // ── Day 5 — 2 completed ──
    { id: cuid(), number: 51, title: "refactor: Migrate review engine to streaming responses",
      url: "https://github.com/acme-inc/octopus/pull/51", author: "carol-dev",
      status: "completed", triggerCommentId: BigInt(1016), triggerCommentBody: "/review",
      headSha: "p6q7r8s", reviewCommentId: BigInt(2016),
      reviewBody: "## Code Review Summary\n\n**Overall**: Excellent streaming refactoring.\n\n### Minor Issues\n- Consider backpressure handling",
      mergedAt: daysAgo(5), createdAt: daysAgo(7), repositoryId: repos[0].id, issueCount: 1 },
    { id: cuid(), number: 176, title: "feat: Add loading skeletons for all pages",
      url: "https://github.com/acme-inc/frontend-web/pull/176", author: "frank-dev",
      status: "completed", triggerCommentId: BigInt(1017), triggerCommentBody: "/review",
      headSha: "q7r8s9t", reviewCommentId: BigInt(2017),
      reviewBody: "## Code Review Summary\n\n**Overall**: Nice UX improvement.\n\n### LGTM ✅",
      mergedAt: daysAgo(5), createdAt: daysAgo(6), repositoryId: repos[2].id, issueCount: 0 },

    // ── Day 6 — 3 completed ──
    { id: cuid(), number: 50, title: "feat: Add repository analysis with Mermaid diagrams",
      url: "https://github.com/acme-inc/octopus/pull/50", author: "alice-dev",
      status: "completed", triggerCommentId: BigInt(1018), triggerCommentBody: "/review",
      headSha: "r8s9t0u", reviewCommentId: BigInt(2018),
      reviewBody: "## Code Review Summary\n\n**Overall**: Great feature addition.\n\n### Suggestions\n- Add caching for generated diagrams\n- Consider lazy rendering",
      mergedAt: daysAgo(6), createdAt: daysAgo(8), repositoryId: repos[0].id, issueCount: 2 },
    { id: cuid(), number: 232, title: "feat: Add workspace settings API",
      url: "https://github.com/acme-inc/backend-api/pull/232", author: "bob-dev",
      status: "completed", triggerCommentId: BigInt(1019), triggerCommentBody: "/review",
      headSha: "s9t0u1v", reviewCommentId: BigInt(2019),
      reviewBody: "## Code Review Summary\n\n**Overall**: Clean API design.\n\n### Issues\n- Missing input validation on PATCH endpoint",
      mergedAt: daysAgo(6), createdAt: daysAgo(7), repositoryId: repos[1].id, issueCount: 1 },
    { id: cuid(), number: 88, title: "fix: Camera permission crash on Android 12",
      url: "https://github.com/acme-inc/mobile-app/pull/88", author: "dave-dev",
      status: "completed", triggerCommentId: BigInt(1020), triggerCommentBody: "/review",
      headSha: "t0u1v2w", reviewCommentId: BigInt(2020),
      reviewBody: "## Code Review Summary\n\n**Overall**: Good platform-specific fix.\n\n### LGTM ✅",
      mergedAt: daysAgo(6), createdAt: daysAgo(7), repositoryId: repos[4].id, issueCount: 0 },
  ];

  for (const pr of prData) {
    const { issueCount, ...prFields } = pr;
    await prisma.pullRequest.create({ data: prFields });
  }

  // Fix updatedAt to match merge dates (Prisma @updatedAt auto-sets to now)
  for (const pr of prData) {
    if (pr.status === "completed" && pr.mergedAt) {
      await prisma.$executeRaw`UPDATE pull_requests SET "updatedAt" = ${pr.mergedAt} WHERE id = ${pr.id}`;
    }
  }
  console.log(`✅ ${prData.length} pull requests created (updatedAt corrected)`);

  // ── Review Issues ────────────────────────────────────────────────────
  // Create issues matching the issueCount per PR for natural chart distribution.
  // Map PR index to the PR's id for linking.
  const prById = new Map(prData.map((pr, i) => [i, pr]));

  const reviewIssues = [
    // Day 0: PR index 1 (bulk webhook) — 1 issue
    { id: cuid(), title: "Missing idempotency key for bulk retry", description: "The bulk retry endpoint doesn't enforce idempotency. If a client retries the request due to a timeout, webhooks could be sent multiple times. Consider adding an idempotency key header.", severity: "medium", filePath: "src/routes/webhooks.ts", lineNumber: 89, pullRequestId: prData[1].id, createdAt: daysAgo(0) },

    // Day 1: PR index 5 (WebSocket) — 2 issues
    { id: cuid(), title: "Potential memory leak in event listener cleanup", description: "The `useEffect` cleanup function doesn't remove the event listeners added in `subscribeToChannel`. This could cause memory leaks when components unmount while the socket is still connected.", severity: "high", filePath: "src/hooks/useReviewStatus.ts", lineNumber: 23, pullRequestId: prData[5].id, createdAt: daysAgo(1) },
    { id: cuid(), title: "Missing error boundary for WebSocket disconnection", description: "When the WebSocket connection drops unexpectedly, the UI doesn't show any feedback to the user. Consider adding a toast notification or banner.", severity: "medium", filePath: "src/lib/websocket.ts", lineNumber: 45, pullRequestId: prData[5].id, createdAt: daysAgo(1) },

    // Day 2: PR index 7 (extract review module) — 1 issue
    { id: cuid(), title: "Circular dependency between review and analysis modules", description: "The new `ReviewEngine` module imports from `AnalysisService`, which in turn imports types from `ReviewEngine`. This circular dependency could cause issues with tree-shaking and testing.", severity: "medium", filePath: "src/engine/review.ts", lineNumber: 12, pullRequestId: prData[7].id, createdAt: daysAgo(2), acknowledgedAt: daysAgo(1) },

    // Day 2: PR index 8 (rate limiting) — 2 issues
    { id: cuid(), title: "Race condition in token bucket refill", description: "The `refillTokens()` method reads and writes the token count without atomic operations. Under high concurrency, two requests could both grant tokens, exceeding the rate limit.", severity: "high", filePath: "src/middleware/rateLimiter.ts", lineNumber: 67, pullRequestId: prData[8].id, createdAt: daysAgo(2) },
    { id: cuid(), title: "Missing X-RateLimit headers in 429 response", description: "RFC 6585 recommends including `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers. These help clients implement proper retry logic.", severity: "low", filePath: "src/middleware/rateLimiter.ts", lineNumber: 112, pullRequestId: prData[8].id, createdAt: daysAgo(2), acknowledgedAt: daysAgo(1) },

    // Day 2: PR index 9 (dashboard redesign) — 1 issue
    { id: cuid(), title: "Chart re-renders on every parent state change", description: "The `AnalyticsChart` component re-renders on every parent state update because it doesn't memoize its data prop. Wrap the data transformation in `useMemo`.", severity: "low", filePath: "src/components/dashboard/AnalyticsChart.tsx", lineNumber: 34, pullRequestId: prData[9].id, createdAt: daysAgo(2), acknowledgedAt: daysAgo(1) },

    // Day 2: PR index 10 (push notification deep linking) — 2 issues
    { id: cuid(), title: "Missing notification channel for Android 13+", description: "Android 13 requires explicit notification channel creation with user permission. The current implementation only creates a default channel, which may be silent on newer Android versions.", severity: "medium", filePath: "src/services/notifications.ts", lineNumber: 19, pullRequestId: prData[10].id, createdAt: daysAgo(2) },
    { id: cuid(), title: "No notification grouping for batch updates", description: "When multiple reviews complete simultaneously, each creates a separate notification. Consider using notification grouping for a cleaner experience.", severity: "low", filePath: "src/services/notifications.ts", lineNumber: 56, pullRequestId: prData[10].id, createdAt: daysAgo(2) },

    // Day 4: PR index 13 (OAuth fix) — 1 issue
    { id: cuid(), title: "Lock TTL too short for slow token providers", description: "The Redis lock TTL is set to 5 seconds, but some OAuth providers take up to 10 seconds to respond. If the lock expires mid-refresh, another request could start a concurrent refresh.", severity: "medium", filePath: "src/services/oauth.ts", lineNumber: 34, pullRequestId: prData[13].id, createdAt: daysAgo(4), acknowledgedAt: daysAgo(3) },

    // Day 4: PR index 14 (push notifications) — 2 issues
    { id: cuid(), title: "Push token not invalidated on logout", description: "When a user logs out, the FCM token remains registered. This means the device could still receive notifications for the logged-out account.", severity: "high", filePath: "src/services/pushNotifications.ts", lineNumber: 78, pullRequestId: prData[14].id, createdAt: daysAgo(4) },
    { id: cuid(), title: "Missing retry logic for FCM 503 errors", description: "Firebase Cloud Messaging occasionally returns 503 during deployments. The current implementation doesn't retry, causing notification loss during FCM maintenance windows.", severity: "medium", filePath: "src/services/pushNotifications.ts", lineNumber: 112, pullRequestId: prData[14].id, createdAt: daysAgo(4) },

    // Day 5: PR index 15 (streaming) — 1 issue
    { id: cuid(), title: "No backpressure handling for slow consumers", description: "The streaming implementation doesn't account for clients that consume data slower than the server produces it. This could lead to unbounded memory growth under load.", severity: "medium", filePath: "src/engine/stream.ts", lineNumber: 78, pullRequestId: prData[15].id, createdAt: daysAgo(5), acknowledgedAt: daysAgo(4) },

    // Day 6: PR index 17 (Mermaid diagrams) — 2 issues
    { id: cuid(), title: "Generated diagrams not cached between renders", description: "The Mermaid diagram generation runs on every component render. Since the analysis content rarely changes, add a caching layer to avoid redundant parsing and rendering.", severity: "low", filePath: "src/components/analysis/MermaidRenderer.tsx", lineNumber: 22, pullRequestId: prData[17].id, createdAt: daysAgo(6), acknowledgedAt: daysAgo(5) },
    { id: cuid(), title: "XSS risk in raw analysis HTML injection", description: "The analysis content is rendered using dangerouslySetInnerHTML without sanitization. If a repository contains crafted markdown, it could execute arbitrary JavaScript.", severity: "high", filePath: "src/components/analysis/AnalysisView.tsx", lineNumber: 45, pullRequestId: prData[17].id, createdAt: daysAgo(6) },

    // Day 6: PR index 18 (workspace settings) — 1 issue
    { id: cuid(), title: "Missing input validation on PATCH endpoint", description: "The workspace settings PATCH endpoint doesn't validate the request body against a schema. Malformed or unexpected fields are silently accepted and could corrupt workspace configuration.", severity: "medium", filePath: "src/routes/workspace.ts", lineNumber: 156, pullRequestId: prData[18].id, createdAt: daysAgo(6) },
  ];

  for (const issue of reviewIssues) {
    await prisma.reviewIssue.create({ data: issue });
  }
  console.log(`✅ ${reviewIssues.length} review issues created`);

  // ── Knowledge Documents ──────────────────────────────────────────────
  const knowledgeDocs = [
    {
      id: cuid(), title: "API Design Guidelines", sourceType: "paste", status: "ready",
      content: "# API Design Guidelines\n\n## Naming Conventions\n- Use kebab-case for URLs\n- Use camelCase for JSON fields\n- Use plural nouns for collections\n\n## Versioning\n- Use URL path versioning: /v1/resource\n- Major version changes require new path\n\n## Error Responses\n- Always return consistent error format\n- Include error code, message, and details\n\n## Pagination\n- Use cursor-based pagination for large datasets\n- Include next/prev links in response",
      totalChunks: 8, totalVectors: 8, processingMs: 1200,
      organizationId: orgId, createdAt: daysAgo(20),
    },
    {
      id: cuid(), title: "Code Review Standards", sourceType: "paste", status: "ready",
      content: "# Code Review Standards\n\n## What to look for\n1. **Correctness**: Does the code do what it's supposed to?\n2. **Security**: Are there any vulnerabilities?\n3. **Performance**: Any obvious bottlenecks?\n4. **Readability**: Is the code self-documenting?\n5. **Testing**: Are edge cases covered?\n\n## Severity Levels\n- **High**: Security vulnerabilities, data loss risks, breaking changes\n- **Medium**: Bugs, performance issues, missing validation\n- **Low**: Style issues, minor improvements, documentation",
      totalChunks: 6, totalVectors: 6, processingMs: 980,
      organizationId: orgId, createdAt: daysAgo(18),
    },
    {
      id: cuid(), title: "Deployment Runbook", sourceType: "file", fileName: "deployment-runbook.md", status: "ready",
      content: "# Deployment Runbook\n\n## Pre-deployment Checklist\n- [ ] All tests passing on CI\n- [ ] Database migrations reviewed\n- [ ] Feature flags configured\n- [ ] Monitoring alerts set up\n\n## Deployment Steps\n1. Create release branch from main\n2. Run database migrations\n3. Deploy to staging environment\n4. Run smoke tests\n5. Deploy to production\n6. Verify health checks\n\n## Rollback Procedure\n1. Revert to previous Docker image tag\n2. Rollback database migrations if needed\n3. Clear CDN cache\n4. Notify team in Slack",
      totalChunks: 10, totalVectors: 10, processingMs: 1450,
      organizationId: orgId, createdAt: daysAgo(15),
    },
    {
      id: cuid(), title: "TypeScript Best Practices", sourceType: "paste", status: "ready",
      content: "# TypeScript Best Practices\n\n## Type Safety\n- Avoid `any` — use `unknown` for truly unknown types\n- Prefer interfaces for object shapes\n- Use discriminated unions for state management\n- Leverage `satisfies` operator for type-safe defaults\n\n## Patterns\n- Use branded types for IDs\n- Prefer readonly properties\n- Use zod for runtime validation\n- Leverage template literal types for string patterns",
      totalChunks: 5, totalVectors: 5, processingMs: 870,
      organizationId: orgId, createdAt: daysAgo(12),
    },
  ];

  for (const doc of knowledgeDocs) {
    await prisma.knowledgeDocument.create({ data: doc });
  }
  console.log(`✅ ${knowledgeDocs.length} knowledge documents created`);

  // Knowledge Audit Logs
  for (const doc of knowledgeDocs) {
    await prisma.knowledgeAuditLog.create({
      data: {
        id: cuid(),
        action: "created",
        documentId: doc.id,
        userId: user.id,
        organizationId: orgId,
        createdAt: doc.createdAt,
      },
    });
  }

  // ── Chat Conversations ───────────────────────────────────────────────
  const conversations = [
    {
      id: cuid(),
      title: "How does the review engine work?",
      userId: user.id,
      organizationId: orgId,
      createdAt: daysAgo(3),
      messages: [
        { role: "user", content: "Can you explain how the review engine processes a pull request from start to finish?" },
        { role: "assistant", content: "Sure! Here's how the review engine works:\n\n1. **Webhook Trigger**: When a `/review` comment is posted on a PR, GitHub sends a webhook to our API endpoint.\n\n2. **Diff Extraction**: We fetch the full diff from GitHub's API, including file changes, additions, and deletions.\n\n3. **Context Gathering**: The engine retrieves relevant code context from our vector store — similar code patterns, related files, and any knowledge base documents.\n\n4. **AI Analysis**: We send the diff along with context to Claude, which analyzes the code for:\n   - Security vulnerabilities\n   - Performance issues\n   - Code style inconsistencies\n   - Potential bugs\n   - Architecture concerns\n\n5. **Review Generation**: Claude's response is formatted into a structured review with severity-tagged issues.\n\n6. **GitHub Comment**: The review is posted as a comment on the PR with inline code annotations.\n\nThe entire process typically takes 15-45 seconds depending on the PR size." },
        { role: "user", content: "What happens if the PR is too large?" },
        { role: "assistant", content: "Great question! For large PRs, we have several strategies:\n\n1. **File Prioritization**: We focus on the most impactful files first — source code over config files, modified files over new additions.\n\n2. **Chunked Processing**: If the diff exceeds our context window, we split it into logical chunks (by file or directory) and review each chunk separately.\n\n3. **Summary Aggregation**: Individual chunk reviews are aggregated into a cohesive summary that identifies cross-cutting concerns.\n\n4. **Size Warning**: If a PR has more than 50 changed files, we include a suggestion to break it into smaller PRs for better reviewability.\n\nThe maximum we currently support is ~500 changed files or ~10,000 lines of diff." },
      ],
    },
    {
      id: cuid(),
      title: "Database indexing optimization",
      userId: user.id,
      organizationId: orgId,
      createdAt: daysAgo(7),
      messages: [
        { role: "user", content: "The repository indexing for frontend-web seems slow. What can we do to speed it up?" },
        { role: "assistant", content: "Looking at the frontend-web repository metrics:\n- **423 files indexed** out of 510 total\n- **Index duration**: 52.4 seconds\n- **2,890 chunks** generated\n\nHere are some optimization strategies:\n\n1. **Exclude non-essential files**: Add patterns to `.octopusignore` to skip:\n   - `node_modules/`, `dist/`, `.next/`\n   - Test fixtures and mock data\n   - Generated files (`.d.ts`, sourcemaps)\n\n2. **Incremental indexing**: Instead of re-indexing the entire repo, only process files changed since the last index. This is already partially implemented.\n\n3. **Parallel chunk processing**: Currently chunks are embedded sequentially. We could batch them for parallel embedding API calls.\n\n4. **Caching**: Cache embeddings for files that haven't changed between indexes.\n\nWould you like me to check if there are specific file patterns causing the slowdown?" },
      ],
    },
    {
      id: cuid(),
      title: "Setting up Bitbucket integration",
      userId: user.id,
      organizationId: orgId,
      createdAt: daysAgo(1),
      messages: [
        { role: "user", content: "How do I connect our Bitbucket workspace?" },
        { role: "assistant", content: "To connect your Bitbucket workspace:\n\n1. Go to **Settings → Integrations**\n2. Click **Connect Bitbucket**\n3. You'll be redirected to Bitbucket's OAuth consent screen\n4. Authorize Octopus to access your workspace\n5. Select the repositories you want to monitor\n\nOnce connected, Octopus will:\n- Automatically detect new pull requests\n- Allow you to trigger reviews with `/review` comments\n- Index repository code for context-aware reviews\n\nNote: You'll need **Admin** access to the Bitbucket workspace to set up the integration." },
      ],
    },
  ];

  for (const conv of conversations) {
    const { messages, ...convData } = conv;
    await prisma.chatConversation.create({ data: convData });
    for (let i = 0; i < messages.length; i++) {
      await prisma.chatMessage.create({
        data: {
          id: cuid(),
          role: messages[i].role,
          content: messages[i].content,
          userId: messages[i].role === "user" ? user.id : null,
          userName: messages[i].role === "user" ? user.name : null,
          conversationId: conv.id,
          createdAt: new Date(conv.createdAt!.getTime() + i * 60000),
        },
      });
    }
  }
  console.log(`✅ ${conversations.length} chat conversations created`);

  // ── AI Usage ─────────────────────────────────────────────────────────
  const aiUsages: Array<{
    id: string;
    provider: string;
    model: string;
    operation: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    organizationId: string;
    createdAt: Date;
  }> = [];

  // Generate usage data for the last 14 days
  for (let day = 0; day < 14; day++) {
    const date = daysAgo(day);
    const reviewCount = randomInt(1, 4);
    const chatCount = randomInt(2, 6);

    for (let r = 0; r < reviewCount; r++) {
      aiUsages.push({
        id: cuid(),
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        operation: "review",
        inputTokens: randomInt(8000, 25000),
        outputTokens: randomInt(1500, 4500),
        cacheReadTokens: randomInt(2000, 8000),
        cacheWriteTokens: randomInt(500, 2000),
        organizationId: orgId,
        createdAt: date,
      });
    }

    for (let c = 0; c < chatCount; c++) {
      aiUsages.push({
        id: cuid(),
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        operation: "chat",
        inputTokens: randomInt(2000, 8000),
        outputTokens: randomInt(500, 2000),
        cacheReadTokens: randomInt(1000, 4000),
        cacheWriteTokens: randomInt(200, 800),
        organizationId: orgId,
        createdAt: date,
      });
    }

    // Embedding operations
    aiUsages.push({
      id: cuid(),
      provider: "openai",
      model: "text-embedding-3-large",
      operation: "embedding",
      inputTokens: randomInt(10000, 50000),
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      organizationId: orgId,
      createdAt: date,
    });
  }

  for (const usage of aiUsages) {
    await prisma.aiUsage.create({ data: usage });
  }
  console.log(`✅ ${aiUsages.length} AI usage records created`);

  // ── Day Summaries ────────────────────────────────────────────────────
  const daySummaries = [
    {
      id: cuid(),
      date: formatDate(daysAgo(1)),
      summary: "## Daily Development Summary — " + formatDate(daysAgo(1)) + "\n\n### Highlights\n- **3 PRs merged** across octopus, backend-api, and mobile-app\n- Real-time WebSocket support landed in octopus (#52) — reviews now update live\n- Rate limiting implementation merged for backend-api (#234)\n- Mobile infinite scroll bug fixed (#90)\n\n### Review Activity\n- 4 code reviews completed\n- 2 high-severity issues identified (memory leak in WebSocket hooks, race condition in rate limiter)\n- 1 PR still in review: custom review rules feature (#53)\n\n### Contributors\n- **alice-dev**: 2 PRs (WebSocket integration, OAuth fix)\n- **eve-dev**: 1 PR (rate limiting)\n- **frank-dev**: 1 PR (pagination fix)\n- **dave-dev**: 1 PR in review (custom review rules)",
      prCount: 4,
      organizationId: orgId,
    },
    {
      id: cuid(),
      date: formatDate(daysAgo(2)),
      summary: "## Daily Development Summary — " + formatDate(daysAgo(2)) + "\n\n### Highlights\n- **2 PRs merged**: dashboard redesign and diff parser fix\n- New analytics dashboard with Recharts landed in frontend-web (#178)\n- Binary file edge case fixed in octopus diff parser (#51)\n\n### Review Activity\n- 3 code reviews completed\n- 1 low-severity issue: chart re-rendering performance\n- All reviews completed within 30 seconds average\n\n### Contributors\n- **carol-dev**: Dashboard redesign (178 — 23 files changed)\n- **bob-dev**: Diff parser fix (51 — 4 files changed)",
      prCount: 2,
      organizationId: orgId,
    },
    {
      id: cuid(),
      date: formatDate(daysAgo(3)),
      summary: "## Daily Development Summary — " + formatDate(daysAgo(3)) + "\n\n### Highlights\n- **2 PRs merged**: SSR hydration fix and push notifications\n- Hydration mismatch in theme provider resolved in frontend-web (#177)\n- Push notification support launched for mobile-app (#89)\n\n### Review Activity\n- 2 code reviews completed\n- 1 medium-severity issue: missing Android 13+ notification channel\n- 1 low-severity issue: notification grouping suggestion\n\n### Contributors\n- **frank-dev**: Theme hydration fix (177)\n- **dave-dev**: Push notifications (89 — 12 files changed)",
      prCount: 2,
      organizationId: orgId,
    },
  ];

  for (const summary of daySummaries) {
    await prisma.daySummary.create({ data: summary });
  }
  console.log(`✅ ${daySummaries.length} day summaries created`);

  // ── Favorite Repositories ────────────────────────────────────────────
  await prisma.favoriteRepository.createMany({
    data: [
      { id: cuid(), userId: user.id, repositoryId: repos[0].id },
      { id: cuid(), userId: user.id, repositoryId: repos[2].id },
    ],
  });
  console.log("✅ Favorite repositories set");

  // ── Available Models ──────────────────────────────────────────────────
  await prisma.availableModel.deleteMany();
  const models = [
    // Anthropic
    { modelId: "claude-opus-4-6-20250619", displayName: "Claude Opus 4.6", provider: "anthropic", category: "llm", inputPrice: 15, outputPrice: 75, sortOrder: 0 },
    { modelId: "claude-sonnet-4-6-20250619", displayName: "Claude Sonnet 4.6", provider: "anthropic", category: "llm", inputPrice: 3, outputPrice: 15, sortOrder: 1 },
    { modelId: "claude-sonnet-4-20250514", displayName: "Claude Sonnet 4", provider: "anthropic", category: "llm", inputPrice: 3, outputPrice: 15, sortOrder: 2 },
    { modelId: "claude-opus-4-20250514", displayName: "Claude Opus 4", provider: "anthropic", category: "llm", inputPrice: 15, outputPrice: 75, sortOrder: 3 },
    { modelId: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5", provider: "anthropic", category: "llm", inputPrice: 1, outputPrice: 5, sortOrder: 4 },
    // Google
    { modelId: "gemini-2.5-pro", displayName: "Gemini 2.5 Pro", provider: "google", category: "llm", inputPrice: 1.25, outputPrice: 10, sortOrder: 5 },
    { modelId: "gemini-2.5-flash", displayName: "Gemini 2.5 Flash", provider: "google", category: "llm", inputPrice: 0.15, outputPrice: 0.6, sortOrder: 6 },
    // OpenAI
    { modelId: "gpt-4o", displayName: "GPT-4o", provider: "openai", category: "llm", inputPrice: 2.5, outputPrice: 10, sortOrder: 7 },
    { modelId: "gpt-4o-mini", displayName: "GPT-4o Mini", provider: "openai", category: "llm", inputPrice: 0.15, outputPrice: 0.6, sortOrder: 8 },
    { modelId: "o3", displayName: "OpenAI o3", provider: "openai", category: "llm", inputPrice: 10, outputPrice: 40, sortOrder: 9 },
    { modelId: "o3-mini", displayName: "OpenAI o3 Mini", provider: "openai", category: "llm", inputPrice: 1.1, outputPrice: 4.4, sortOrder: 10 },
    { modelId: "o4-mini", displayName: "OpenAI o4 Mini", provider: "openai", category: "llm", inputPrice: 1.1, outputPrice: 4.4, sortOrder: 11 },
    { modelId: "gpt-5-codex", displayName: "GPT-5 Codex", provider: "openai", category: "llm", inputPrice: 1.25, outputPrice: 10, sortOrder: 12 },
    { modelId: "gpt-5-codex-mini", displayName: "GPT-5 Codex Mini", provider: "openai", category: "llm", inputPrice: 0.25, outputPrice: 2, sortOrder: 13 },
    { modelId: "codex-mini-latest", displayName: "Codex Mini", provider: "openai", category: "llm", inputPrice: 1.5, outputPrice: 6, sortOrder: 14 },
    // Embeddings
    { modelId: "text-embedding-3-large", displayName: "Embedding 3 Large", provider: "openai", category: "embedding", inputPrice: 0.13, outputPrice: 0, sortOrder: 0 },
    { modelId: "text-embedding-3-small", displayName: "Embedding 3 Small", provider: "openai", category: "embedding", inputPrice: 0.02, outputPrice: 0, sortOrder: 1 },
  ];
  for (const m of models) {
    await prisma.availableModel.create({ data: { id: cuid(), ...m } });
  }
  console.log(`✅ ${models.length} available models seeded`);

  console.log("\n🎉 Seed completed successfully!");
}

function formatDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
