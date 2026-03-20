import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { filterWorkspaceSkillEntries, loadWorkspaceSkillEntries } from "../skills/workspace.js";
import { buildServiceMdContent, parseSelectedSkills, parseServiceMd } from "./init.js";

const servicesLogger = createSubsystemLogger("services");

const WELL_KNOWN_SERVICE_PATH = "/.well-known/service.md";
const SKILLS_PATH_PREFIX = "/skills/";

export function handleServiceMetadataRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    workspaceDir: string;
    config?: OpenClawConfig;
  },
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const urlPath = req.url?.split("?")[0] ?? "";

  if (urlPath === WELL_KNOWN_SERVICE_PATH) {
    return serveServiceMd(res, opts.workspaceDir, opts.config);
  }

  if (urlPath.startsWith(SKILLS_PATH_PREFIX) && urlPath.endsWith("/SKILL.md")) {
    return serveSkillMd(res, urlPath, opts.workspaceDir, opts.config);
  }

  return false;
}

function serveServiceMd(
  res: ServerResponse,
  workspaceDir: string,
  config?: OpenClawConfig,
): boolean {
  const serviceMdPath = path.join(workspaceDir, "SERVICE.md");

  if (!fs.existsSync(serviceMdPath)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("No SERVICE.md found. Run `openclaw services init` to create one.");
    return true;
  }

  let rawContent: string;
  try {
    rawContent = fs.readFileSync(serviceMdPath, "utf-8");
  } catch (error) {
    servicesLogger.warn("Failed to read SERVICE.md.", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Internal Server Error");
    return true;
  }

  const parsed = parseServiceMd(rawContent);
  const selectedSkills = parseSelectedSkills(rawContent);

  const { eligibleSet } = resolveEligibleSkills(workspaceDir, config);
  const eligibleSkillNames = selectedSkills.filter((n) => eligibleSet.has(n));

  cleanOrphanedSkillDirs(workspaceDir, eligibleSet);

  let content = rawContent;
  if (eligibleSkillNames.length !== selectedSkills.length) {
    content = buildServiceMdContent({
      name: parsed.name,
      description: parsed.description,
      url: parsed.url,
      trust: parsed.trust as "external" | "internal" | undefined,
      confirm: parsed.confirm as "auto" | "always" | "never" | undefined,
      pricingNote: parsed.pricingNote,
      selectedSkills: eligibleSkillNames,
      body: parsed.body,
    });
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.end(content);
  return true;
}

function resolveEligibleSkills(workspaceDir: string, config?: OpenClawConfig) {
  const entries = loadWorkspaceSkillEntries(workspaceDir, { config });
  const eligible = filterWorkspaceSkillEntries(entries, config);
  const eligibleSet = new Set<string>(eligible.map((e) => e.skill.name));
  return { eligible, eligibleSet };
}

function cleanOrphanedSkillDirs(workspaceDir: string, eligibleSkills: Set<string>): void {
  const serviceSkillsDir = path.join(workspaceDir, "service-skills");
  if (!fs.existsSync(serviceSkillsDir)) {
    return;
  }

  try {
    const entries = fs.readdirSync(serviceSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (!eligibleSkills.has(entry.name)) {
        try {
          fs.rmSync(path.join(serviceSkillsDir, entry.name), { recursive: true, force: true });
        } catch {
          // ignore cleanup failures
        }
      }
    }
  } catch {
    // ignore directory scan failures
  }
}

function serveSkillMd(
  res: ServerResponse,
  urlPath: string,
  workspaceDir: string,
  config?: OpenClawConfig,
): boolean {
  const stripped = urlPath.slice(SKILLS_PATH_PREFIX.length);
  const slashIndex = stripped.indexOf("/");
  if (slashIndex === -1) {
    return false;
  }

  const skillName = stripped.slice(0, slashIndex);

  if (
    !skillName ||
    skillName.includes("..") ||
    skillName.includes("/") ||
    skillName.includes("\\")
  ) {
    res.statusCode = 400;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Invalid skill name.");
    return true;
  }

  const { eligibleSet } = resolveEligibleSkills(workspaceDir, config);

  if (!eligibleSet.has(skillName)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Skill "${skillName}" is not available or not eligible.`);
    return true;
  }

  const skillMdPath = path.join(workspaceDir, "service-skills", skillName, "SKILL.md");

  if (!fs.existsSync(skillMdPath)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(`Skill "${skillName}" not found.`);
    return true;
  }

  try {
    const content = fs.readFileSync(skillMdPath, "utf-8");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(content);
    return true;
  } catch (error) {
    servicesLogger.warn("Failed to serve SKILL.md.", {
      skill: skillName,
      error: error instanceof Error ? error.message : String(error),
    });
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Internal Server Error");
    return true;
  }
}
