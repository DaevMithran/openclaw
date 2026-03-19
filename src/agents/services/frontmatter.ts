import { parseFrontmatterBlock } from "../../markdown/frontmatter.js";
import { getFrontmatterString } from "../../shared/frontmatter.js";
import type { ServiceAuthConfig, ServiceManifest, ServiceSkillRef } from "./types.js";

export type ParsedServiceFrontmatter = Record<string, string>;

export function parseServiceFrontmatter(content: string): ParsedServiceFrontmatter {
  return parseFrontmatterBlock(content);
}

/**
 * Extract the markdown body (below frontmatter) from SERVICE.md content.
 */
export function extractServiceBody(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) {
    return normalized.trim();
  }
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return "";
  }
  // Skip past the closing "---" and newline
  const bodyStart = normalized.indexOf("\n", endIndex + 4);
  if (bodyStart === -1) {
    return "";
  }
  return normalized.slice(bodyStart + 1).trim();
}

function parseAuthConfig(frontmatter: ParsedServiceFrontmatter): ServiceAuthConfig | undefined {
  const raw = getFrontmatterString(frontmatter, "auth");
  if (!raw) {
    return undefined;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  const type = typeof parsed.type === "string" ? parsed.type.trim().toLowerCase() : "none";
  if (type !== "api_key" && type !== "bearer" && type !== "none") {
    return undefined;
  }

  const env = typeof parsed.env === "string" ? parsed.env.trim() : undefined;
  const header = typeof parsed.header === "string" ? parsed.header.trim() : undefined;

  // env is required when auth type is not "none"
  if (type !== "none" && !env) {
    return undefined;
  }

  return { type, env: env || undefined, header: header || undefined };
}

function parsePricing(
  frontmatter: ParsedServiceFrontmatter,
): { model?: string; note?: string } | undefined {
  const raw = getFrontmatterString(frontmatter, "pricing");
  if (!raw) {
    return undefined;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!parsed || typeof parsed !== "object") {
    return undefined;
  }

  return {
    model: typeof parsed.model === "string" ? parsed.model.trim() : undefined,
    note: typeof parsed.note === "string" ? parsed.note.trim() : undefined,
  };
}

function parseSkillRefs(frontmatter: ParsedServiceFrontmatter): ServiceSkillRef[] | undefined {
  const raw = getFrontmatterString(frontmatter, "skills");
  if (!raw) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!Array.isArray(parsed)) {
    return undefined;
  }

  const refs: ServiceSkillRef[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.path === "string" && obj.path.trim()) {
      refs.push({ path: obj.path.trim() });
    } else if (typeof obj.ref === "string" && obj.ref.trim()) {
      refs.push({ ref: obj.ref.trim() });
    }
  }

  return refs.length > 0 ? refs : undefined;
}

function validateServiceUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function resolveServiceManifest(
  frontmatter: ParsedServiceFrontmatter,
): ServiceManifest | null {
  const name = getFrontmatterString(frontmatter, "name")?.trim();
  const description = getFrontmatterString(frontmatter, "description")?.trim();
  const rawUrl = getFrontmatterString(frontmatter, "url")?.trim();

  if (!name || !description || !rawUrl) {
    return null;
  }

  const url = validateServiceUrl(rawUrl);
  if (!url) {
    return null;
  }

  const auth = parseAuthConfig(frontmatter);
  const version = getFrontmatterString(frontmatter, "version")?.trim();

  const confirmRaw = getFrontmatterString(frontmatter, "confirm")?.trim().toLowerCase();
  const confirm =
    confirmRaw === "always" || confirmRaw === "never" || confirmRaw === "auto"
      ? confirmRaw
      : undefined;

  const trustRaw = getFrontmatterString(frontmatter, "trust")?.trim().toLowerCase();
  const trust = trustRaw === "internal" || trustRaw === "external" ? trustRaw : undefined;

  const pricing = parsePricing(frontmatter);
  const skills = parseSkillRefs(frontmatter);

  return {
    name,
    description,
    url,
    ...(auth ? { auth } : {}),
    ...(version ? { version } : {}),
    ...(confirm ? { confirm } : {}),
    ...(trust ? { trust } : {}),
    ...(pricing ? { pricing } : {}),
    ...(skills ? { skills } : {}),
  };
}
