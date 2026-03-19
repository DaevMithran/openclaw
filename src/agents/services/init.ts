import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { SkillEntry } from "../skills/types.js";
import { loadWorkspaceSkillEntries } from "../skills/workspace.js";

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

/**
 * Resolve available skills from the workspace for the user to select from.
 */
export function resolveAvailableSkills(
  workspaceDir: string,
  config?: OpenClawConfig,
): Array<{ name: string; description: string }> {
  const entries = loadWorkspaceSkillEntries(workspaceDir, { config });
  return entries.map((entry) => ({
    name: entry.skill.name,
    description: entry.skill.description ?? entry.skill.name,
  }));
}

/**
 * Generate SERVICE.md content from init params.
 */
export function generateServiceMd(params: ServiceInitParams): string {
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

  // Generate body
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

/**
 * Write SERVICE.md to the workspace root.
 * Also copies selected SKILL.md files into a skills/ subdirectory
 * so the gateway can serve them at /skills/<name>/SKILL.md.
 */
export function writeServiceMd(params: {
  workspaceDir: string;
  content: string;
  selectedSkills: string[];
  config?: OpenClawConfig;
}): { filePath: string; copiedSkills: string[] } {
  const serviceMdPath = path.join(params.workspaceDir, "SERVICE.md");
  fs.writeFileSync(serviceMdPath, params.content, "utf-8");

  const copiedSkills: string[] = [];

  // If skills are selected, ensure they're available for serving
  if (params.selectedSkills.length > 0) {
    const entries = loadWorkspaceSkillEntries(params.workspaceDir, { config: params.config });
    const entryMap = new Map<string, SkillEntry>();
    for (const entry of entries) {
      entryMap.set(entry.skill.name, entry);
    }

    for (const skillName of params.selectedSkills) {
      const entry = entryMap.get(skillName);
      if (!entry) {
        continue;
      }

      // Copy SKILL.md to workspace service-skills directory for serving
      const targetDir = path.join(params.workspaceDir, "service-skills", skillName);
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
  }

  return { filePath: serviceMdPath, copiedSkills };
}
