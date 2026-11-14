import { describe, it, expect } from "bun:test";
import {
  orgNameSchema,
  apiKeysSchema,
  type ApiKeyField,
} from "@/lib/schemas/settings";

describe("orgNameSchema", () => {
  it("accepts a well-formed organization name", () => {
    const parsed = orgNameSchema.parse({ name: "Acme Corp" });
    expect(parsed.name).toBe("Acme Corp");
  });

  it("trims leading and trailing whitespace", () => {
    const parsed = orgNameSchema.parse({ name: "   Acme Corp   " });
    expect(parsed.name).toBe("Acme Corp");
  });

  it("accepts names at the 2 and 100 character boundaries", () => {
    expect(orgNameSchema.safeParse({ name: "ab" }).success).toBe(true);
    expect(orgNameSchema.safeParse({ name: "a".repeat(100) }).success).toBe(true);
  });

  it("rejects names shorter than 2 characters", () => {
    const result = orgNameSchema.safeParse({ name: "a" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Organization name must be at least 2 characters.",
      );
    }
  });

  it("rejects an empty name", () => {
    expect(orgNameSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("rejects a whitespace-only name (trimmed before length check)", () => {
    const result = orgNameSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Organization name must be at least 2 characters.",
      );
    }
  });

  it("rejects names longer than 100 characters", () => {
    const result = orgNameSchema.safeParse({ name: "a".repeat(101) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Organization name must be at most 100 characters.",
      );
    }
  });

  it("rejects names containing < > \" { or }", () => {
    for (const ch of ["<", ">", '"', "{", "}"]) {
      const result = orgNameSchema.safeParse({ name: `Acme ${ch} Corp` });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          "Organization name contains invalid characters.",
        );
      }
    }
  });

  it("allows punctuation the server does not block", () => {
    expect(orgNameSchema.safeParse({ name: "Acme & Sons, Inc." }).success).toBe(true);
    expect(orgNameSchema.safeParse({ name: "O'Reilly (EU)" }).success).toBe(true);
  });

  it("rejects a missing name", () => {
    expect(orgNameSchema.safeParse({}).success).toBe(false);
  });
});

describe("apiKeysSchema", () => {
  const prefixed: Array<{
    field: ApiKeyField;
    provider: string;
    valid: string;
    invalid: string;
  }> = [
    { field: "openaiApiKey", provider: "OpenAI", valid: "sk-abc123", invalid: "openai-abc123" },
    { field: "anthropicApiKey", provider: "Anthropic", valid: "sk-ant-abc123", invalid: "sk-abc123" },
    { field: "googleApiKey", provider: "Google AI", valid: "AIzaSyAbc123", invalid: "sk-abc123" },
    { field: "grokApiKey", provider: "Grok (xAI)", valid: "xai-abc123", invalid: "sk-abc123" },
    { field: "openrouterApiKey", provider: "OpenRouter", valid: "sk-or-abc123", invalid: "sk-abc123" },
    { field: "alibabaApiKey", provider: "Alibaba Cloud Model Studio", valid: "sk-abc123", invalid: "ali-abc123" },
  ];

  for (const { field, provider, valid, invalid } of prefixed) {
    it(`accepts a ${provider} key with the correct prefix`, () => {
      const result = apiKeysSchema.safeParse({ [field]: valid });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data[field]).toBe(valid);
      }
    });

    it(`rejects a ${provider} key with the wrong prefix`, () => {
      const result = apiKeysSchema.safeParse({ [field]: invalid });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues).toHaveLength(1);
        expect(result.error.issues[0]?.path).toEqual([field]);
        expect(result.error.issues[0]?.message).toBe(
          `Invalid ${provider} API key format.`,
        );
      }
    });
  }

  it("accepts any non-empty Cohere key (no prefix rule on the server)", () => {
    expect(apiKeysSchema.safeParse({ cohereApiKey: "co-abc123" }).success).toBe(true);
    expect(apiKeysSchema.safeParse({ cohereApiKey: "whatever" }).success).toBe(true);
  });

  it("accepts blank keys for every field (blank keeps the existing key)", () => {
    const blanks = {
      openaiApiKey: "",
      anthropicApiKey: "",
      googleApiKey: "",
      cohereApiKey: "",
      grokApiKey: "",
      openrouterApiKey: "",
      alibabaApiKey: "",
    };
    expect(apiKeysSchema.safeParse(blanks).success).toBe(true);
  });

  it("accepts whitespace-only keys as blank (trimmed before the prefix check)", () => {
    expect(apiKeysSchema.safeParse({ openaiApiKey: "   " }).success).toBe(true);
  });

  it("accepts an empty object (all fields optional)", () => {
    expect(apiKeysSchema.safeParse({}).success).toBe(true);
  });

  it("trims surrounding whitespace from keys", () => {
    const result = apiKeysSchema.safeParse({ anthropicApiKey: "  sk-ant-abc123  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.anthropicApiKey).toBe("sk-ant-abc123");
    }
  });

  it("treats the prefix check as case-sensitive", () => {
    expect(apiKeysSchema.safeParse({ openaiApiKey: "SK-abc123" }).success).toBe(false);
    expect(apiKeysSchema.safeParse({ googleApiKey: "aiza-abc123" }).success).toBe(false);
  });

  it("reports one issue per invalid field when several are wrong", () => {
    const result = apiKeysSchema.safeParse({
      openaiApiKey: "bad",
      anthropicApiKey: "sk-not-ant",
      googleApiKey: "AIzaOk",
      grokApiKey: "bad",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path[0]).sort();
      expect(paths).toEqual(["anthropicApiKey", "grokApiKey", "openaiApiKey"]);
    }
  });
});
