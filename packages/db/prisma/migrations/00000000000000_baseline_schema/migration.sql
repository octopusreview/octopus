-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "onboardingCompleted" BOOLEAN NOT NULL DEFAULT false,
    "onboardingStep" INTEGER NOT NULL DEFAULT 0,
    "bannedAt" TIMESTAMP(3),
    "bannedReason" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "welcomeEmailSentAt" TIMESTAMP(3),
    "marketingEmailsEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "githubInstallationId" INTEGER,
    "needsPermissionGrant" BOOLEAN NOT NULL DEFAULT false,
    "openaiApiKey" TEXT,
    "anthropicApiKey" TEXT,
    "cohereApiKey" TEXT,
    "googleApiKey" TEXT,
    "ollamaBaseUrl" TEXT,
    "grokApiKey" TEXT,
    "openrouterApiKey" TEXT,
    "acpBaseUrl" TEXT,
    "acpApiKey" TEXT,
    "opencodeBaseUrl" TEXT,
    "opencodeApiKey" TEXT,
    "claudeCodeAuthMode" TEXT,
    "claudeCodeApiKey" TEXT,
    "defaultModelId" TEXT,
    "defaultEmbedModelId" TEXT,
    "monthlySpendLimitUsd" DOUBLE PRECISION,
    "checkFailureThreshold" TEXT NOT NULL DEFAULT 'critical',
    "reviewsPaused" BOOLEAN NOT NULL DEFAULT false,
    "blockedAuthors" JSONB NOT NULL DEFAULT '[]',
    "defaultReviewConfig" JSONB NOT NULL DEFAULT '{}',
    "reviewLanguage" TEXT NOT NULL DEFAULT 'en',
    "stripeCustomerId" TEXT,
    "creditBalance" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "freeCreditBalance" DECIMAL(12,4) NOT NULL DEFAULT 150,
    "billingEmail" TEXT,
    "githubMarketplacePlanId" INTEGER,
    "githubMarketplacePlanName" TEXT,
    "githubMarketplaceAccountId" INTEGER,
    "githubMarketplaceOnFreeTrial" BOOLEAN NOT NULL DEFAULT false,
    "githubMarketplaceFreeTrialEndsOn" TIMESTAMP(3),
    "type" INTEGER NOT NULL DEFAULT 1,
    "communityDailyReviewLimit" INTEGER NOT NULL DEFAULT 5,
    "bannedAt" TIMESTAMP(3),
    "bannedReason" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "removedById" TEXT,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "externalId" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoReview" BOOLEAN NOT NULL DEFAULT true,
    "installationId" INTEGER,
    "indexStatus" TEXT NOT NULL DEFAULT 'pending',
    "indexedAt" TIMESTAMP(3),
    "indexedFiles" INTEGER NOT NULL DEFAULT 0,
    "totalFiles" INTEGER NOT NULL DEFAULT 0,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "totalVectors" INTEGER NOT NULL DEFAULT 0,
    "indexDurationMs" INTEGER,
    "contributorCount" INTEGER NOT NULL DEFAULT 0,
    "contributors" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "purpose" TEXT,
    "analysis" TEXT,
    "analysisStatus" TEXT NOT NULL DEFAULT 'none',
    "analyzedAt" TIMESTAMP(3),
    "reviewModelId" TEXT,
    "embedModelId" TEXT,
    "reviewConfig" JSONB NOT NULL DEFAULT '{}',
    "useRepoConfig" BOOLEAN NOT NULL DEFAULT false,
    "repoConfigFiles" JSONB NOT NULL DEFAULT '[".octopus.md", "AGENTS.md", "CLAUDE.md"]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_config_extractions" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "extractedRules" TEXT NOT NULL,
    "rawByteSize" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_config_extractions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pull_requests" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "triggerCommentId" BIGINT,
    "triggerCommentBody" TEXT,
    "headSha" TEXT,
    "reviewCommentId" BIGINT,
    "reviewBody" TEXT,
    "errorMessage" TEXT,
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "repositoryId" TEXT NOT NULL,

    CONSTRAINT "pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_issues" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "confidence" TEXT,
    "filePath" TEXT,
    "lineNumber" INTEGER,
    "acknowledgedAt" TIMESTAMP(3),
    "feedback" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "feedbackBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature" TEXT,
    "linearIssueId" TEXT,
    "linearIssueUrl" TEXT,
    "jiraIssueKey" TEXT,
    "jiraIssueUrl" TEXT,
    "githubIssueNumber" INTEGER,
    "githubIssueUrl" TEXT,
    "githubCommentId" BIGINT,
    "pullRequestId" TEXT NOT NULL,

    CONSTRAINT "review_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'paste',
    "fileName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "errorMessage" TEXT,
    "totalChunks" INTEGER NOT NULL DEFAULT 0,
    "totalVectors" INTEGER NOT NULL DEFAULT 0,
    "processingMs" INTEGER,
    "templateId" TEXT,
    "alwaysInclude" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "knowledge_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New Chat',
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "sharedAt" TIMESTAMP(3),
    "sharedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "conversationId" TEXT NOT NULL,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_queue" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "chat_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_notification_preferences" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "memberId" TEXT NOT NULL,

    CONSTRAINT "email_notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_integrations" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "botUserId" TEXT,
    "channelId" TEXT,
    "channelName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "slack_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_event_configs" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "slackIntegrationId" TEXT NOT NULL,

    CONSTRAINT "slack_event_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bitbucket_integrations" (
    "id" TEXT NOT NULL,
    "workspaceSlug" TEXT NOT NULL,
    "workspaceName" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT,
    "webhookUuid" TEXT,
    "webhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "bitbucket_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gitlab_integrations" (
    "id" TEXT NOT NULL,
    "gitlabHost" TEXT NOT NULL DEFAULT 'https://gitlab.com',
    "namespacePath" TEXT NOT NULL,
    "namespaceName" TEXT NOT NULL,
    "oauthClientId" TEXT,
    "oauthClientSecretEnc" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT,
    "webhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "gitlab_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_integrations" (
    "id" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "workspaceId" TEXT,
    "workspaceName" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "collab_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usages" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "usedOwnKey" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ai_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collab_project_mappings" (
    "id" TEXT NOT NULL,
    "collabProjectId" TEXT NOT NULL,
    "collabProjectName" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "collabIntegrationId" TEXT NOT NULL,

    CONSTRAINT "collab_project_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linear_integrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspaceName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "linear_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "linear_team_mappings" (
    "id" TEXT NOT NULL,
    "linearTeamId" TEXT NOT NULL,
    "linearTeamName" TEXT NOT NULL,
    "linearTeamKey" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "linearIntegrationId" TEXT NOT NULL,

    CONSTRAINT "linear_team_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jira_integrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "cloudId" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jira_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jira_project_mappings" (
    "id" TEXT NOT NULL,
    "jiraProjectId" TEXT NOT NULL,
    "jiraProjectKey" TEXT NOT NULL,
    "jiraProjectName" TEXT NOT NULL,
    "jiraIssueTypeId" TEXT NOT NULL,
    "jiraIssueTypeName" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "jiraIntegrationId" TEXT NOT NULL,

    CONSTRAINT "jira_project_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_repositories" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,

    CONSTRAINT "favorite_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_summaries" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "prCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "day_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" TEXT NOT NULL,
    "amount" DECIMAL(12,4) NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "stripeSessionId" TEXT,
    "receiptUrl" TEXT,
    "balanceAfter" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_reload_configs" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "thresholdAmount" DECIMAL(12,4) NOT NULL DEFAULT 10,
    "reloadAmount" DECIMAL(12,4) NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "auto_reload_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_api_tokens" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "org_api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cli_auth_sessions" (
    "id" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "token" TEXT,
    "orgId" TEXT,
    "orgSlug" TEXT,
    "orgName" TEXT,
    "userName" TEXT,
    "userEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cli_auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "available_models" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "inputPrice" DOUBLE PRECISION NOT NULL,
    "outputPrice" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPlatformDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "available_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "defaultReviewConfig" JSONB NOT NULL DEFAULT '{}',
    "blockedAuthors" JSONB NOT NULL DEFAULT '[]',
    "queueConfig" JSONB NOT NULL DEFAULT '{}',
    "announcements" JSONB NOT NULL DEFAULT '[]',
    "latestRelease" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unsubscribedAt" TIMESTAMP(3),

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_analyses" (
    "id" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "commitHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "results" JSONB,
    "analyzedFiles" JSONB,
    "totalPackages" INTEGER NOT NULL DEFAULT 0,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "highCount" INTEGER NOT NULL DEFAULT 0,
    "mediumCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "repositoryId" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "package_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safe_packages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weeklyDownloads" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "safe_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safe_package_requests" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "safe_package_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_deep_dives" (
    "id" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "version" TEXT,
    "verdict" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" JSONB NOT NULL,
    "recommendation" TEXT NOT NULL,
    "filesAnalyzed" INTEGER NOT NULL DEFAULT 0,
    "totalSize" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "analysisId" TEXT,

    CONSTRAINT "package_deep_dives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_posts" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "content" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_api_tokens" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blog_api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_agents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'offline',
    "lastSeenAt" TIMESTAMP(3),
    "repoFullNames" JSONB NOT NULL DEFAULT '[]',
    "capabilities" JSONB NOT NULL DEFAULT '[]',
    "machineInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organizationId" TEXT NOT NULL,
    "apiTokenId" TEXT NOT NULL,

    CONSTRAINT "local_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_llm_tasks" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "modelId" TEXT NOT NULL,
    "system" TEXT,
    "messages" JSONB NOT NULL,
    "maxTokens" INTEGER NOT NULL,
    "resultText" TEXT,
    "resultUsage" JSONB,
    "errorMessage" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 300000,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "agent_llm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_search_tasks" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "searchType" TEXT NOT NULL DEFAULT 'semantic',
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "resultSummary" TEXT,
    "errorMessage" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "agentId" TEXT,
    "repoFullName" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT,

    CONSTRAINT "agent_search_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ask_octopus_sessions" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "country" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ask_octopus_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ask_octopus_messages" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ask_octopus_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_components" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'operational',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_incidents" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "message" TEXT NOT NULL,
    "componentId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_incident_updates" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "incidentId" TEXT NOT NULL,

    CONSTRAINT "status_incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_api_tokens" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_api_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "organizationId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_type_changes" (
    "id" TEXT NOT NULL,
    "fromType" INTEGER NOT NULL,
    "toType" INTEGER NOT NULL,
    "reason" TEXT,
    "changedById" TEXT,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "org_type_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'transactional',
    "fromName" TEXT NOT NULL DEFAULT 'Octopus',
    "fromEmail" TEXT NOT NULL DEFAULT 'notifications@rs.octopus-review.ai',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "buttonText" TEXT,
    "buttonUrl" TEXT,
    "signatureName" TEXT,
    "signatureTitle" TEXT,
    "variables" TEXT[],
    "system" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_sends" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_devices" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "ipAddress" TEXT,
    "location" TEXT,
    "metadata" JSONB,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "user_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "creditAmount" DECIMAL(12,4) NOT NULL,
    "maxRedemptions" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "redeemedById" TEXT NOT NULL,
    "creditAmount" DECIMAL(12,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_review_jobs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "prNumber" INTEGER,
    "prTitle" TEXT,
    "prAuthor" TEXT,
    "headSha" TEXT,
    "baseBranch" TEXT,
    "diff" TEXT NOT NULL,
    "fileTree" JSONB,
    "githubToken" TEXT,
    "findings" JSONB,
    "summary" TEXT,
    "model" TEXT,
    "indexed" BOOLEAN NOT NULL DEFAULT false,
    "firstCommunityReview" BOOLEAN NOT NULL DEFAULT false,
    "usage" JSONB,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_review_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_githubInstallationId_key" ON "organizations"("githubInstallationId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_stripeCustomerId_key" ON "organizations"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_githubMarketplaceAccountId_key" ON "organizations"("githubMarketplaceAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_token_key" ON "organization_invitations"("token");

-- CreateIndex
CREATE INDEX "organization_invitations_organizationId_status_idx" ON "organization_invitations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "organization_invitations_token_idx" ON "organization_invitations"("token");

-- CreateIndex
CREATE INDEX "repositories_organizationId_isActive_idx" ON "repositories"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "repositories_organizationId_name_idx" ON "repositories"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_provider_externalId_organizationId_key" ON "repositories"("provider", "externalId", "organizationId");

-- CreateIndex
CREATE INDEX "repo_config_extractions_repositoryId_createdAt_idx" ON "repo_config_extractions"("repositoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "repo_config_extractions_repositoryId_contentHash_key" ON "repo_config_extractions"("repositoryId", "contentHash");

-- CreateIndex
CREATE INDEX "pull_requests_repositoryId_status_idx" ON "pull_requests"("repositoryId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pull_requests_repositoryId_number_key" ON "pull_requests"("repositoryId", "number");

-- CreateIndex
CREATE INDEX "review_issues_pullRequestId_idx" ON "review_issues"("pullRequestId");

-- CreateIndex
CREATE INDEX "review_issues_pullRequestId_signature_idx" ON "review_issues"("pullRequestId", "signature");

-- CreateIndex
CREATE INDEX "knowledge_documents_organizationId_status_deletedAt_idx" ON "knowledge_documents"("organizationId", "status", "deletedAt");

-- CreateIndex
CREATE INDEX "knowledge_documents_organizationId_alwaysInclude_deletedAt_idx" ON "knowledge_documents"("organizationId", "alwaysInclude", "deletedAt");

-- CreateIndex
CREATE INDEX "knowledge_audit_logs_documentId_idx" ON "knowledge_audit_logs"("documentId");

-- CreateIndex
CREATE INDEX "knowledge_audit_logs_organizationId_createdAt_idx" ON "knowledge_audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "chat_conversations_userId_organizationId_idx" ON "chat_conversations"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "chat_conversations_organizationId_isShared_idx" ON "chat_conversations"("organizationId", "isShared");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_idx" ON "chat_messages"("conversationId");

-- CreateIndex
CREATE INDEX "chat_queue_conversationId_status_idx" ON "chat_queue"("conversationId", "status");

-- CreateIndex
CREATE INDEX "email_notification_preferences_memberId_idx" ON "email_notification_preferences"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "email_notification_preferences_memberId_eventType_key" ON "email_notification_preferences"("memberId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "slack_integrations_organizationId_key" ON "slack_integrations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "slack_event_configs_slackIntegrationId_eventType_key" ON "slack_event_configs"("slackIntegrationId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "bitbucket_integrations_organizationId_key" ON "bitbucket_integrations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "gitlab_integrations_organizationId_key" ON "gitlab_integrations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "collab_integrations_organizationId_key" ON "collab_integrations"("organizationId");

-- CreateIndex
CREATE INDEX "ai_usages_organizationId_createdAt_idx" ON "ai_usages"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usages_createdAt_idx" ON "ai_usages"("createdAt");

-- CreateIndex
CREATE INDEX "ai_usages_usedOwnKey_createdAt_idx" ON "ai_usages"("usedOwnKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "collab_project_mappings_collabIntegrationId_repositoryId_key" ON "collab_project_mappings"("collabIntegrationId", "repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "linear_integrations_organizationId_key" ON "linear_integrations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "linear_team_mappings_linearIntegrationId_repositoryId_key" ON "linear_team_mappings"("linearIntegrationId", "repositoryId");

-- CreateIndex
CREATE UNIQUE INDEX "jira_integrations_organizationId_key" ON "jira_integrations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "jira_project_mappings_jiraIntegrationId_repositoryId_key" ON "jira_project_mappings"("jiraIntegrationId", "repositoryId");

-- CreateIndex
CREATE INDEX "favorite_repositories_userId_idx" ON "favorite_repositories"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_repositories_userId_repositoryId_key" ON "favorite_repositories"("userId", "repositoryId");

-- CreateIndex
CREATE INDEX "day_summaries_organizationId_date_idx" ON "day_summaries"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "day_summaries_organizationId_date_key" ON "day_summaries"("organizationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "credit_transactions_stripeSessionId_key" ON "credit_transactions"("stripeSessionId");

-- CreateIndex
CREATE INDEX "credit_transactions_organizationId_createdAt_idx" ON "credit_transactions"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "auto_reload_configs_organizationId_key" ON "auto_reload_configs"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "org_api_tokens_tokenHash_key" ON "org_api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "org_api_tokens_tokenHash_idx" ON "org_api_tokens"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "cli_auth_sessions_deviceCode_key" ON "cli_auth_sessions"("deviceCode");

-- CreateIndex
CREATE INDEX "cli_auth_sessions_deviceCode_idx" ON "cli_auth_sessions"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "available_models_modelId_key" ON "available_models"("modelId");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");

-- CreateIndex
CREATE INDEX "package_analyses_organizationId_createdAt_idx" ON "package_analyses"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "package_analyses_repositoryId_commitHash_idx" ON "package_analyses"("repositoryId", "commitHash");

-- CreateIndex
CREATE UNIQUE INDEX "safe_packages_name_key" ON "safe_packages"("name");

-- CreateIndex
CREATE INDEX "safe_package_requests_status_idx" ON "safe_package_requests"("status");

-- CreateIndex
CREATE INDEX "safe_package_requests_organizationId_idx" ON "safe_package_requests"("organizationId");

-- CreateIndex
CREATE INDEX "package_deep_dives_packageName_version_idx" ON "package_deep_dives"("packageName", "version");

-- CreateIndex
CREATE INDEX "package_deep_dives_organizationId_createdAt_idx" ON "package_deep_dives"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "package_deep_dives_analysisId_idx" ON "package_deep_dives"("analysisId");

-- CreateIndex
CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX "blog_posts_status_publishedAt_idx" ON "blog_posts"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "blog_api_tokens_tokenHash_key" ON "blog_api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "blog_api_tokens_tokenHash_idx" ON "blog_api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "local_agents_organizationId_status_idx" ON "local_agents"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "local_agents_organizationId_name_key" ON "local_agents"("organizationId", "name");

-- CreateIndex
CREATE INDEX "agent_llm_tasks_organizationId_status_idx" ON "agent_llm_tasks"("organizationId", "status");

-- CreateIndex
CREATE INDEX "agent_llm_tasks_agentId_status_idx" ON "agent_llm_tasks"("agentId", "status");

-- CreateIndex
CREATE INDEX "agent_search_tasks_organizationId_status_idx" ON "agent_search_tasks"("organizationId", "status");

-- CreateIndex
CREATE INDEX "agent_search_tasks_agentId_status_idx" ON "agent_search_tasks"("agentId", "status");

-- CreateIndex
CREATE INDEX "agent_search_tasks_repoFullName_status_idx" ON "agent_search_tasks"("repoFullName", "status");

-- CreateIndex
CREATE INDEX "ask_octopus_sessions_fingerprint_idx" ON "ask_octopus_sessions"("fingerprint");

-- CreateIndex
CREATE INDEX "ask_octopus_sessions_ipAddress_idx" ON "ask_octopus_sessions"("ipAddress");

-- CreateIndex
CREATE INDEX "ask_octopus_sessions_flagged_idx" ON "ask_octopus_sessions"("flagged");

-- CreateIndex
CREATE INDEX "ask_octopus_sessions_createdAt_idx" ON "ask_octopus_sessions"("createdAt");

-- CreateIndex
CREATE INDEX "ask_octopus_messages_sessionId_idx" ON "ask_octopus_messages"("sessionId");

-- CreateIndex
CREATE INDEX "ask_octopus_messages_createdAt_idx" ON "ask_octopus_messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "status_components_name_key" ON "status_components"("name");

-- CreateIndex
CREATE INDEX "status_components_sortOrder_idx" ON "status_components"("sortOrder");

-- CreateIndex
CREATE INDEX "status_incidents_status_createdAt_idx" ON "status_incidents"("status", "createdAt");

-- CreateIndex
CREATE INDEX "status_incidents_componentId_idx" ON "status_incidents"("componentId");

-- CreateIndex
CREATE INDEX "status_incident_updates_incidentId_idx" ON "status_incident_updates"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "status_api_tokens_tokenHash_key" ON "status_api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "status_api_tokens_tokenHash_idx" ON "status_api_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "audit_logs_category_createdAt_idx" ON "audit_logs"("category", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "org_type_changes_organizationId_createdAt_idx" ON "org_type_changes"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_slug_key" ON "email_templates"("slug");

-- CreateIndex
CREATE INDEX "email_sends_slug_userId_sentAt_idx" ON "email_sends"("slug", "userId", "sentAt");

-- CreateIndex
CREATE INDEX "email_sends_userId_idx" ON "email_sends"("userId");

-- CreateIndex
CREATE INDEX "user_devices_userId_idx" ON "user_devices"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_devices_userId_fingerprint_key" ON "user_devices"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_code_idx" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupon_redemptions_organizationId_idx" ON "coupon_redemptions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_couponId_organizationId_key" ON "coupon_redemptions"("couponId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_couponId_redeemedById_key" ON "coupon_redemptions"("couponId", "redeemedById");

-- CreateIndex
CREATE INDEX "community_review_jobs_repositoryId_status_idx" ON "community_review_jobs"("repositoryId", "status");

-- CreateIndex
CREATE INDEX "community_review_jobs_status_createdAt_idx" ON "community_review_jobs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "community_review_jobs_expiresAt_idx" ON "community_review_jobs"("expiresAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_config_extractions" ADD CONSTRAINT "repo_config_extractions_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_issues" ADD CONSTRAINT "review_issues_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_audit_logs" ADD CONSTRAINT "knowledge_audit_logs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_audit_logs" ADD CONSTRAINT "knowledge_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_audit_logs" ADD CONSTRAINT "knowledge_audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_queue" ADD CONSTRAINT "chat_queue_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_notification_preferences" ADD CONSTRAINT "email_notification_preferences_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_event_configs" ADD CONSTRAINT "slack_event_configs_slackIntegrationId_fkey" FOREIGN KEY ("slackIntegrationId") REFERENCES "slack_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bitbucket_integrations" ADD CONSTRAINT "bitbucket_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gitlab_integrations" ADD CONSTRAINT "gitlab_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_integrations" ADD CONSTRAINT "collab_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usages" ADD CONSTRAINT "ai_usages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_project_mappings" ADD CONSTRAINT "collab_project_mappings_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collab_project_mappings" ADD CONSTRAINT "collab_project_mappings_collabIntegrationId_fkey" FOREIGN KEY ("collabIntegrationId") REFERENCES "collab_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linear_integrations" ADD CONSTRAINT "linear_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linear_team_mappings" ADD CONSTRAINT "linear_team_mappings_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linear_team_mappings" ADD CONSTRAINT "linear_team_mappings_linearIntegrationId_fkey" FOREIGN KEY ("linearIntegrationId") REFERENCES "linear_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jira_integrations" ADD CONSTRAINT "jira_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jira_project_mappings" ADD CONSTRAINT "jira_project_mappings_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jira_project_mappings" ADD CONSTRAINT "jira_project_mappings_jiraIntegrationId_fkey" FOREIGN KEY ("jiraIntegrationId") REFERENCES "jira_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_repositories" ADD CONSTRAINT "favorite_repositories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_repositories" ADD CONSTRAINT "favorite_repositories_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_summaries" ADD CONSTRAINT "day_summaries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auto_reload_configs" ADD CONSTRAINT "auto_reload_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_api_tokens" ADD CONSTRAINT "org_api_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_api_tokens" ADD CONSTRAINT "org_api_tokens_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_analyses" ADD CONSTRAINT "package_analyses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_analyses" ADD CONSTRAINT "package_analyses_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_analyses" ADD CONSTRAINT "package_analyses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safe_package_requests" ADD CONSTRAINT "safe_package_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safe_package_requests" ADD CONSTRAINT "safe_package_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_deep_dives" ADD CONSTRAINT "package_deep_dives_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_deep_dives" ADD CONSTRAINT "package_deep_dives_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_deep_dives" ADD CONSTRAINT "package_deep_dives_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "package_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_agents" ADD CONSTRAINT "local_agents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "local_agents" ADD CONSTRAINT "local_agents_apiTokenId_fkey" FOREIGN KEY ("apiTokenId") REFERENCES "org_api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_llm_tasks" ADD CONSTRAINT "agent_llm_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "local_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_llm_tasks" ADD CONSTRAINT "agent_llm_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_search_tasks" ADD CONSTRAINT "agent_search_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "local_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_search_tasks" ADD CONSTRAINT "agent_search_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ask_octopus_messages" ADD CONSTRAINT "ask_octopus_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ask_octopus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_incidents" ADD CONSTRAINT "status_incidents_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "status_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_incident_updates" ADD CONSTRAINT "status_incident_updates_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "status_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "org_type_changes" ADD CONSTRAINT "org_type_changes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
