import { describe, expect, it } from "vitest";
import {
  extractServiceBody,
  parseServiceFrontmatter,
  resolveServiceManifest,
} from "./frontmatter.js";

describe("parseServiceFrontmatter", () => {
  it("parses valid SERVICE.md frontmatter", () => {
    const content = `---
name: test-service
description: A test service
url: https://api.example.com/v1/invoke
version: "1.0"
---

# Test Service
Use this for testing.`;

    const fm = parseServiceFrontmatter(content);
    expect(fm.name).toBe("test-service");
    expect(fm.description).toBe("A test service");
    expect(fm.url).toBe("https://api.example.com/v1/invoke");
    expect(fm.version).toBe("1.0");
  });

  it("returns empty for content without frontmatter", () => {
    const fm = parseServiceFrontmatter("No frontmatter here.");
    expect(Object.keys(fm)).toHaveLength(0);
  });
});

describe("extractServiceBody", () => {
  it("extracts body below frontmatter", () => {
    const content = `---
name: test
---

# Body Content

Some text here.`;

    const body = extractServiceBody(content);
    expect(body).toBe("# Body Content\n\nSome text here.");
  });

  it("returns full content if no frontmatter", () => {
    const body = extractServiceBody("Just a plain file.");
    expect(body).toBe("Just a plain file.");
  });

  it("returns empty for frontmatter-only content", () => {
    const body = extractServiceBody("---\nname: test\n---");
    expect(body).toBe("");
  });
});

describe("resolveServiceManifest", () => {
  it("resolves valid manifest from frontmatter", () => {
    const content = `---
name: my-service
description: My description
url: https://api.example.com/invoke
version: "2.0"
confirm: always
trust: internal
---`;

    const fm = parseServiceFrontmatter(content);
    const manifest = resolveServiceManifest(fm);
    expect(manifest).not.toBeNull();
    expect(manifest!.name).toBe("my-service");
    expect(manifest!.description).toBe("My description");
    expect(manifest!.url).toBe("https://api.example.com/invoke");
    expect(manifest!.version).toBe("2.0");
    expect(manifest!.confirm).toBe("always");
    expect(manifest!.trust).toBe("internal");
  });

  it("returns null for missing required fields", () => {
    const fm = parseServiceFrontmatter("---\nname: test\n---");
    expect(resolveServiceManifest(fm)).toBeNull();
  });

  it("rejects http:// URLs", () => {
    const content = `---
name: insecure
description: Bad URL
url: http://api.example.com/invoke
---`;

    const fm = parseServiceFrontmatter(content);
    expect(resolveServiceManifest(fm)).toBeNull();
  });

  it("defaults confirm and trust when not specified", () => {
    const content = `---
name: defaults
description: Test defaults
url: https://api.example.com/invoke
---`;

    const fm = parseServiceFrontmatter(content);
    const manifest = resolveServiceManifest(fm);
    expect(manifest).not.toBeNull();
    // confirm and trust are undefined in the manifest (defaults applied at runtime)
    expect(manifest!.confirm).toBeUndefined();
    expect(manifest!.trust).toBeUndefined();
  });

  it("parses auth config", () => {
    const content = `---
name: authed
description: With auth
url: https://api.example.com/invoke
auth:
  type: api_key
  env: MY_API_KEY
  header: X-Custom-Key
---`;

    const fm = parseServiceFrontmatter(content);
    const manifest = resolveServiceManifest(fm);
    expect(manifest).not.toBeNull();
    expect(manifest!.auth).toEqual({
      type: "api_key",
      env: "MY_API_KEY",
      header: "X-Custom-Key",
    });
  });

  it("parses pricing config", () => {
    const content = `---
name: paid
description: Paid service
url: https://api.example.com/invoke
pricing:
  model: per_request
  note: "$0.01 per call"
---`;

    const fm = parseServiceFrontmatter(content);
    const manifest = resolveServiceManifest(fm);
    expect(manifest).not.toBeNull();
    expect(manifest!.pricing).toEqual({
      model: "per_request",
      note: "$0.01 per call",
    });
  });

  it("parses skill refs", () => {
    const content = `---
name: multi-skill
description: Multi skill service
url: https://api.example.com/invoke
skills:
  - path: /skills/review/SKILL.md
  - ref: https://example.com/skills/audit/SKILL.md
---`;

    const fm = parseServiceFrontmatter(content);
    const manifest = resolveServiceManifest(fm);
    expect(manifest).not.toBeNull();
    expect(manifest!.skills).toHaveLength(2);
    expect(manifest!.skills![0]).toEqual({ path: "/skills/review/SKILL.md" });
    expect(manifest!.skills![1]).toEqual({ ref: "https://example.com/skills/audit/SKILL.md" });
  });
});
