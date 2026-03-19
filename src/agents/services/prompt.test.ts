import { describe, expect, it } from "vitest";
import { formatServicesForPrompt } from "./prompt.js";
import type { ServiceEntry } from "./types.js";

function makeEntry(
  overrides: Partial<ServiceEntry> & { manifest: ServiceEntry["manifest"] },
): ServiceEntry {
  return {
    promptBody: "",
    source: "workspace",
    filePath: "/test/SERVICE.md",
    skillNames: [],
    ...overrides,
  };
}

describe("formatServicesForPrompt", () => {
  it("returns empty string for no services", () => {
    expect(formatServicesForPrompt([])).toBe("");
  });

  it("formats a single service", () => {
    const result = formatServicesForPrompt([
      makeEntry({
        manifest: {
          name: "test-svc",
          description: "A test service",
          url: "https://api.example.com/invoke",
        },
        skillNames: ["review", "audit"],
      }),
    ]);

    expect(result).toContain("## Available Services");
    expect(result).toContain("### test-svc (third-party)");
    expect(result).toContain("A test service");
    expect(result).toContain("review, audit");
    expect(result).toContain("Do NOT send secrets");
  });

  it("marks internal services correctly", () => {
    const result = formatServicesForPrompt([
      makeEntry({
        manifest: {
          name: "internal-svc",
          description: "Internal service",
          url: "https://internal.example.com/invoke",
          trust: "internal",
        },
      }),
    ]);

    expect(result).toContain("### internal-svc (internal)");
    expect(result).not.toContain("Do NOT send secrets");
  });

  it("includes pricing info when present", () => {
    const result = formatServicesForPrompt([
      makeEntry({
        manifest: {
          name: "paid-svc",
          description: "Paid service",
          url: "https://api.example.com/invoke",
          pricing: { model: "per_request", note: "$0.01/call" },
        },
      }),
    ]);

    expect(result).toContain("$0.01/call");
  });

  it("includes SERVICE.md body as usage guidance", () => {
    const result = formatServicesForPrompt([
      makeEntry({
        manifest: {
          name: "guided",
          description: "Guided service",
          url: "https://api.example.com/invoke",
        },
        promptBody: "Use this service when the user asks for code reviews.",
      }),
    ]);

    expect(result).toContain("Use this service when the user asks for code reviews.");
  });
});
