import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import {
  extractServiceBody,
  parseServiceFrontmatter,
  resolveServiceManifest,
} from "./frontmatter.js";
import type { ServiceEntry } from "./types.js";

const servicesLogger = createSubsystemLogger("services");

const DEFAULT_MAX_SERVICE_FILE_BYTES = 256_000;
const DEFAULT_MAX_SERVICES_LOADED = 100;

type ServicesLoadLimits = {
  maxServiceFileBytes: number;
  maxServicesLoaded: number;
};

function resolveServicesLimits(_config?: OpenClawConfig): ServicesLoadLimits {
  return {
    maxServiceFileBytes: DEFAULT_MAX_SERVICE_FILE_BYTES,
    maxServicesLoaded: DEFAULT_MAX_SERVICES_LOADED,
  };
}

function listChildDirectories(dir: string): string[] {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (entry.name === "node_modules") {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(entry.name);
        continue;
      }
      if (entry.isSymbolicLink()) {
        try {
          if (fs.statSync(fullPath).isDirectory()) {
            dirs.push(entry.name);
          }
        } catch {
          // ignore broken symlinks
        }
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

function loadServiceFromDir(
  serviceDir: string,
  source: ServiceEntry["source"],
  limits: ServicesLoadLimits,
): ServiceEntry | null {
  const serviceMd = path.join(serviceDir, "SERVICE.md");
  if (!fs.existsSync(serviceMd)) {
    return null;
  }

  try {
    const stat = fs.statSync(serviceMd);
    if (stat.size > limits.maxServiceFileBytes) {
      servicesLogger.warn("Skipping service due to oversized SERVICE.md.", {
        filePath: serviceMd,
        size: stat.size,
        maxServiceFileBytes: limits.maxServiceFileBytes,
      });
      return null;
    }
  } catch {
    return null;
  }

  let content: string;
  try {
    content = fs.readFileSync(serviceMd, "utf-8");
  } catch {
    return null;
  }

  const frontmatter = parseServiceFrontmatter(content);
  const manifest = resolveServiceManifest(frontmatter);
  if (!manifest) {
    servicesLogger.warn("Skipping service with invalid manifest.", {
      filePath: serviceMd,
    });
    return null;
  }

  const promptBody = extractServiceBody(content);

  // Discover skill names from the service's skills subdirectory
  const skillNames = discoverServiceSkillNames(serviceDir);

  return {
    manifest,
    promptBody,
    source,
    filePath: serviceMd,
    skillNames,
  };
}

/**
 * Discover SKILL.md files in a service's skills subdirectory.
 * Returns the list of skill directory names (which serve as skill identifiers).
 */
function discoverServiceSkillNames(serviceDir: string): string[] {
  const skillsDir = path.join(serviceDir, "skills");
  if (!fs.existsSync(skillsDir)) {
    return [];
  }

  const names: string[] = [];
  const childDirs = listChildDirectories(skillsDir);
  for (const name of childDirs) {
    const skillMd = path.join(skillsDir, name, "SKILL.md");
    if (fs.existsSync(skillMd)) {
      names.push(name);
    }
  }
  return names.toSorted();
}

function loadServicesFromRoot(
  rootDir: string,
  source: ServiceEntry["source"],
  limits: ServicesLoadLimits,
): ServiceEntry[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const entries: ServiceEntry[] = [];
  const childDirs = listChildDirectories(rootDir);

  for (const name of childDirs) {
    if (entries.length >= limits.maxServicesLoaded) {
      servicesLogger.warn("Services root has too many entries, truncating.", {
        dir: rootDir,
        maxServicesLoaded: limits.maxServicesLoaded,
      });
      break;
    }

    const serviceDir = path.join(rootDir, name);
    const entry = loadServiceFromDir(serviceDir, source, limits);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Check if a service's required environment variables are available.
 */
function isServiceEligible(entry: ServiceEntry): boolean {
  const auth = entry.manifest.auth;
  if (auth && auth.type !== "none" && auth.env) {
    if (!process.env[auth.env]) {
      return false;
    }
  }
  return true;
}

export function loadServiceEntries(
  workspaceDir: string,
  opts?: {
    config?: OpenClawConfig;
    managedServicesDir?: string;
  },
): ServiceEntry[] {
  const limits = resolveServicesLimits(opts?.config);
  const servicesConfig = opts?.config?.services;

  if (servicesConfig?.enabled === false) {
    return [];
  }

  const managedServicesDir = opts?.managedServicesDir ?? path.join(CONFIG_DIR, "services");
  const workspaceServicesDir = path.resolve(workspaceDir, "services");
  const extraDirsRaw = servicesConfig?.load?.extraDirs ?? [];
  const extraDirs = extraDirsRaw
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter(Boolean);

  // Load from each source
  const extraServices = extraDirs.flatMap((dir) => {
    const resolved = resolveUserPath(dir);
    return loadServicesFromRoot(resolved, "plugin", limits);
  });
  const managedServices = loadServicesFromRoot(managedServicesDir, "managed", limits);
  const workspaceServices = loadServicesFromRoot(workspaceServicesDir, "workspace", limits);

  // Merge with precedence: extra < managed < workspace
  const merged = new Map<string, ServiceEntry>();
  for (const entry of extraServices) {
    merged.set(entry.manifest.name, entry);
  }
  for (const entry of managedServices) {
    merged.set(entry.manifest.name, entry);
  }
  for (const entry of workspaceServices) {
    merged.set(entry.manifest.name, entry);
  }

  return Array.from(merged.values());
}

/**
 * Load service entries and filter to only those with available auth credentials.
 */
export function loadEligibleServiceEntries(
  workspaceDir: string,
  opts?: {
    config?: OpenClawConfig;
    managedServicesDir?: string;
    serviceFilter?: string[];
  },
): ServiceEntry[] {
  let entries = loadServiceEntries(workspaceDir, opts);

  // Apply service filter (agent-level allowlist)
  if (opts?.serviceFilter !== undefined) {
    const allowed = new Set(opts.serviceFilter.map((s) => s.toLowerCase()));
    entries = entries.filter((e) => allowed.has(e.manifest.name.toLowerCase()));
  }

  return entries.filter(isServiceEligible);
}
