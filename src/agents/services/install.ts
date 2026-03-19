import fs from "node:fs";
import path from "node:path";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { CONFIG_DIR } from "../../utils.js";
import { parseServiceFrontmatter, resolveServiceManifest } from "./frontmatter.js";

const servicesLogger = createSubsystemLogger("services");

const WELL_KNOWN_PATH = "/.well-known/service.md";
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;

export type InstallServiceResult =
  | { ok: true; name: string; targetDir: string; skillCount: number }
  | { ok: false; error: string };

/**
 * Resolve the SERVICE.md URL from the user-provided URL.
 * If the URL has no meaningful path, append the well-known path.
 */
function resolveServiceMdUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }

    // If URL ends with / or has no path, append well-known path
    const pathname = parsed.pathname;
    if (pathname === "/" || pathname === "") {
      parsed.pathname = WELL_KNOWN_PATH;
      return parsed.toString();
    }

    // If URL already points to a .md file, use as-is
    if (pathname.endsWith(".md")) {
      return parsed.toString();
    }

    // Otherwise append well-known path
    if (!pathname.endsWith("/")) {
      parsed.pathname = pathname + WELL_KNOWN_PATH;
    } else {
      parsed.pathname = pathname + WELL_KNOWN_PATH.slice(1);
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Resolve the base URL from a service URL for fetching relative skill paths.
 */
function resolveServiceBaseUrl(serviceUrl: string): string {
  try {
    const parsed = new URL(serviceUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return serviceUrl;
  }
}

/**
 * Fetch a text resource from a URL with timeout.
 */
async function fetchText(
  url: string,
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "OpenClaw/1.0" },
    });
    clearTimeout(timer);

    if (!response.ok) {
      servicesLogger.warn("Fetch failed.", { url, status: response.status });
      return null;
    }

    return await response.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    servicesLogger.warn("Fetch error.", { url, error: message });
    return null;
  }
}

/**
 * Fetch and save skill files referenced in the service manifest.
 */
async function fetchServiceSkills(params: {
  serviceBaseUrl: string;
  skills: Array<{ path?: string; ref?: string }>;
  targetDir: string;
}): Promise<number> {
  const skillsDir = path.join(params.targetDir, "skills");
  let count = 0;

  for (const skillRef of params.skills) {
    let skillUrl: string | null = null;
    let skillName: string | null = null;

    if (skillRef.path) {
      // Relative to service base URL
      skillUrl = params.serviceBaseUrl + skillRef.path;
      // Extract skill name from path: /skills/review/SKILL.md -> review
      const parts = skillRef.path.split("/").filter(Boolean);
      const skillMdIndex = parts.findIndex((p) => p.toUpperCase() === "SKILL.MD");
      skillName = skillMdIndex > 0 ? parts[skillMdIndex - 1] : parts[0];
    } else if (skillRef.ref) {
      if (skillRef.ref.startsWith("clawhub://")) {
        // ClawHub refs — for now, log a warning (ClawHub integration TBD)
        servicesLogger.warn("ClawHub skill refs not yet supported.", { ref: skillRef.ref });
        continue;
      } else if (skillRef.ref.startsWith("https://") || skillRef.ref.startsWith("http://")) {
        skillUrl = skillRef.ref;
        // Extract name from URL path
        const urlPath = new URL(skillRef.ref).pathname;
        const parts = urlPath.split("/").filter(Boolean);
        const skillMdIndex = parts.findIndex((p) => p.toUpperCase() === "SKILL.MD");
        skillName =
          skillMdIndex > 0
            ? parts[skillMdIndex - 1]
            : parts[parts.length - 1]?.replace(/\.md$/i, "");
      }
    }

    if (!skillUrl || !skillName) {
      continue;
    }

    const content = await fetchText(skillUrl);
    if (!content) {
      servicesLogger.warn("Failed to fetch skill.", { url: skillUrl, name: skillName });
      continue;
    }

    const skillDir = path.join(skillsDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf-8");
    count++;

    servicesLogger.debug("Fetched skill.", { name: skillName, url: skillUrl });
  }

  return count;
}

/**
 * Install a service from a URL.
 *
 * 1. Resolves the SERVICE.md URL (well-known path if needed)
 * 2. Fetches and parses the SERVICE.md
 * 3. Saves to ~/.openclaw/services/<name>/SERVICE.md
 * 4. Fetches referenced skill files
 */
export async function installService(rawUrl: string): Promise<InstallServiceResult> {
  const serviceMdUrl = resolveServiceMdUrl(rawUrl);
  if (!serviceMdUrl) {
    return { ok: false, error: `Invalid URL: ${rawUrl}. Must be an HTTPS URL.` };
  }

  servicesLogger.debug("Fetching SERVICE.md.", { url: serviceMdUrl });

  const content = await fetchText(serviceMdUrl);
  if (!content) {
    return {
      ok: false,
      error: `Failed to fetch SERVICE.md from ${serviceMdUrl}. Is the URL correct?`,
    };
  }

  const frontmatter = parseServiceFrontmatter(content);
  const manifest = resolveServiceManifest(frontmatter);
  if (!manifest) {
    return {
      ok: false,
      error: "SERVICE.md has invalid or missing required fields (name, description, url).",
    };
  }

  const servicesDir = path.join(CONFIG_DIR, "services");
  const targetDir = path.join(servicesDir, manifest.name);

  // Save SERVICE.md
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "SERVICE.md"), content, "utf-8");

  // Fetch referenced skills
  let skillCount = 0;
  if (manifest.skills && manifest.skills.length > 0) {
    const baseUrl = resolveServiceBaseUrl(manifest.url);
    skillCount = await fetchServiceSkills({
      serviceBaseUrl: baseUrl,
      skills: manifest.skills,
      targetDir,
    });
  }

  servicesLogger.debug("Service installed.", {
    name: manifest.name,
    targetDir,
    skillCount,
  });

  return { ok: true, name: manifest.name, targetDir, skillCount };
}

/**
 * Uninstall a service by removing its directory from ~/.openclaw/services/.
 */
export function uninstallService(serviceId: string): { ok: boolean; error?: string } {
  const servicesDir = path.join(CONFIG_DIR, "services");
  const targetDir = path.join(servicesDir, serviceId);

  if (!fs.existsSync(targetDir)) {
    return { ok: false, error: `Service "${serviceId}" not found.` };
  }

  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
    servicesLogger.debug("Service uninstalled.", { serviceId });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to uninstall: ${message}` };
  }
}
