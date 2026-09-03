import { describe, it, expect } from "bun:test";
import { buildAppManifest } from "@/lib/github-manifest-state";

describe("buildAppManifest", () => {
  const base = "https://octo.example.com";
  const m = buildAppManifest(base, "octopus-abc12345");

  it("uses the given octopus- name and the deployment URLs", () => {
    expect(m.name).toBe("octopus-abc12345");
    expect(m.name.startsWith("octopus-")).toBe(true);
    expect(m.url).toBe(base);
    expect(m.hook_attributes.url).toBe(`${base}/api/github/webhook`);
    expect(m.hook_attributes.active).toBe(true);
    expect(m.redirect_url).toBe(`${base}/api/github/app-manifest/callback`);
    expect(m.callback_urls).toEqual([`${base}/api/github/callback`]);
    expect(m.setup_url).toBe(`${base}/api/github/callback`);
    expect(m.setup_on_update).toBe(true);
    expect(m.public).toBe(false);
  });

  it("requests exactly the permissions and events Octopus needs", () => {
    expect(m.default_permissions).toEqual({
      contents: "read",
      pull_requests: "write",
      checks: "write",
      metadata: "read",
    });
    expect(m.default_events).toEqual(["pull_request", "pull_request_review", "repository"]);
  });
});
