import { mock } from "bun:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { APIError } from "better-auth/api";

let session: unknown = { user: { id: "user" }, session: { token: "current" } };
let list: () => Promise<unknown> = async () => [];
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
mock.module("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async () => session, listSessions: () => list() } } }));
mock.module("../../../app/(app)/settings/sessions/sessions-client", () => ({ SessionsClient: () => <div>Session list</div> }));

const { default: SessionsPage } = await import("../../../app/(app)/settings/sessions/page");
list = async () => { throw new APIError("FORBIDDEN", { code: "SESSION_NOT_FRESH", message: "Session is not fresh" }); };
const html = renderToStaticMarkup(await SessionsPage());
assert.match(html, /Sign in again to manage sessions/);
assert.match(html, /callbackUrl=%2Fsettings%2Fsessions/);
const other = new APIError("FORBIDDEN", { code: "OTHER", message: "Unavailable" });
list = async () => { throw other; };
await assert.rejects(SessionsPage(), error => error === other);
session = null;
await assert.rejects(SessionsPage(), /redirect:\/login/);
session = { user: { id: "user" }, session: { token: "current" } };
list = async () => [];
assert.match(renderToStaticMarkup(await SessionsPage()), /Session list/);
