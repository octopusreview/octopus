import { describe, expect, it } from "bun:test";
import { buildCliChatSystemPrompt } from "@/lib/cli-chat-prompt";

const base = {
  userName: "Cem",
  userEmail: "cem@example.com",
  codeContext: "",
  knowledgeContext: "",
  reviewContext: "",
  agentResult: null,
};

describe("buildCliChatSystemPrompt", () => {
  it("includes <review_context> with the PR header when review context is present", () => {
    const prompt = buildCliChatSystemPrompt({
      ...base,
      reviewContext: "### org/repo PR #12: title (by alice, 2026-01-02)\nDon't use var.",
    });
    expect(prompt).toContain("<review_context>");
    expect(prompt).toContain("### org/repo PR #12: title (by alice, 2026-01-02)");
    expect(prompt).toContain("- Answer questions using the provided code, knowledge and past-review context");
  });

  it("omits <review_context> entirely when there are no review chunks", () => {
    const prompt = buildCliChatSystemPrompt(base);
    expect(prompt).not.toContain("<review_context>");
  });

  it("preserves the code/knowledge fallbacks when contexts are empty", () => {
    const prompt = buildCliChatSystemPrompt(base);
    expect(prompt).toContain("No code context available.");
    expect(prompt).toContain("No knowledge context available.");
  });

  it("includes local_agent_context only when agentResult is given", () => {
    const without = buildCliChatSystemPrompt(base);
    expect(without).not.toContain("<local_agent_context>");

    const withAgent = buildCliChatSystemPrompt({
      ...base,
      agentResult: { agentName: "dev-box", summary: "Found 2 matches." },
    });
    expect(withAgent).toContain("<local_agent_context>");
    expect(withAgent).toContain('local agent ("dev-box")');
    expect(withAgent).toContain("Found 2 matches.");
  });
});
