import { describe, expect, it, vi } from "vitest";
import { createServiceTool } from "./tool.js";
import type { ServiceEntry } from "./types.js";

vi.mock("./invoke.js", () => ({
  invokeService: vi.fn().mockResolvedValue({
    version: "1",
    status: "ok",
    result: "Service response text",
    usage: { input_tokens: 100, output_tokens: 200 },
  }),
}));

function makeEntry(overrides?: Partial<ServiceEntry>): ServiceEntry {
  return {
    manifest: {
      name: "test-service",
      description: "A test service for unit tests",
      url: "https://api.example.com/invoke",
    },
    promptBody: "",
    source: "workspace",
    filePath: "/test/SERVICE.md",
    skillNames: [],
    ...overrides,
  };
}

describe("createServiceTool", () => {
  it("creates a tool with correct name and description", () => {
    const tool = createServiceTool(makeEntry());
    expect(tool.name).toBe("service_test_service");
    expect(tool.description).toContain("A test service for unit tests");
  });

  it("includes skill parameter for multi-skill services", () => {
    const tool = createServiceTool(makeEntry({ skillNames: ["review", "audit"] }));
    expect(tool.description).toContain("review, audit");
  });

  it("requires confirmation for paid services", async () => {
    const tool = createServiceTool(
      makeEntry({
        manifest: {
          name: "paid-svc",
          description: "Paid service",
          url: "https://api.example.com/invoke",
          pricing: { model: "per_request", note: "$0.01/call" },
        },
      }),
    );

    const result = await tool.execute("call-1", { task: "do something" });
    const content = result.content[0];
    expect(content.type).toBe("text");
    const parsed = JSON.parse((content as { text: string }).text);
    expect(parsed.status).toBe("confirmation_required");
  });

  it("invokes service when confirmed", async () => {
    const tool = createServiceTool(
      makeEntry({
        manifest: {
          name: "paid-svc",
          description: "Paid",
          url: "https://api.example.com/invoke",
          pricing: { model: "per_request", note: "$0.01/call" },
        },
      }),
    );

    const result = await tool.execute("call-1", {
      task: "do something",
      confirmed: true,
    });
    const content = result.content[0];
    const parsed = JSON.parse((content as { text: string }).text);
    expect(parsed.status).toBe("ok");
    expect(parsed.result).toBe("Service response text");
  });

  it("skips confirmation for free services", async () => {
    const tool = createServiceTool(makeEntry());

    const result = await tool.execute("call-1", { task: "test" });
    const content = result.content[0];
    const parsed = JSON.parse((content as { text: string }).text);
    expect(parsed.status).toBe("ok");
  });

  it("skips confirmation when confirm=never", async () => {
    const tool = createServiceTool(
      makeEntry({
        manifest: {
          name: "trusted",
          description: "Trusted",
          url: "https://api.example.com/invoke",
          confirm: "never",
          pricing: { model: "per_request", note: "$1/call" },
        },
      }),
    );

    const result = await tool.execute("call-1", { task: "test" });
    const content = result.content[0];
    const parsed = JSON.parse((content as { text: string }).text);
    expect(parsed.status).toBe("ok");
  });

  it("validates skill name for multi-skill services", async () => {
    const tool = createServiceTool(makeEntry({ skillNames: ["review", "audit"] }));

    const result = await tool.execute("call-1", {
      task: "test",
      skill: "nonexistent",
    });
    const content = result.content[0];
    const parsed = JSON.parse((content as { text: string }).text);
    expect(parsed.status).toBe("error");
    expect(parsed.message).toContain("Unknown skill");
  });
});
