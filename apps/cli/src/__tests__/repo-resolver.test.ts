import { describe, it, expect } from "bun:test";
import { parseGitRemote } from "../lib/repo-resolver.js";

describe("parseGitRemote", () => {
  it("parses SSH scp-like remotes", () => {
    expect(parseGitRemote("git@github.com:owner/repo.git")).toBe("owner/repo");
    expect(parseGitRemote("git@bitbucket.org:owner/repo.git")).toBe("owner/repo");
    expect(parseGitRemote("git@github.com:owner/repo")).toBe("owner/repo");
  });

  it("parses HTTPS remotes, with and without .git / port", () => {
    expect(parseGitRemote("https://github.com/owner/repo.git")).toBe("owner/repo");
    expect(parseGitRemote("https://github.com/owner/repo")).toBe("owner/repo");
    expect(parseGitRemote("https://gitlab.example.com:8443/group/subgroup/repo.git")).toBe(
      "group/subgroup/repo",
    );
  });

  it("parses SSH URL form with custom port + subgroups", () => {
    expect(parseGitRemote("ssh://git@gitlab.example.com:2222/group/subgroup/repo.git")).toBe(
      "group/subgroup/repo",
    );
  });

  it("returns null for unparseable input", () => {
    expect(parseGitRemote("not a remote")).toBeNull();
    expect(parseGitRemote("")).toBeNull();
  });
});
