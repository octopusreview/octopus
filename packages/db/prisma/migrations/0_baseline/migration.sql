--
-- PostgreSQL database dump
--


-- Dumped from database version 17.8
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp(3) without time zone,
    "refreshTokenExpiresAt" timestamp(3) without time zone,
    scope text,
    password text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: agent_search_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_search_tasks (
    id text NOT NULL,
    query text NOT NULL,
    "searchType" text DEFAULT 'semantic'::text NOT NULL,
    params jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    result jsonb,
    "resultSummary" text,
    "errorMessage" text,
    "timeoutMs" integer DEFAULT 10000 NOT NULL,
    "claimedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "agentId" text,
    "repoFullName" text NOT NULL,
    "organizationId" text NOT NULL,
    "conversationId" text
);


--
-- Name: ai_usages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usages (
    id text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    operation text NOT NULL,
    "inputTokens" integer NOT NULL,
    "outputTokens" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "organizationId" text NOT NULL,
    "cacheReadTokens" integer DEFAULT 0 NOT NULL,
    "cacheWriteTokens" integer DEFAULT 0 NOT NULL,
    "usedOwnKey" boolean DEFAULT false NOT NULL
);


--
-- Name: ask_octopus_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ask_octopus_messages (
    id text NOT NULL,
    "sessionId" text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ask_octopus_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ask_octopus_sessions (
    id text NOT NULL,
    fingerprint text NOT NULL,
    "ipAddress" text NOT NULL,
    "userAgent" text,
    country text,
    flagged boolean DEFAULT false NOT NULL,
    "flagReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id text NOT NULL,
    action text NOT NULL,
    category text NOT NULL,
    "actorId" text,
    "actorEmail" text,
    "targetType" text,
    "targetId" text,
    "organizationId" text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: auto_reload_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_reload_configs (
    id text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    "thresholdAmount" numeric(12,4) DEFAULT 10 NOT NULL,
    "reloadAmount" numeric(12,4) DEFAULT 50 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL
);


--
-- Name: available_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.available_models (
    id text NOT NULL,
    "modelId" text NOT NULL,
    "displayName" text NOT NULL,
    provider text NOT NULL,
    category text NOT NULL,
    "inputPrice" double precision NOT NULL,
    "outputPrice" double precision NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "isPlatformDefault" boolean DEFAULT false NOT NULL
);


--
-- Name: bitbucket_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bitbucket_integrations (
    id text NOT NULL,
    "workspaceSlug" text NOT NULL,
    "workspaceName" text NOT NULL,
    "accessToken" text NOT NULL,
    "refreshToken" text NOT NULL,
    "tokenExpiresAt" timestamp(3) without time zone NOT NULL,
    scopes text,
    "webhookUuid" text,
    "webhookSecret" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL
);


--
-- Name: blog_api_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blog_api_tokens (
    id text NOT NULL,
    name text NOT NULL,
    "tokenHash" text NOT NULL,
    "tokenPrefix" text NOT NULL,
    "lastUsedAt" timestamp(3) without time zone,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: blog_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blog_posts (
    id text NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    excerpt text,
    content text NOT NULL,
    "coverImageUrl" text,
    status text DEFAULT 'draft'::text NOT NULL,
    "publishedAt" timestamp(3) without time zone,
    "authorId" text NOT NULL,
    "authorName" text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: chat_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_conversations (
    id text NOT NULL,
    title text DEFAULT 'New Chat'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "userId" text NOT NULL,
    "organizationId" text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "isShared" boolean DEFAULT false NOT NULL,
    "sharedAt" timestamp(3) without time zone,
    "sharedById" text
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_messages (
    id text NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "conversationId" text NOT NULL,
    "userId" text,
    "userName" text
);


--
-- Name: chat_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chat_queue (
    id text NOT NULL,
    "conversationId" text NOT NULL,
    "userId" text NOT NULL,
    "userName" text NOT NULL,
    content text NOT NULL,
    status text DEFAULT 'waiting'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "startedAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone
);


--
-- Name: cli_auth_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cli_auth_sessions (
    id text NOT NULL,
    "deviceCode" text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    token text,
    "orgId" text,
    "orgSlug" text,
    "orgName" text,
    "userName" text,
    "userEmail" text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: collab_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collab_integrations (
    id text NOT NULL,
    "apiKey" text NOT NULL,
    "baseUrl" text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL,
    "workspaceId" text,
    "workspaceName" text
);


--
-- Name: collab_project_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.collab_project_mappings (
    id text NOT NULL,
    "collabProjectId" text NOT NULL,
    "collabProjectName" text NOT NULL,
    "repositoryId" text NOT NULL,
    "collabIntegrationId" text NOT NULL
);


--
-- Name: credit_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.credit_transactions (
    id text NOT NULL,
    amount numeric(12,4) NOT NULL,
    type text NOT NULL,
    description text,
    "stripeSessionId" text,
    "balanceAfter" numeric(12,4) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "organizationId" text NOT NULL,
    "receiptUrl" text
);


--
-- Name: day_summaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_summaries (
    id text NOT NULL,
    date text NOT NULL,
    summary text NOT NULL,
    "prCount" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL
);


--
-- Name: email_notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_notification_preferences (
    id text NOT NULL,
    "eventType" text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    "memberId" text NOT NULL
);


--
-- Name: email_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_sends (
    id text NOT NULL,
    slug text NOT NULL,
    "userId" text NOT NULL,
    "sentAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id text NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    "fromName" text DEFAULT 'Octopus'::text NOT NULL,
    "fromEmail" text DEFAULT 'notifications@rs.octopus-review.ai'::text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    "buttonText" text,
    "buttonUrl" text,
    variables text[],
    enabled boolean DEFAULT true NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "signatureName" text,
    "signatureTitle" text,
    category text DEFAULT 'transactional'::text NOT NULL,
    system boolean DEFAULT false NOT NULL
);


--
-- Name: favorite_repositories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.favorite_repositories (
    id text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "userId" text NOT NULL,
    "repositoryId" text NOT NULL
);


--
-- Name: knowledge_audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_audit_logs (
    id text NOT NULL,
    action text NOT NULL,
    details text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "documentId" text NOT NULL,
    "userId" text NOT NULL,
    "organizationId" text NOT NULL
);


--
-- Name: knowledge_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_documents (
    id text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    "sourceType" text DEFAULT 'paste'::text NOT NULL,
    "fileName" text,
    status text DEFAULT 'processing'::text NOT NULL,
    "errorMessage" text,
    "totalChunks" integer DEFAULT 0 NOT NULL,
    "totalVectors" integer DEFAULT 0 NOT NULL,
    "processingMs" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "deletedById" text,
    "templateId" text
);


--
-- Name: linear_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.linear_integrations (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "accessToken" text NOT NULL,
    "workspaceId" text NOT NULL,
    "workspaceName" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: linear_team_mappings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.linear_team_mappings (
    id text NOT NULL,
    "linearTeamId" text NOT NULL,
    "linearTeamName" text NOT NULL,
    "linearTeamKey" text NOT NULL,
    "repositoryId" text NOT NULL,
    "linearIntegrationId" text NOT NULL
);


--
-- Name: local_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.local_agents (
    id text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'offline'::text NOT NULL,
    "lastSeenAt" timestamp(3) without time zone,
    "repoFullNames" jsonb DEFAULT '[]'::jsonb NOT NULL,
    capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    "machineInfo" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL,
    "apiTokenId" text NOT NULL
);


--
-- Name: newsletter_subscribers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.newsletter_subscribers (
    id text NOT NULL,
    email text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "unsubscribedAt" timestamp(3) without time zone
);


--
-- Name: org_api_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_api_tokens (
    id text NOT NULL,
    name text NOT NULL,
    "tokenHash" text NOT NULL,
    "tokenPrefix" text NOT NULL,
    "lastUsedAt" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "organizationId" text NOT NULL,
    "createdById" text NOT NULL
);


--
-- Name: org_type_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_type_changes (
    id text NOT NULL,
    "fromType" integer NOT NULL,
    "toType" integer NOT NULL,
    reason text,
    "changedById" text,
    "organizationId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: organization_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_invitations (
    id text NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    token text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL,
    "invitedById" text NOT NULL
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "removedById" text
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    "avatarUrl" text,
    "githubInstallationId" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "anthropicApiKey" text,
    "openaiApiKey" text,
    "needsPermissionGrant" boolean DEFAULT false NOT NULL,
    "bannedAt" timestamp(3) without time zone,
    "bannedReason" text,
    "defaultEmbedModelId" text,
    "defaultModelId" text,
    "monthlySpendLimitUsd" double precision DEFAULT 150,
    "deletedAt" timestamp(3) without time zone,
    "checkFailureThreshold" text DEFAULT 'critical'::text NOT NULL,
    "billingEmail" text,
    "creditBalance" numeric(12,4) DEFAULT 0 NOT NULL,
    "freeCreditBalance" numeric(12,4) DEFAULT 150 NOT NULL,
    "stripeCustomerId" text,
    "cohereApiKey" text,
    "googleApiKey" text,
    "reviewsPaused" boolean DEFAULT false NOT NULL,
    "defaultReviewConfig" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "blockedAuthors" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "githubMarketplaceAccountId" integer,
    "githubMarketplaceFreeTrialEndsOn" timestamp(3) without time zone,
    "githubMarketplaceOnFreeTrial" boolean DEFAULT false NOT NULL,
    "githubMarketplacePlanId" integer,
    "githubMarketplacePlanName" text,
    "communityDailyReviewLimit" integer DEFAULT 5 NOT NULL,
    type integer DEFAULT 1 NOT NULL
);


--
-- Name: package_analyses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.package_analyses (
    id text NOT NULL,
    "repoUrl" text NOT NULL,
    "repoName" text NOT NULL,
    "commitHash" text,
    status text DEFAULT 'running'::text NOT NULL,
    results jsonb,
    "analyzedFiles" jsonb,
    "totalPackages" integer DEFAULT 0 NOT NULL,
    "criticalCount" integer DEFAULT 0 NOT NULL,
    "highCount" integer DEFAULT 0 NOT NULL,
    "mediumCount" integer DEFAULT 0 NOT NULL,
    "durationMs" integer,
    "errorMessage" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "organizationId" text NOT NULL,
    "repositoryId" text,
    "userId" text NOT NULL
);


--
-- Name: package_deep_dives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.package_deep_dives (
    id text NOT NULL,
    "packageName" text NOT NULL,
    version text,
    verdict text NOT NULL,
    confidence text NOT NULL,
    summary text NOT NULL,
    findings jsonb NOT NULL,
    recommendation text NOT NULL,
    "filesAnalyzed" integer DEFAULT 0 NOT NULL,
    "totalSize" integer DEFAULT 0 NOT NULL,
    model text,
    "inputTokens" integer DEFAULT 0 NOT NULL,
    "outputTokens" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL,
    "analysisId" text
);


--
-- Name: pull_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pull_requests (
    id text NOT NULL,
    number integer NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    author text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    "triggerCommentId" bigint NOT NULL,
    "triggerCommentBody" text NOT NULL,
    "reviewBody" text,
    "errorMessage" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "repositoryId" text NOT NULL,
    "reviewCommentId" bigint,
    "headSha" text,
    "mergedAt" timestamp(3) without time zone
);


--
-- Name: repositories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.repositories (
    id text NOT NULL,
    name text NOT NULL,
    "fullName" text NOT NULL,
    provider text DEFAULT 'github'::text NOT NULL,
    "externalId" text NOT NULL,
    "defaultBranch" text DEFAULT 'main'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "indexStatus" text DEFAULT 'pending'::text NOT NULL,
    "indexedAt" timestamp(3) without time zone,
    "indexedFiles" integer DEFAULT 0 NOT NULL,
    "totalFiles" integer DEFAULT 0 NOT NULL,
    "totalChunks" integer DEFAULT 0 NOT NULL,
    "totalVectors" integer DEFAULT 0 NOT NULL,
    "indexDurationMs" integer,
    summary text,
    purpose text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL,
    analysis text,
    "analysisStatus" text DEFAULT 'none'::text NOT NULL,
    "analyzedAt" timestamp(3) without time zone,
    "contributorCount" integer DEFAULT 0 NOT NULL,
    "autoReview" boolean DEFAULT true NOT NULL,
    contributors jsonb DEFAULT '[]'::jsonb NOT NULL,
    "installationId" integer,
    "embedModelId" text,
    "reviewModelId" text,
    "reviewConfig" jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: review_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_issues (
    id text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    "filePath" text,
    "lineNumber" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "pullRequestId" text NOT NULL,
    "acknowledgedAt" timestamp(3) without time zone,
    "linearIssueId" text,
    "linearIssueUrl" text,
    "githubIssueNumber" integer,
    "githubIssueUrl" text,
    feedback text,
    "feedbackAt" timestamp(3) without time zone,
    "feedbackBy" text,
    "githubCommentId" bigint,
    confidence text
);


--
-- Name: safe_package_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safe_package_requests (
    id text NOT NULL,
    name text NOT NULL,
    version text,
    reason text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    "reviewedBy" text,
    "reviewNote" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "reviewedAt" timestamp(3) without time zone,
    "organizationId" text NOT NULL,
    "userId" text NOT NULL
);


--
-- Name: safe_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.safe_packages (
    id text NOT NULL,
    name text NOT NULL,
    "weeklyDownloads" integer DEFAULT 0 NOT NULL,
    reason text,
    "approvedBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);


--
-- Name: slack_event_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slack_event_configs (
    id text NOT NULL,
    "eventType" text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "slackIntegrationId" text NOT NULL
);


--
-- Name: slack_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slack_integrations (
    id text NOT NULL,
    "teamId" text NOT NULL,
    "teamName" text NOT NULL,
    "accessToken" text NOT NULL,
    "botUserId" text,
    "channelId" text,
    "channelName" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "organizationId" text NOT NULL
);


--
-- Name: status_api_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_api_tokens (
    id text NOT NULL,
    name text NOT NULL,
    "tokenHash" text NOT NULL,
    "tokenPrefix" text NOT NULL,
    "lastUsedAt" timestamp(3) without time zone,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: status_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_components (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    status text DEFAULT 'operational'::text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isVisible" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: status_incident_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_incident_updates (
    id text NOT NULL,
    status text NOT NULL,
    message text NOT NULL,
    "createdById" text,
    "createdByName" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "incidentId" text NOT NULL
);


--
-- Name: status_incidents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.status_incidents (
    id text NOT NULL,
    title text NOT NULL,
    severity text NOT NULL,
    status text DEFAULT 'investigating'::text NOT NULL,
    message text NOT NULL,
    "componentId" text,
    "resolvedAt" timestamp(3) without time zone,
    "createdById" text,
    "createdByName" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: system_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_config (
    id text DEFAULT 'singleton'::text NOT NULL,
    "defaultReviewConfig" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "blockedAuthors" jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: user_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_devices (
    id text NOT NULL,
    fingerprint text NOT NULL,
    browser text NOT NULL,
    "ipAddress" text,
    location text,
    "lastSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "userId" text NOT NULL,
    metadata jsonb
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean DEFAULT false NOT NULL,
    image text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "onboardingCompleted" boolean DEFAULT false NOT NULL,
    "onboardingStep" integer DEFAULT 0 NOT NULL,
    "bannedAt" timestamp(3) without time zone,
    "bannedReason" text,
    "welcomeEmailSentAt" timestamp(3) without time zone,
    "marketingEmailsEnabled" boolean DEFAULT true NOT NULL
);


--
-- Name: verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verifications (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" timestamp(3) without time zone
);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: agent_search_tasks agent_search_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_search_tasks
    ADD CONSTRAINT agent_search_tasks_pkey PRIMARY KEY (id);


--
-- Name: ai_usages ai_usages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usages
    ADD CONSTRAINT ai_usages_pkey PRIMARY KEY (id);


--
-- Name: ask_octopus_messages ask_octopus_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ask_octopus_messages
    ADD CONSTRAINT ask_octopus_messages_pkey PRIMARY KEY (id);


--
-- Name: ask_octopus_sessions ask_octopus_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ask_octopus_sessions
    ADD CONSTRAINT ask_octopus_sessions_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: auto_reload_configs auto_reload_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_reload_configs
    ADD CONSTRAINT auto_reload_configs_pkey PRIMARY KEY (id);


--
-- Name: available_models available_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.available_models
    ADD CONSTRAINT available_models_pkey PRIMARY KEY (id);


--
-- Name: bitbucket_integrations bitbucket_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitbucket_integrations
    ADD CONSTRAINT bitbucket_integrations_pkey PRIMARY KEY (id);


--
-- Name: blog_api_tokens blog_api_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blog_api_tokens
    ADD CONSTRAINT blog_api_tokens_pkey PRIMARY KEY (id);


--
-- Name: blog_posts blog_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_pkey PRIMARY KEY (id);


--
-- Name: chat_conversations chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_queue chat_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_queue
    ADD CONSTRAINT chat_queue_pkey PRIMARY KEY (id);


--
-- Name: cli_auth_sessions cli_auth_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cli_auth_sessions
    ADD CONSTRAINT cli_auth_sessions_pkey PRIMARY KEY (id);


--
-- Name: collab_integrations collab_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_integrations
    ADD CONSTRAINT collab_integrations_pkey PRIMARY KEY (id);


--
-- Name: collab_project_mappings collab_project_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_project_mappings
    ADD CONSTRAINT collab_project_mappings_pkey PRIMARY KEY (id);


--
-- Name: credit_transactions credit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);


--
-- Name: day_summaries day_summaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_summaries
    ADD CONSTRAINT day_summaries_pkey PRIMARY KEY (id);


--
-- Name: email_notification_preferences email_notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_notification_preferences
    ADD CONSTRAINT email_notification_preferences_pkey PRIMARY KEY (id);


--
-- Name: email_sends email_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sends
    ADD CONSTRAINT email_sends_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: favorite_repositories favorite_repositories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorite_repositories
    ADD CONSTRAINT favorite_repositories_pkey PRIMARY KEY (id);


--
-- Name: knowledge_audit_logs knowledge_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_audit_logs
    ADD CONSTRAINT knowledge_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: knowledge_documents knowledge_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_pkey PRIMARY KEY (id);


--
-- Name: linear_integrations linear_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linear_integrations
    ADD CONSTRAINT linear_integrations_pkey PRIMARY KEY (id);


--
-- Name: linear_team_mappings linear_team_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linear_team_mappings
    ADD CONSTRAINT linear_team_mappings_pkey PRIMARY KEY (id);


--
-- Name: local_agents local_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_agents
    ADD CONSTRAINT local_agents_pkey PRIMARY KEY (id);


--
-- Name: newsletter_subscribers newsletter_subscribers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.newsletter_subscribers
    ADD CONSTRAINT newsletter_subscribers_pkey PRIMARY KEY (id);


--
-- Name: org_api_tokens org_api_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_api_tokens
    ADD CONSTRAINT org_api_tokens_pkey PRIMARY KEY (id);


--
-- Name: org_type_changes org_type_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_type_changes
    ADD CONSTRAINT org_type_changes_pkey PRIMARY KEY (id);


--
-- Name: organization_invitations organization_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT organization_invitations_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: package_analyses package_analyses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_analyses
    ADD CONSTRAINT package_analyses_pkey PRIMARY KEY (id);


--
-- Name: package_deep_dives package_deep_dives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_deep_dives
    ADD CONSTRAINT package_deep_dives_pkey PRIMARY KEY (id);


--
-- Name: pull_requests pull_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pull_requests
    ADD CONSTRAINT pull_requests_pkey PRIMARY KEY (id);


--
-- Name: repositories repositories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repositories
    ADD CONSTRAINT repositories_pkey PRIMARY KEY (id);


--
-- Name: review_issues review_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_issues
    ADD CONSTRAINT review_issues_pkey PRIMARY KEY (id);


--
-- Name: safe_package_requests safe_package_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safe_package_requests
    ADD CONSTRAINT safe_package_requests_pkey PRIMARY KEY (id);


--
-- Name: safe_packages safe_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safe_packages
    ADD CONSTRAINT safe_packages_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: slack_event_configs slack_event_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slack_event_configs
    ADD CONSTRAINT slack_event_configs_pkey PRIMARY KEY (id);


--
-- Name: slack_integrations slack_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slack_integrations
    ADD CONSTRAINT slack_integrations_pkey PRIMARY KEY (id);


--
-- Name: status_api_tokens status_api_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_api_tokens
    ADD CONSTRAINT status_api_tokens_pkey PRIMARY KEY (id);


--
-- Name: status_components status_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_components
    ADD CONSTRAINT status_components_pkey PRIMARY KEY (id);


--
-- Name: status_incident_updates status_incident_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_incident_updates
    ADD CONSTRAINT status_incident_updates_pkey PRIMARY KEY (id);


--
-- Name: status_incidents status_incidents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_incidents
    ADD CONSTRAINT status_incidents_pkey PRIMARY KEY (id);


--
-- Name: system_config system_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_config
    ADD CONSTRAINT system_config_pkey PRIMARY KEY (id);


--
-- Name: user_devices user_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT user_devices_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verifications verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verifications
    ADD CONSTRAINT verifications_pkey PRIMARY KEY (id);


--
-- Name: agent_search_tasks_agentId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_search_tasks_agentId_status_idx" ON public.agent_search_tasks USING btree ("agentId", status);


--
-- Name: agent_search_tasks_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_search_tasks_organizationId_status_idx" ON public.agent_search_tasks USING btree ("organizationId", status);


--
-- Name: agent_search_tasks_repoFullName_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "agent_search_tasks_repoFullName_status_idx" ON public.agent_search_tasks USING btree ("repoFullName", status);


--
-- Name: ai_usages_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_usages_createdAt_idx" ON public.ai_usages USING btree ("createdAt");


--
-- Name: ai_usages_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_usages_organizationId_createdAt_idx" ON public.ai_usages USING btree ("organizationId", "createdAt");


--
-- Name: ai_usages_usedOwnKey_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ai_usages_usedOwnKey_createdAt_idx" ON public.ai_usages USING btree ("usedOwnKey", "createdAt");


--
-- Name: ask_octopus_messages_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ask_octopus_messages_createdAt_idx" ON public.ask_octopus_messages USING btree ("createdAt");


--
-- Name: ask_octopus_messages_sessionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ask_octopus_messages_sessionId_idx" ON public.ask_octopus_messages USING btree ("sessionId");


--
-- Name: ask_octopus_sessions_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ask_octopus_sessions_createdAt_idx" ON public.ask_octopus_sessions USING btree ("createdAt");


--
-- Name: ask_octopus_sessions_fingerprint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ask_octopus_sessions_fingerprint_idx ON public.ask_octopus_sessions USING btree (fingerprint);


--
-- Name: ask_octopus_sessions_flagged_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ask_octopus_sessions_flagged_idx ON public.ask_octopus_sessions USING btree (flagged);


--
-- Name: ask_octopus_sessions_ipAddress_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ask_octopus_sessions_ipAddress_idx" ON public.ask_octopus_sessions USING btree ("ipAddress");


--
-- Name: audit_logs_action_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_action_createdAt_idx" ON public.audit_logs USING btree (action, "createdAt");


--
-- Name: audit_logs_actorId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_actorId_createdAt_idx" ON public.audit_logs USING btree ("actorId", "createdAt");


--
-- Name: audit_logs_category_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_category_createdAt_idx" ON public.audit_logs USING btree (category, "createdAt");


--
-- Name: audit_logs_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_createdAt_idx" ON public.audit_logs USING btree ("createdAt");


--
-- Name: audit_logs_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON public.audit_logs USING btree ("organizationId", "createdAt");


--
-- Name: auto_reload_configs_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "auto_reload_configs_organizationId_key" ON public.auto_reload_configs USING btree ("organizationId");


--
-- Name: available_models_modelId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "available_models_modelId_key" ON public.available_models USING btree ("modelId");


--
-- Name: bitbucket_integrations_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "bitbucket_integrations_organizationId_key" ON public.bitbucket_integrations USING btree ("organizationId");


--
-- Name: blog_api_tokens_tokenHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "blog_api_tokens_tokenHash_idx" ON public.blog_api_tokens USING btree ("tokenHash");


--
-- Name: blog_api_tokens_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "blog_api_tokens_tokenHash_key" ON public.blog_api_tokens USING btree ("tokenHash");


--
-- Name: blog_posts_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX blog_posts_slug_key ON public.blog_posts USING btree (slug);


--
-- Name: blog_posts_status_publishedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "blog_posts_status_publishedAt_idx" ON public.blog_posts USING btree (status, "publishedAt");


--
-- Name: chat_conversations_organizationId_isShared_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_conversations_organizationId_isShared_idx" ON public.chat_conversations USING btree ("organizationId", "isShared");


--
-- Name: chat_conversations_userId_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_conversations_userId_organizationId_idx" ON public.chat_conversations USING btree ("userId", "organizationId");


--
-- Name: chat_messages_conversationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_messages_conversationId_idx" ON public.chat_messages USING btree ("conversationId");


--
-- Name: chat_queue_conversationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "chat_queue_conversationId_status_idx" ON public.chat_queue USING btree ("conversationId", status);


--
-- Name: cli_auth_sessions_deviceCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "cli_auth_sessions_deviceCode_idx" ON public.cli_auth_sessions USING btree ("deviceCode");


--
-- Name: cli_auth_sessions_deviceCode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "cli_auth_sessions_deviceCode_key" ON public.cli_auth_sessions USING btree ("deviceCode");


--
-- Name: collab_integrations_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "collab_integrations_organizationId_key" ON public.collab_integrations USING btree ("organizationId");


--
-- Name: collab_project_mappings_collabIntegrationId_repositoryId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "collab_project_mappings_collabIntegrationId_repositoryId_key" ON public.collab_project_mappings USING btree ("collabIntegrationId", "repositoryId");


--
-- Name: credit_transactions_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "credit_transactions_organizationId_createdAt_idx" ON public.credit_transactions USING btree ("organizationId", "createdAt");


--
-- Name: credit_transactions_stripeSessionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "credit_transactions_stripeSessionId_key" ON public.credit_transactions USING btree ("stripeSessionId");


--
-- Name: day_summaries_organizationId_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "day_summaries_organizationId_date_idx" ON public.day_summaries USING btree ("organizationId", date);


--
-- Name: day_summaries_organizationId_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "day_summaries_organizationId_date_key" ON public.day_summaries USING btree ("organizationId", date);


--
-- Name: email_notification_preferences_memberId_eventType_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "email_notification_preferences_memberId_eventType_key" ON public.email_notification_preferences USING btree ("memberId", "eventType");


--
-- Name: email_notification_preferences_memberId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "email_notification_preferences_memberId_idx" ON public.email_notification_preferences USING btree ("memberId");


--
-- Name: email_sends_slug_userId_sentAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "email_sends_slug_userId_sentAt_idx" ON public.email_sends USING btree (slug, "userId", "sentAt");


--
-- Name: email_sends_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "email_sends_userId_idx" ON public.email_sends USING btree ("userId");


--
-- Name: email_templates_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX email_templates_slug_key ON public.email_templates USING btree (slug);


--
-- Name: favorite_repositories_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "favorite_repositories_userId_idx" ON public.favorite_repositories USING btree ("userId");


--
-- Name: favorite_repositories_userId_repositoryId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "favorite_repositories_userId_repositoryId_key" ON public.favorite_repositories USING btree ("userId", "repositoryId");


--
-- Name: knowledge_audit_logs_documentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "knowledge_audit_logs_documentId_idx" ON public.knowledge_audit_logs USING btree ("documentId");


--
-- Name: knowledge_audit_logs_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "knowledge_audit_logs_organizationId_createdAt_idx" ON public.knowledge_audit_logs USING btree ("organizationId", "createdAt");


--
-- Name: knowledge_documents_organizationId_status_deletedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "knowledge_documents_organizationId_status_deletedAt_idx" ON public.knowledge_documents USING btree ("organizationId", status, "deletedAt");


--
-- Name: linear_integrations_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "linear_integrations_organizationId_key" ON public.linear_integrations USING btree ("organizationId");


--
-- Name: linear_team_mappings_linearIntegrationId_repositoryId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "linear_team_mappings_linearIntegrationId_repositoryId_key" ON public.linear_team_mappings USING btree ("linearIntegrationId", "repositoryId");


--
-- Name: local_agents_organizationId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "local_agents_organizationId_name_key" ON public.local_agents USING btree ("organizationId", name);


--
-- Name: local_agents_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "local_agents_organizationId_status_idx" ON public.local_agents USING btree ("organizationId", status);


--
-- Name: newsletter_subscribers_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX newsletter_subscribers_email_key ON public.newsletter_subscribers USING btree (email);


--
-- Name: org_api_tokens_tokenHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "org_api_tokens_tokenHash_idx" ON public.org_api_tokens USING btree ("tokenHash");


--
-- Name: org_api_tokens_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "org_api_tokens_tokenHash_key" ON public.org_api_tokens USING btree ("tokenHash");


--
-- Name: org_type_changes_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "org_type_changes_organizationId_createdAt_idx" ON public.org_type_changes USING btree ("organizationId", "createdAt");


--
-- Name: organization_invitations_organizationId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "organization_invitations_organizationId_status_idx" ON public.organization_invitations USING btree ("organizationId", status);


--
-- Name: organization_invitations_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_invitations_token_idx ON public.organization_invitations USING btree (token);


--
-- Name: organization_invitations_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organization_invitations_token_key ON public.organization_invitations USING btree (token);


--
-- Name: organization_members_organizationId_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON public.organization_members USING btree ("organizationId", "userId");


--
-- Name: organizations_githubInstallationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organizations_githubInstallationId_key" ON public.organizations USING btree ("githubInstallationId");


--
-- Name: organizations_githubMarketplaceAccountId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organizations_githubMarketplaceAccountId_key" ON public.organizations USING btree ("githubMarketplaceAccountId");


--
-- Name: organizations_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX organizations_slug_key ON public.organizations USING btree (slug);


--
-- Name: organizations_stripeCustomerId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "organizations_stripeCustomerId_key" ON public.organizations USING btree ("stripeCustomerId");


--
-- Name: package_analyses_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "package_analyses_organizationId_createdAt_idx" ON public.package_analyses USING btree ("organizationId", "createdAt");


--
-- Name: package_analyses_repositoryId_commitHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "package_analyses_repositoryId_commitHash_idx" ON public.package_analyses USING btree ("repositoryId", "commitHash");


--
-- Name: package_deep_dives_analysisId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "package_deep_dives_analysisId_idx" ON public.package_deep_dives USING btree ("analysisId");


--
-- Name: package_deep_dives_organizationId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "package_deep_dives_organizationId_createdAt_idx" ON public.package_deep_dives USING btree ("organizationId", "createdAt");


--
-- Name: package_deep_dives_packageName_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "package_deep_dives_packageName_version_idx" ON public.package_deep_dives USING btree ("packageName", version);


--
-- Name: pull_requests_repositoryId_number_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "pull_requests_repositoryId_number_key" ON public.pull_requests USING btree ("repositoryId", number);


--
-- Name: pull_requests_repositoryId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "pull_requests_repositoryId_status_idx" ON public.pull_requests USING btree ("repositoryId", status);


--
-- Name: repositories_organizationId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "repositories_organizationId_isActive_idx" ON public.repositories USING btree ("organizationId", "isActive");


--
-- Name: repositories_organizationId_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "repositories_organizationId_name_idx" ON public.repositories USING btree ("organizationId", name);


--
-- Name: repositories_provider_externalId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "repositories_provider_externalId_key" ON public.repositories USING btree (provider, "externalId");


--
-- Name: review_issues_pullRequestId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "review_issues_pullRequestId_idx" ON public.review_issues USING btree ("pullRequestId");


--
-- Name: safe_package_requests_organizationId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "safe_package_requests_organizationId_idx" ON public.safe_package_requests USING btree ("organizationId");


--
-- Name: safe_package_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX safe_package_requests_status_idx ON public.safe_package_requests USING btree (status);


--
-- Name: safe_packages_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX safe_packages_name_key ON public.safe_packages USING btree (name);


--
-- Name: sessions_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sessions_token_key ON public.sessions USING btree (token);


--
-- Name: slack_event_configs_slackIntegrationId_eventType_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "slack_event_configs_slackIntegrationId_eventType_key" ON public.slack_event_configs USING btree ("slackIntegrationId", "eventType");


--
-- Name: slack_integrations_organizationId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "slack_integrations_organizationId_key" ON public.slack_integrations USING btree ("organizationId");


--
-- Name: status_api_tokens_tokenHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "status_api_tokens_tokenHash_idx" ON public.status_api_tokens USING btree ("tokenHash");


--
-- Name: status_api_tokens_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "status_api_tokens_tokenHash_key" ON public.status_api_tokens USING btree ("tokenHash");


--
-- Name: status_components_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX status_components_name_key ON public.status_components USING btree (name);


--
-- Name: status_components_sortOrder_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "status_components_sortOrder_idx" ON public.status_components USING btree ("sortOrder");


--
-- Name: status_incident_updates_incidentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "status_incident_updates_incidentId_idx" ON public.status_incident_updates USING btree ("incidentId");


--
-- Name: status_incidents_componentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "status_incidents_componentId_idx" ON public.status_incidents USING btree ("componentId");


--
-- Name: status_incidents_status_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "status_incidents_status_createdAt_idx" ON public.status_incidents USING btree (status, "createdAt");


--
-- Name: user_devices_userId_fingerprint_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "user_devices_userId_fingerprint_key" ON public.user_devices USING btree ("userId", fingerprint);


--
-- Name: user_devices_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "user_devices_userId_idx" ON public.user_devices USING btree ("userId");


--
-- Name: users_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);


--
-- Name: accounts accounts_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: agent_search_tasks agent_search_tasks_agentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_search_tasks
    ADD CONSTRAINT "agent_search_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES public.local_agents(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: agent_search_tasks agent_search_tasks_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_search_tasks
    ADD CONSTRAINT "agent_search_tasks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ai_usages ai_usages_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usages
    ADD CONSTRAINT "ai_usages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ask_octopus_messages ask_octopus_messages_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ask_octopus_messages
    ADD CONSTRAINT "ask_octopus_messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.ask_octopus_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: auto_reload_configs auto_reload_configs_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_reload_configs
    ADD CONSTRAINT "auto_reload_configs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: bitbucket_integrations bitbucket_integrations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bitbucket_integrations
    ADD CONSTRAINT "bitbucket_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_conversations chat_conversations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT "chat_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_conversations chat_conversations_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT "chat_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.chat_conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: chat_queue chat_queue_conversationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_queue
    ADD CONSTRAINT "chat_queue_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES public.chat_conversations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: collab_integrations collab_integrations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_integrations
    ADD CONSTRAINT "collab_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: collab_project_mappings collab_project_mappings_collabIntegrationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_project_mappings
    ADD CONSTRAINT "collab_project_mappings_collabIntegrationId_fkey" FOREIGN KEY ("collabIntegrationId") REFERENCES public.collab_integrations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: collab_project_mappings collab_project_mappings_repositoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.collab_project_mappings
    ADD CONSTRAINT "collab_project_mappings_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES public.repositories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: credit_transactions credit_transactions_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT "credit_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: day_summaries day_summaries_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_summaries
    ADD CONSTRAINT "day_summaries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: email_notification_preferences email_notification_preferences_memberId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_notification_preferences
    ADD CONSTRAINT "email_notification_preferences_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES public.organization_members(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: email_sends email_sends_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sends
    ADD CONSTRAINT "email_sends_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favorite_repositories favorite_repositories_repositoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorite_repositories
    ADD CONSTRAINT "favorite_repositories_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES public.repositories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: favorite_repositories favorite_repositories_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.favorite_repositories
    ADD CONSTRAINT "favorite_repositories_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: knowledge_audit_logs knowledge_audit_logs_documentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_audit_logs
    ADD CONSTRAINT "knowledge_audit_logs_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES public.knowledge_documents(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: knowledge_audit_logs knowledge_audit_logs_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_audit_logs
    ADD CONSTRAINT "knowledge_audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: knowledge_audit_logs knowledge_audit_logs_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_audit_logs
    ADD CONSTRAINT "knowledge_audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: knowledge_documents knowledge_documents_deletedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT "knowledge_documents_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: knowledge_documents knowledge_documents_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT "knowledge_documents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: linear_integrations linear_integrations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linear_integrations
    ADD CONSTRAINT "linear_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: linear_team_mappings linear_team_mappings_linearIntegrationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linear_team_mappings
    ADD CONSTRAINT "linear_team_mappings_linearIntegrationId_fkey" FOREIGN KEY ("linearIntegrationId") REFERENCES public.linear_integrations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: linear_team_mappings linear_team_mappings_repositoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linear_team_mappings
    ADD CONSTRAINT "linear_team_mappings_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES public.repositories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: local_agents local_agents_apiTokenId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_agents
    ADD CONSTRAINT "local_agents_apiTokenId_fkey" FOREIGN KEY ("apiTokenId") REFERENCES public.org_api_tokens(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: local_agents local_agents_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.local_agents
    ADD CONSTRAINT "local_agents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: org_api_tokens org_api_tokens_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_api_tokens
    ADD CONSTRAINT "org_api_tokens_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: org_api_tokens org_api_tokens_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_api_tokens
    ADD CONSTRAINT "org_api_tokens_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: org_type_changes org_type_changes_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_type_changes
    ADD CONSTRAINT "org_type_changes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organization_invitations organization_invitations_invitedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT "organization_invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organization_invitations organization_invitations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT "organization_invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organization_members organization_members_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: organization_members organization_members_removedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT "organization_members_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: organization_members organization_members_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: package_analyses package_analyses_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_analyses
    ADD CONSTRAINT "package_analyses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: package_analyses package_analyses_repositoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_analyses
    ADD CONSTRAINT "package_analyses_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES public.repositories(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: package_analyses package_analyses_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_analyses
    ADD CONSTRAINT "package_analyses_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: package_deep_dives package_deep_dives_analysisId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_deep_dives
    ADD CONSTRAINT "package_deep_dives_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES public.package_analyses(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: package_deep_dives package_deep_dives_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_deep_dives
    ADD CONSTRAINT "package_deep_dives_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: package_deep_dives package_deep_dives_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.package_deep_dives
    ADD CONSTRAINT "package_deep_dives_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: pull_requests pull_requests_repositoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pull_requests
    ADD CONSTRAINT "pull_requests_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES public.repositories(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: repositories repositories_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.repositories
    ADD CONSTRAINT "repositories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: review_issues review_issues_pullRequestId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_issues
    ADD CONSTRAINT "review_issues_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES public.pull_requests(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: safe_package_requests safe_package_requests_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safe_package_requests
    ADD CONSTRAINT "safe_package_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: safe_package_requests safe_package_requests_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.safe_package_requests
    ADD CONSTRAINT "safe_package_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: sessions sessions_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: slack_event_configs slack_event_configs_slackIntegrationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slack_event_configs
    ADD CONSTRAINT "slack_event_configs_slackIntegrationId_fkey" FOREIGN KEY ("slackIntegrationId") REFERENCES public.slack_integrations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: slack_integrations slack_integrations_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slack_integrations
    ADD CONSTRAINT "slack_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: status_incident_updates status_incident_updates_incidentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_incident_updates
    ADD CONSTRAINT "status_incident_updates_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES public.status_incidents(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: status_incidents status_incidents_componentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.status_incidents
    ADD CONSTRAINT "status_incidents_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES public.status_components(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: user_devices user_devices_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_devices
    ADD CONSTRAINT "user_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


