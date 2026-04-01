export type KnowledgeTemplateCategory =
  | "language"
  | "process"
  | "security"
  | "testing"
  | "architecture";

export type KnowledgeTemplate = {
  id: string;
  title: string;
  description: string;
  category: KnowledgeTemplateCategory;
  content: string;
};

export const knowledgeTemplates: KnowledgeTemplate[] = [
  {
    id: "typescript-best-practices",
    title: "TypeScript Best Practices",
    description:
      "Strict type safety rules, avoiding any, proper use of generics, and common TypeScript patterns.",
    category: "language",
    content: `# TypeScript Best Practices

## Type Safety

- **Never use \`any\`** — use \`unknown\` when the type is truly uncertain, then narrow with type guards.
- **Prefer \`interface\` for object shapes** that may be extended; use \`type\` for unions, intersections, and mapped types.
- **Enable strict mode** — ensure \`strict: true\` in tsconfig. This enables \`strictNullChecks\`, \`noImplicitAny\`, and other essential checks.
- **Use \`satisfies\`** to validate a value matches a type without widening it:
  \`\`\`ts
  const config = { port: 3000, host: "localhost" } satisfies ServerConfig;
  \`\`\`

## Functions & Parameters

- **Use explicit return types** for public/exported functions. Inferred types are fine for local helpers.
- **Prefer readonly parameters** for arrays and objects that should not be mutated:
  \`\`\`ts
  function process(items: readonly string[]) { ... }
  \`\`\`
- **Avoid optional parameters when a default value is appropriate** — use default values instead.
- **Use discriminated unions** instead of optional fields for mutually exclusive states:
  \`\`\`ts
  type Result = { status: "ok"; data: string } | { status: "error"; message: string };
  \`\`\`

## Error Handling

- **Throw typed errors** — create custom error classes that extend \`Error\`.
- **Prefer \`Result\` types** over thrown exceptions for expected failure cases:
  \`\`\`ts
  type Result<T> = { success: true; data: T } | { success: false; error: string };
  \`\`\`
- **Always handle promise rejections** — never leave \`.catch()\` empty or missing.

## Enums & Constants

- **Prefer \`as const\` objects over enums** for better tree-shaking and type inference:
  \`\`\`ts
  const Status = { Active: "active", Inactive: "inactive" } as const;
  type Status = (typeof Status)[keyof typeof Status];
  \`\`\`

## Generics

- **Name generic parameters descriptively** when more than one: \`TInput\`, \`TOutput\` instead of \`T\`, \`U\`.
- **Constrain generics** with \`extends\` to provide useful autocompletion and error messages.
- **Avoid deeply nested generics** — extract intermediate types for readability.

## Null & Undefined

- **Use nullish coalescing (\`??\`)** instead of logical OR (\`||\`) for default values.
- **Use optional chaining (\`?.\`)** instead of manual null checks.
- **Prefer \`null\` over \`undefined\`** for intentionally empty values; let \`undefined\` mean "not set".
`,
  },
  {
    id: "react-nextjs-guidelines",
    title: "React & Next.js Guidelines",
    description:
      "Component patterns, server vs client components, data fetching, and Next.js App Router conventions.",
    category: "language",
    content: `# React & Next.js Guidelines

## Component Architecture

- **Default to Server Components** — only add \`"use client"\` when you need interactivity, hooks, or browser APIs.
- **Keep client components small** — push state and interactivity to leaf components; keep parent server components data-rich.
- **One component per file** — name the file after the component. Use kebab-case for file names.
- **Co-locate related files** — put component, actions, types, and tests in the same directory.

## Data Fetching

- **Fetch data in Server Components** — use \`async\` server components with direct DB/API calls. Avoid \`useEffect\` for initial data.
- **Use Server Actions for mutations** — define with \`"use server"\` and bind to forms via \`action\` prop.
- **Never call Server Actions from onClick** — use \`<form action={...}>\` instead. \`redirect()\` does not work properly from onClick handlers.
- **Call \`revalidatePath()\`** in server actions when layout data changes, since layouts do not re-render on same-route navigation.

## State Management

- **Prefer URL state** (search params) over \`useState\` for filterable/sortable views — it enables sharing and back/forward navigation.
- **Use \`useActionState\`** for form submission state (pending, errors).
- **Lift state only when necessary** — start local and lift when a sibling genuinely needs it.

## Forms & Validation

- **Validate on the server** — client-side validation is for UX only, never trust it for security.
- **Return errors from Server Actions** as \`{ error: string }\` — display them inline, not as toasts for form errors.
- **Use progressive enhancement** — forms should work without JavaScript when possible.

## Performance

- **Use \`React.lazy\` / \`next/dynamic\`** for heavy client components not needed on initial render.
- **Optimize images** with \`next/image\` — always set \`width\`, \`height\`, or \`fill\`.
- **Avoid layout shifts** — reserve space for async content with skeletons or fixed dimensions.

## Error Handling

- **Add \`error.tsx\`** boundaries for route segments that can fail.
- **Add \`loading.tsx\`** for route segments with async data.
- **Handle DB constraint errors gracefully** — never expose raw database errors to the UI.
`,
  },
  {
    id: "api-design-standards",
    title: "API Design Standards",
    description:
      "RESTful conventions, naming, error responses, pagination, and versioning for HTTP APIs.",
    category: "architecture",
    content: `# API Design Standards

## URL Structure

- Use **kebab-case** for URL paths: \`/api/user-profiles\`, not \`/api/userProfiles\`.
- Use **plural nouns** for resource collections: \`/api/users\`, \`/api/repositories\`.
- Nest sub-resources under their parent: \`/api/organizations/:orgId/members\`.
- Keep URLs **max 3 levels deep** — flatten if deeper nesting is needed.

## HTTP Methods

- \`GET\` — Read (never mutate state).
- \`POST\` — Create a new resource or trigger an action.
- \`PUT\` — Full replace of a resource.
- \`PATCH\` — Partial update of a resource.
- \`DELETE\` — Remove a resource (prefer soft delete).

## Request & Response Format

- Use **camelCase** for JSON field names.
- Always return a consistent envelope for errors:
  \`\`\`json
  { "error": { "code": "VALIDATION_ERROR", "message": "Email is required." } }
  \`\`\`
- Return **201 Created** with the created resource on successful POST.
- Return **204 No Content** on successful DELETE.
- Return **200 OK** with the updated resource on PUT/PATCH.

## Pagination

- Use **cursor-based pagination** for large datasets:
  \`\`\`
  GET /api/items?cursor=abc123&limit=20
  \`\`\`
- Response includes \`nextCursor\` (null if no more pages):
  \`\`\`json
  { "data": [...], "nextCursor": "def456" }
  \`\`\`
- Default limit: 20. Max limit: 100.

## Error Handling

- Use appropriate HTTP status codes:
  - \`400\` — Bad request (validation errors)
  - \`401\` — Unauthenticated
  - \`403\` — Forbidden (authenticated but not authorized)
  - \`404\` — Resource not found
  - \`409\` — Conflict (duplicate, stale update)
  - \`422\` — Unprocessable entity (valid syntax but semantic error)
  - \`429\` — Rate limited
  - \`500\` — Internal server error
- Never expose internal error details (stack traces, SQL) in production responses.

## Authentication & Authorization

- Use **Bearer tokens** in the \`Authorization\` header.
- Validate permissions at the API layer — never rely on the client to enforce access control.
- Return \`403\` with a clear message when permission is denied.

## Versioning

- Use **URL path versioning** when breaking changes are unavoidable: \`/api/v2/users\`.
- Prefer **additive changes** (new fields, new endpoints) over breaking changes.
- Deprecate old versions with a sunset header and migration guide.
`,
  },
  {
    id: "security-review-checklist",
    title: "Security Review Checklist",
    description:
      "OWASP top risks, input validation, authentication, secrets management, and common vulnerability patterns.",
    category: "security",
    content: `# Security Review Checklist

## Input Validation

- **Validate all user input on the server** — never trust client-side validation alone.
- **Use allowlists over denylists** — define what is allowed, not what is blocked.
- **Sanitize HTML output** to prevent XSS — use framework-provided escaping (React auto-escapes JSX).
- **Parameterize all database queries** — never concatenate user input into SQL or query strings.
- **Validate file uploads** — check MIME type, file extension, and file size. Never execute uploaded files.

## Authentication

- **Enforce strong password policies** — minimum 8 characters, no common passwords.
- **Hash passwords with bcrypt or argon2** — never store plaintext or use MD5/SHA for passwords.
- **Implement rate limiting** on login endpoints — prevent brute force attacks.
- **Use secure session management** — HttpOnly, Secure, SameSite cookies. Set reasonable expiry.
- **Implement CSRF protection** for state-changing requests.

## Authorization

- **Check permissions on every request** — never assume a valid session implies authorization.
- **Use the principle of least privilege** — users and services get only the permissions they need.
- **Validate resource ownership** — ensure users can only access their own data.
- **Log authorization failures** — they may indicate an attack.

## Secrets Management

- **Never commit secrets to version control** — use environment variables or secret managers.
- **Rotate secrets regularly** — especially API keys and database credentials.
- **Use different secrets per environment** — dev, staging, production must have separate keys.
- **Audit secret access** — log who accessed what and when.

## Data Protection

- **Encrypt sensitive data at rest** — PII, financial data, health data.
- **Use TLS for all data in transit** — enforce HTTPS, reject HTTP.
- **Minimize data collection** — only collect and store what is necessary.
- **Implement data retention policies** — delete data when it is no longer needed.
- **Mask sensitive data in logs** — never log passwords, tokens, or full credit card numbers.

## Common Vulnerabilities

- **SQL Injection** — always use parameterized queries or ORM methods.
- **XSS (Cross-Site Scripting)** — escape output, use Content-Security-Policy headers.
- **CSRF (Cross-Site Request Forgery)** — use anti-CSRF tokens for state-changing operations.
- **SSRF (Server-Side Request Forgery)** — validate and restrict outbound URLs.
- **Insecure Deserialization** — validate structure and type of deserialized data.
- **Open Redirects** — validate redirect URLs against an allowlist of domains.
`,
  },
  {
    id: "testing-standards",
    title: "Testing Standards",
    description:
      "Unit, integration, and E2E testing conventions, what to test, mocking strategies, and coverage goals.",
    category: "testing",
    content: `# Testing Standards

## Test Organization

- **Co-locate tests with source files** — \`user-service.ts\` and \`user-service.test.ts\` in the same directory.
- **Name tests descriptively** — describe the behavior, not the implementation:
  \`\`\`ts
  // Good
  it("returns 404 when user does not exist")
  // Bad
  it("calls findUnique and returns null")
  \`\`\`
- **Group related tests with \`describe\`** blocks — organized by function or behavior.

## What to Test

- **Business logic** — all conditional paths, edge cases, error handling.
- **API endpoints** — request validation, authorization, response format.
- **Database queries** — complex queries, constraint handling, soft deletes.
- **Integration points** — external API calls, webhook handlers.
- **Do NOT test** — framework internals, simple getters/setters, type definitions.

## Unit Tests

- **Test one behavior per test** — if a test needs "and" in its name, split it.
- **Use the Arrange-Act-Assert pattern**:
  \`\`\`ts
  // Arrange
  const user = createTestUser({ role: "admin" });
  // Act
  const result = canDeleteProject(user, project);
  // Assert
  expect(result).toBe(true);
  \`\`\`
- **Prefer real implementations over mocks** — mock only external services and side effects.
- **Avoid testing implementation details** — test behavior, not internal state.

## Integration Tests

- **Use a real database** for DB-related tests — mocks can hide migration issues.
- **Clean up test data** after each test — use transactions or truncation.
- **Test the full request/response cycle** for API routes.

## Mocking Strategy

- **Mock external HTTP calls** — use MSW or similar libraries.
- **Mock time** when testing time-dependent logic — \`vi.useFakeTimers()\`.
- **Do NOT mock** the module under test or its direct dependencies unless absolutely necessary.
- **Use factories** for test data — avoid copy-pasting fixture objects.

## Test Quality

- **Tests should be deterministic** — no random data, no reliance on test order.
- **Tests should be fast** — if a unit test takes more than 100ms, investigate.
- **Tests should be independent** — no shared mutable state between tests.
- **Fix flaky tests immediately** — a flaky test is worse than no test.

## Coverage

- **Aim for meaningful coverage**, not a number — 80% of well-chosen tests beats 100% of trivial ones.
- **Critical paths must be tested** — auth, billing, data deletion, webhooks.
- **New code must include tests** — PRs adding features or fixing bugs should include relevant tests.
`,
  },
  {
    id: "code-review-guidelines",
    title: "Code Review Guidelines",
    description:
      "What reviewers should focus on, severity levels, how to give constructive feedback on pull requests.",
    category: "process",
    content: `# Code Review Guidelines

## Review Priorities (in order)

1. **Correctness** — Does the code do what it claims? Are there logic bugs, off-by-one errors, race conditions?
2. **Security** — Does it introduce vulnerabilities? SQL injection, XSS, auth bypasses, exposed secrets?
3. **Data integrity** — Can it corrupt or lose data? Missing transactions, partial updates, no error handling on writes?
4. **Performance** — Are there N+1 queries, missing indexes, unbounded loops, memory leaks?
5. **Maintainability** — Is the code readable? Are names clear? Is the structure consistent with the codebase?
6. **Testing** — Are there adequate tests? Do they test the right things?

## Severity Levels

- **Critical** — Must fix before merge. Security vulnerabilities, data loss risks, broken functionality.
- **High** — Should fix before merge. Performance issues, missing error handling, incorrect business logic.
- **Medium** — Fix recommended. Code clarity, missing tests for edge cases, minor inconsistencies.
- **Low** — Nice to have. Style preferences, minor naming improvements, documentation suggestions.
- **Info** — Not a request for change. Context, explanation, or observation for the author's awareness.

## Giving Feedback

- **Be specific** — point to the exact line and explain the issue. Include a suggested fix when possible.
- **Explain why** — "This could cause X because Y" is better than "change this".
- **Distinguish preferences from requirements** — prefix subjective feedback with "nit:" or "optional:".
- **Acknowledge good work** — call out clever solutions, good test coverage, or clean refactors.
- **Assume good intent** — ask questions before assuming mistakes: "Could you explain why...?" instead of "This is wrong."

## As an Author

- **Keep PRs small** — under 400 lines of meaningful changes. Split large features into stacked PRs.
- **Write a clear description** — explain what changed, why, and how to test it.
- **Self-review before requesting** — read your own diff first. Catch the easy stuff.
- **Respond to all comments** — even if just "done" or "won't fix because X".
- **Do not take feedback personally** — reviews are about the code, not about you.

## What to Skip

- **Do not bikeshed** — if it works and is readable, do not argue about style unless it violates team standards.
- **Do not block on trivial issues** — approve with minor comments that can be addressed later.
- **Do not re-review unchanged code** — focus on the new changes in the updated diff.
`,
  },
  {
    id: "git-pr-conventions",
    title: "Git & PR Conventions",
    description:
      "Branch naming, commit messages, PR size guidelines, and merge strategies.",
    category: "process",
    content: `# Git & PR Conventions

## Branch Naming

- Use the format: \`type/short-description\`
- Types: \`feat\`, \`fix\`, \`refactor\`, \`chore\`, \`docs\`, \`test\`
- Examples:
  - \`feat/user-notifications\`
  - \`fix/login-redirect-loop\`
  - \`refactor/extract-auth-middleware\`
- Keep branch names under 50 characters.

## Commit Messages

- Use the format: \`type: short description\`
- Types: \`feat\`, \`fix\`, \`refactor\`, \`chore\`, \`docs\`, \`test\`, \`perf\`, \`ci\`
- First line: imperative mood, max 72 characters.
- Body (optional): explain *why*, not *what*. The diff shows what changed.
- Examples:
  \`\`\`
  feat: add email notification preferences

  Users can now choose which events trigger email notifications.
  This was requested in issue #234 after several users reported
  notification fatigue.
  \`\`\`

## Pull Requests

- **Keep PRs focused** — one logical change per PR. Do not mix refactors with features.
- **Size guidelines:**
  - Small (preferred): under 200 lines changed
  - Medium: 200-400 lines
  - Large (needs justification): 400+ lines
- **Always include:**
  - A clear title following commit message conventions
  - A description explaining what and why
  - How to test the changes
  - Screenshots for UI changes
- **Link related issues** — use "Closes #123" or "Relates to #456".

## Merge Strategy

- Use **squash merge** for feature branches — keeps main branch history clean.
- Use **rebase merge** only for branches with meaningful, atomic commits worth preserving.
- **Never force push to shared branches** (main, develop, release/*).
- **Delete branches after merge** — keep the branch list clean.

## Code Freeze & Releases

- Tag releases with semantic versioning: \`v1.2.3\`.
- Create release branches (\`release/v1.2.0\`) for hotfix support.
- Cherry-pick critical fixes to release branches; do not merge feature branches into them.
`,
  },
  {
    id: "error-handling-patterns",
    title: "Error Handling Patterns",
    description:
      "Consistent error handling strategies, custom errors, logging, and user-facing error messages.",
    category: "architecture",
    content: `# Error Handling Patterns

## General Principles

- **Handle errors at the appropriate level** — catch where you can meaningfully respond, let others propagate.
- **Never swallow errors silently** — at minimum, log them. An empty catch block is almost always a bug.
- **Fail fast** — validate inputs early and return clear errors before doing expensive work.
- **Separate expected errors from unexpected ones** — validation failures are expected; null pointer exceptions are bugs.

## Custom Error Classes

- Create domain-specific error classes for expected failure modes:
  \`\`\`ts
  class NotFoundError extends Error {
    constructor(resource: string, id: string) {
      super(\`\${resource} with id \${id} not found\`);
      this.name = "NotFoundError";
    }
  }

  class ValidationError extends Error {
    constructor(public readonly field: string, message: string) {
      super(message);
      this.name = "ValidationError";
    }
  }
  \`\`\`
- Use these for control flow in API layers:
  \`\`\`ts
  if (error instanceof NotFoundError) return Response.json({ error: error.message }, { status: 404 });
  if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
  \`\`\`

## Database Errors

- **Handle unique constraint violations** — check before insert or catch the specific error code:
  \`\`\`ts
  catch (error) {
    if (error.code === "P2002") {
      return { error: "A record with this value already exists." };
    }
    throw error;
  }
  \`\`\`
- **Handle foreign key violations** — return a user-friendly message about missing references.
- **Never expose raw database errors** to the UI — they may contain table names, column names, or query details.

## Logging

- **Log errors with context** — include the operation, relevant IDs, and the error:
  \`\`\`ts
  console.error(\`[payment] Failed to process payment for org \${orgId}:\`, error);
  \`\`\`
- **Use structured log levels:**
  - \`error\` — something broke, needs attention
  - \`warn\` — something unexpected but handled
  - \`info\` — significant business events (user signed up, payment processed)
  - \`debug\` — detailed info for troubleshooting
- **Never log sensitive data** — passwords, tokens, API keys, full credit card numbers.

## User-Facing Errors

- **Be helpful, not technical** — "Could not save your changes. Please try again." not "INSERT failed: duplicate key violation on idx_users_email".
- **Be specific when safe** — "An account with this email already exists" is fine and helpful.
- **Provide next steps** — "Your session has expired. Please log in again." tells the user what to do.
- **Use consistent error format** across the application:
  \`\`\`ts
  { error: string }  // for server actions
  { error: { code: string; message: string } }  // for API routes
  \`\`\`

## Async Error Handling

- **Always await promises** — unhandled rejections crash the process in Node.
- **Use try/catch for async/await** — not .then().catch() chains.
- **Handle fire-and-forget carefully** — wrap in an IIFE with its own try/catch:
  \`\`\`ts
  (async () => {
    try {
      await backgroundTask();
    } catch (err) {
      console.error("[background] Task failed:", err);
    }
  })();
  \`\`\`
`,
  },
];
