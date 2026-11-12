// Child process for error-boundaries.test.ts, so the Sentry mock cannot leak into other tests.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const reported: unknown[] = [];
mock.module("@sentry/nextjs", () => ({ captureException: (error: unknown) => { reported.push(error); } }));

const { ErrorFallback, reportBoundaryError } = await import("@/components/error-fallback");
const boundaries = {
  app: (await import("@/app/(app)/error")).default,
  settings: (await import("@/app/(app)/settings/error")).default,
  root: (await import("@/app/error")).default,
};

const error = new Error("synthetic-render-failure");
const retry = () => {};

// Every boundary hands Next's retry to the shared fallback; "Try again" must refetch the route.
for (const [name, Boundary] of Object.entries(boundaries)) {
  const element = Boundary({ error, retry }) as ReactElement<{ error: Error; retry: () => void }>;
  assert.ok(isValidElement(element), name);
  assert.equal(element.type, ErrorFallback, `${name} renders the shared fallback`);
  assert.equal(element.props.retry, retry, `${name} passes retry through`);
  assert.equal(element.props.error, error);
}

// The fallback announces itself, hides its decorative icons and never prints the error.
for (const [name, Boundary] of Object.entries(boundaries)) {
  const html = renderToStaticMarkup(Boundary({ error, retry }) as ReactElement);
  assert.ok(html.startsWith('<div role="alert"'), name);
  assert.equal((html.match(/aria-hidden="true"/g) ?? []).length, 2, `${name} hides both icons`);
  assert.ok(html.includes("Try again</button>"), name);
  assert.ok(!html.includes("synthetic-render-failure"), `${name} does not show the error text`);
}
assert.ok(renderToStaticMarkup(boundaries.settings({ error, retry }) as ReactElement).includes("Couldn&#x27;t load settings"));
assert.ok(renderToStaticMarkup(boundaries.root({ error, retry }) as ReactElement).includes("min-h-screen"));

// A client render error is reported once; a server error (it carries a digest) was reported by the server.
reportBoundaryError(error);
assert.deepEqual(reported, [error]);
reportBoundaryError(Object.assign(new Error("server"), { digest: "123" }));
assert.equal(reported.length, 1);

console.log("PASS error boundaries retry, announce themselves and report client errors once");
