// Child process for error-boundaries.test.ts, so the Sentry mock cannot leak into other tests.
import assert from "node:assert/strict";
import { mock } from "bun:test";
import { act, createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";

const window = new Window();
Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
const { createRoot } = await import("react-dom/client");

const reported: unknown[] = [];
mock.module("@sentry/nextjs", () => ({ captureException: (error: unknown) => { reported.push(error); } }));

const boundaries = {
  app: (await import("@/app/(app)/error")).default,
  settings: (await import("@/app/(app)/settings/error")).default,
  root: (await import("@/app/error")).default,
};

const error = new Error("synthetic-render-failure");
const retry = () => {};

for (const [name, Boundary] of Object.entries(boundaries)) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let retries = 0;
  reported.length = 0;
  await act(() => root.render(createElement(Boundary, { error, retry: () => { retries++; } })));
  assert.deepEqual(reported, [error], `${name} reports the client error once`);
  const button = container.querySelector("button");
  assert.ok(button, `${name} renders a retry button`);
  await act(() => button.click());
  assert.equal(retries, 1, `${name} invokes retry`);
  const serverError = Object.assign(new Error("server"), { digest: "123" });
  await act(() => root.render(createElement(Boundary, { error: serverError, retry })));
  assert.deepEqual(reported, [error], `${name} does not report the server error`);
  await act(() => root.unmount());
  container.remove();
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

console.log("PASS error boundaries retry, announce themselves and report client errors once");
