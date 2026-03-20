import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { OpenClawConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { SkillEntry } from "../skills/types.js";
import { filterWorkspaceSkillEntries, loadWorkspaceSkillEntries } from "../skills/workspace.js";

const servicesLogger = createSubsystemLogger("services");

export type ServiceInitParams = {
  /** Service name (kebab-case). */
  name: string;
  /** Human-readable description. */
  description: string;
  /** Service invoke URL. If empty, a placeholder is used. */
  url?: string;
  /** Trust level. */
  trust?: "external" | "internal";
  /** Confirmation policy. */
  confirm?: "auto" | "always" | "never";
  /** Pricing note (optional). */
  pricingNote?: string;
  /** Selected skill names to expose. If empty, no skills section is generated. */
  selectedSkills: string[];
  /** Additional body text for the SERVICE.md. */
  body?: string;
};

export type ParsedServiceMd = {
  name: string;
  description: string;
  url?: string;
  trust?: string;
  confirm?: string;
  pricingNote?: string;
  body: string;
};

export function resolveAvailableSkills(
  workspaceDir: string,
  config?: OpenClawConfig,
): Array<{ name: string; description: string }> {
  const entries = loadWorkspaceSkillEntries(workspaceDir, { config });
  const eligible = filterWorkspaceSkillEntries(entries, config);
  return eligible.map((entry) => ({
    name: entry.skill.name,
    description: entry.skill.description ?? entry.skill.name,
  }));
}

export function parseServiceMd(raw: string): ParsedServiceMd {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { name: "", description: "", body: raw };
  }

  const endIndex = lines.indexOf("---", 1);
  if (endIndex === -1) {
    return { name: "", description: "", body: raw };
  }

  const yamlBlock = lines.slice(1, endIndex).join("\n");
  const body = lines
    .slice(endIndex + 1)
    .join("\n")
    .replace(/^\n/, "");

  interface ServiceMdFrontmatter {
    name?: unknown;
    description?: unknown;
    url?: unknown;
    trust?: unknown;
    confirm?: unknown;
    pricing?: { note?: unknown };
  }

  let parsed: ServiceMdFrontmatter = {};
  try {
    parsed = YAML.parse(yamlBlock) as ServiceMdFrontmatter;
  } catch {
    return { name: "", description: "", body: raw };
  }

  const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);

  return {
    name: str(parsed.name),
    description: str(parsed.description),
    url: str(parsed.url) || undefined,
    trust: str(parsed.trust) || undefined,
    confirm: str(parsed.confirm) || undefined,
    pricingNote: str(parsed.pricing?.note) || undefined,
    body,
  };
}

export function parseSelectedSkills(raw: string): string[] {
  const lines = raw.split("\n");
  const fmEnd = lines.indexOf("---", 1);
  if (fmEnd === -1) {
    return [];
  }

  const yamlBlock = lines.slice(1, fmEnd).join("\n");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = YAML.parse(yamlBlock) as Record<string, unknown>;
  } catch {
    return [];
  }

  const skillsRaw = parsed.skills;
  if (!Array.isArray(skillsRaw)) {
    return [];
  }

  return skillsRaw
    .map((s) => {
      if (typeof s === "string") {
        return s.replace(/^\s*-\s*/, "").trim();
      }
      if (typeof s === "object" && s !== null && "path" in s) {
        const p = String((s as Record<string, unknown>).path);
        const match = p.match(/^\/skills\/([^/]+)\/SKILL\.md$/);
        return match ? match[1] : null;
      }
      return null;
    })
    .filter((s): s is string => s !== null && s !== "");
}

export function buildServiceMdContent(params: ServiceInitParams): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`name: ${params.name}`);
  lines.push(`description: "${params.description}"`);
  lines.push(`url: ${params.url || "https://your-service-host.example.com/v1/invoke"}`);

  if (params.trust) {
    lines.push(`trust: ${params.trust}`);
  }
  if (params.confirm) {
    lines.push(`confirm: ${params.confirm}`);
  }

  if (params.pricingNote) {
    lines.push("pricing:");
    lines.push(`  model: per_request`);
    lines.push(`  note: "${params.pricingNote}"`);
  }

  if (params.selectedSkills.length > 0) {
    lines.push("skills:");
    for (const skillName of params.selectedSkills) {
      lines.push(`  - path: /skills/${skillName}/SKILL.md`);
    }
  }

  lines.push("---");
  lines.push("");

  lines.push(`# ${params.name}`);
  lines.push("");
  if (params.body) {
    lines.push(params.body);
  } else {
    lines.push(params.description);
    if (params.selectedSkills.length > 0) {
      lines.push("");
      lines.push("## Available Skills");
      lines.push("");
      for (const skill of params.selectedSkills) {
        lines.push(`- **${skill}**`);
      }
    }
  }

  return lines.join("\n") + "\n";
}

function resolveEligibleSkills(
  workspaceDir: string,
  config?: OpenClawConfig,
): { entries: SkillEntry[]; eligible: SkillEntry[]; eligibleSet: Set<string> } {
  const entries = loadWorkspaceSkillEntries(workspaceDir, { config });
  const eligible = filterWorkspaceSkillEntries(entries, config);
  const eligibleSet = new Set<string>(eligible.map((e) => e.skill.name));
  return { entries, eligible, eligibleSet };
}

export function writeServiceMd(params: {
  workspaceDir: string;
  serviceParams: ServiceInitParams;
  config?: OpenClawConfig;
}): { filePath: string; copiedSkills: string[]; removedSkills: string[] } {
  const { eligible, eligibleSet } = resolveEligibleSkills(params.workspaceDir, params.config);
  const eligibleSkillNames = params.serviceParams.selectedSkills.filter((n) => eligibleSet.has(n));
  const removed = params.serviceParams.selectedSkills.filter((n) => !eligibleSet.has(n));

  const content = buildServiceMdContent({
    ...params.serviceParams,
    selectedSkills: eligibleSkillNames,
  });

  const serviceMdPath = path.join(params.workspaceDir, "SERVICE.md");
  fs.writeFileSync(serviceMdPath, content, "utf-8");

  const serviceSkillsDir = path.join(params.workspaceDir, "service-skills");
  const entryMap = new Map<string, SkillEntry>(eligible.map((e) => [e.skill.name, e]));

  const copiedSkills: string[] = [];
  for (const skillName of eligibleSkillNames) {
    const entry = entryMap.get(skillName);
    if (!entry) {
      continue;
    }

    const targetDir = path.join(serviceSkillsDir, skillName);
    fs.mkdirSync(targetDir, { recursive: true });

    try {
      const skillContent = fs.readFileSync(entry.skill.filePath, "utf-8");
      fs.writeFileSync(path.join(targetDir, "SKILL.md"), skillContent, "utf-8");
      copiedSkills.push(skillName);
    } catch {
      servicesLogger.warn("Failed to copy skill for service.", {
        skill: skillName,
        source: entry.skill.filePath,
      });
    }
  }

  const removedSkills: string[] = [];
  for (const skillName of removed) {
    const targetDir = path.join(serviceSkillsDir, skillName);
    try {
      fs.rmSync(targetDir, { recursive: true, force: true });
      removedSkills.push(skillName);
    } catch {
      servicesLogger.warn("Failed to remove orphaned skill directory.", {
        skill: skillName,
        path: targetDir,
      });
    }
  }

  return { filePath: serviceMdPath, copiedSkills, removedSkills };
}
