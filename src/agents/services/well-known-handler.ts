import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const servicesLogger = createSubsystemLogger("services");

const WELL_KNOWN_SERVICE_PATH = "/.well-known/service.md";
const SKILLS_PATH_PREFIX = "/skills/";

/**
 * Handle HTTP requests for the well-known SERVICE.md endpoint
 * and skill file serving.
 *
 * Serves:
 * - GET /.well-known/service.md → workspace SERVICE.md
 * - GET /skills/<name>/SKILL.md → workspace service-skills/<name>/SKILL.md
 *
 * Returns true if the request was handled, false otherwise.
 */
export function handleServiceMetadataRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    workspaceDir: string;
  },
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return false;
  }

  const urlPath = req.url?.split("?")[0] ?? "";

  // Serve SERVICE.md at well-known path
  if (urlPath === WELL_KNOWN_SERVICE_PATH) {
    return serveServiceMd(res, opts.workspaceDir);
  }

  // Serve skill files at /skills/<name>/SKILL.md
  if (urlPath.startsWith(SKILLS_PATH_PREFIX) && urlPath.endsWith("/SKILL.md")) {
    return serveSkillMd(res, urlPath, opts.workspaceDir);
  }

  return false;
}

function serveServiceMd(res: ServerResponse, workspaceDir: string): boolean {
  const serviceMdPath = path.join(workspaceDir, "SERVICE.md");

  if (!fs.existsSync(serviceMdPath)) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("No SERVICE.md found. Run `openclaw services init` to create one.");
    return true;
  }

  try {
    const content = fs.readFileSync(serviceMdPath, "utf-8");
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.end(content);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    servicesLogger.warn("Failed to serve SERVICE.md.", { error: message });
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Internal Server Error");
    return true;
  }
}

function serveSkillMd(res: ServerResponse, urlPath: string, workspaceDir: string): boolean {
  // Extract skill name from /skills/<name>/SKILL.md
  const stripped = urlPath.slice(SKILLS_PATH_PREFIX.length);
  const slashIndex = stripped.indexOf("/");
  if (slashIndex === -1) {
    return false;
  }

  const skillName = stripped.slice(0, slashIndex);

  // Validate skill name to prevent path traversal
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
    const message = error instanceof Error ? error.message : String(error);
    servicesLogger.warn("Failed to serve SKILL.md.", { skill: skillName, error: message });
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Internal Server Error");
    return true;
  }
}
