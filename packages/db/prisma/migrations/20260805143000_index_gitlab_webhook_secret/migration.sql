-- Bound the unauthenticated GitLab webhook token lookup to an indexed equality scan.
CREATE INDEX "gitlab_integrations_webhookSecret_idx"
ON "gitlab_integrations"("webhookSecret");
