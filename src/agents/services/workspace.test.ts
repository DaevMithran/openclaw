import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadServiceEntries, loadEligibleServiceEntries } from "./workspace.js";

describe("loadServiceEntries", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-services-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createService(name: string, content: string) {
    const serviceDir = path.join(tempDir, "services", name);
    fs.mkdirSync(serviceDir, { recursive: true });
    fs.writeFileSync(path.join(serviceDir, "SERVICE.md"), content, "utf-8");
    return serviceDir;
  }

  it("loads services from workspace directory", () => {
    createService(
      "test-svc",
      `---
name: test-svc
description: Test service
url: https://api.example.com/invoke
---

Use this for tests.`,
    );

    const entries = loadServiceEntries(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].manifest.name).toBe("test-svc");
    expect(entries[0].manifest.url).toBe("https://api.example.com/invoke");
    expect(entries[0].promptBody).toBe("Use this for tests.");
    expect(entries[0].source).toBe("workspace");
  });

  it("returns empty for nonexistent directory", () => {
    const entries = loadServiceEntries("/tmp/nonexistent-openclaw-test");
    expect(entries).toHaveLength(0);
  });

  it("skips services with invalid manifest", () => {
    createService(
      "bad-svc",
      `---
name: bad-svc
---

Missing required fields.`,
    );

    const entries = loadServiceEntries(tempDir);
    expect(entries).toHaveLength(0);
  });

  it("discovers skill names from skills subdirectory", () => {
    const serviceDir = createService(
      "with-skills",
      `---
name: with-skills
description: Service with skills
url: https://api.example.com/invoke
---`,
    );

    // Create skill subdirectories
    const skillsDir = path.join(serviceDir, "skills");
    const reviewDir = path.join(skillsDir, "review");
    const auditDir = path.join(skillsDir, "audit");
    fs.mkdirSync(reviewDir, { recursive: true });
    fs.mkdirSync(auditDir, { recursive: true });
    fs.writeFileSync(
      path.join(reviewDir, "SKILL.md"),
      "---\nname: review\n---\nReview skill.",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(auditDir, "SKILL.md"),
      "---\nname: audit\n---\nAudit skill.",
      "utf-8",
    );

    const entries = loadServiceEntries(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].skillNames).toEqual(["audit", "review"]);
  });

  it("respects disabled config", () => {
    createService(
      "disabled-test",
      `---
name: disabled-test
description: Should not load
url: https://api.example.com/invoke
---`,
    );

    const entries = loadServiceEntries(tempDir, {
      config: { services: { enabled: false } },
    });
    expect(entries).toHaveLength(0);
  });
});

describe("loadEligibleServiceEntries", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-services-eligible-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createService(name: string, content: string) {
    const serviceDir = path.join(tempDir, "services", name);
    fs.mkdirSync(serviceDir, { recursive: true });
    fs.writeFileSync(path.join(serviceDir, "SERVICE.md"), content, "utf-8");
  }

  it("filters out services missing required auth env vars", () => {
    createService(
      "no-auth",
      `---
name: no-auth
description: No auth needed
url: https://api.example.com/invoke
---`,
    );

    createService(
      "needs-auth",
      `---
name: needs-auth
description: Needs API key
url: https://api.example.com/invoke
auth:
  type: api_key
  env: NONEXISTENT_TEST_KEY_XYZ
---`,
    );

    const entries = loadEligibleServiceEntries(tempDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].manifest.name).toBe("no-auth");
  });

  it("applies service filter", () => {
    createService(
      "svc-a",
      `---
name: svc-a
description: Service A
url: https://api.example.com/invoke
---`,
    );

    createService(
      "svc-b",
      `---
name: svc-b
description: Service B
url: https://api.example.com/invoke
---`,
    );

    const entries = loadEligibleServiceEntries(tempDir, {
      serviceFilter: ["svc-a"],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].manifest.name).toBe("svc-a");
  });
});
