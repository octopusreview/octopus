-- AlterTable
ALTER TABLE "public"."review_issues" ADD COLUMN     "jiraIssueKey" TEXT,
ADD COLUMN     "jiraIssueUrl" TEXT;

-- CreateTable
CREATE TABLE "public"."jira_integrations" (
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
CREATE TABLE "public"."jira_project_mappings" (
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

-- CreateIndex
CREATE UNIQUE INDEX "jira_integrations_organizationId_key" ON "public"."jira_integrations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "jira_project_mappings_jiraIntegrationId_repositoryId_key" ON "public"."jira_project_mappings"("jiraIntegrationId", "repositoryId");

-- AddForeignKey
ALTER TABLE "public"."jira_integrations" ADD CONSTRAINT "jira_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."jira_project_mappings" ADD CONSTRAINT "jira_project_mappings_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "public"."repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."jira_project_mappings" ADD CONSTRAINT "jira_project_mappings_jiraIntegrationId_fkey" FOREIGN KEY ("jiraIntegrationId") REFERENCES "public"."jira_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
