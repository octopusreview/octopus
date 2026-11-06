# Background error triage

Sentry is the platform error destination for terminal hosted review failures and repository indexing failures. Existing organization Slack notifications are unchanged.

In the Octopus Sentry project, filter Issues by:

```text
environment:production error_boundary:background -synthetic:true is:unresolved
```

Check new and regressed issues daily. Start with recurring failures that affect reviews. Each event includes failure stage, ownership (`platform` or `unknown`), provider and a safe code. Its `background_failure` context carries the available repository/PR identifiers, revision, attempt ID and retry count. The attempt ID identifies a review attempt, an index attempt (including pre-review indexing), or a queue job when the outer worker catches the failure; it does not guarantee a saved review-attempt record. Correlate the affected work with authenticated Review Logs or repository indexing logs using the available context. Link the fix and verify the deployed version before resolving the issue. Unknown means the available evidence does not establish the cause; it is not a confirmed provider outage.

Repository indexing logs show the latest 500 entries in chronological order; older entries are omitted when the log exceeds that limit.

For review preparation failures, the optional `preparation_operation` tag distinguishes `review_input` fetches from `repository_tree` fetches. GitHub tree failures can also be grouped by their HTTP status code, for example `failure_code:http_451`. These identify the failed boundary or upstream response, not its cause or a confirmed fix; response bodies are not included in the event.

Expected credit/spend blocks, known BYOK authentication/quota failures, confirmed cancellations and superseded work do not create platform incidents. Review cancellation is distinguished from queue expiry using the execution deadline; deadline failures remain reportable. Existing queue retries report only at exhaustion. Handled review failures are already terminal and report immediately; adding automatic provider retries is tracked separately in #945. This does not claim every swallowed exception elsewhere in the application is covered. Local CLI uploads and community/legacy large-review pipelines are outside this change.

After a release, an operator can run `node apps/web/sentry-smoke.mjs --send-synthetic` inside one review-worker container with its existing Sentry configuration. It sends one labelled synthetic event through the shared reporting helper and prints its event ID and release. Verify that event in Sentry, including its release, stage and safe context, then resolve the separately grouped synthetic issue (`synthetic:true`). A successful flush alone does not prove receipt. This check never calls a model or changes customer data, and is not exposed as a web endpoint. Self-hosted deployments remain opt-in through their existing DSN configuration.
