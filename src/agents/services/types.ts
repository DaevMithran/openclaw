import type { OpenClawSkillMetadata } from "../skills/types.js";

export type ServiceAuthConfig = {
  type: "api_key" | "bearer" | "none";
  /** Environment variable name holding the credential. Required when type is not "none". */
  env?: string;
  /** Custom auth header name. Defaults to "Authorization" with "Bearer" prefix for "bearer" type. */
  header?: string;
};

export type ServiceSkillRef = { path: string; ref?: never } | { ref: string; path?: never };

export type ServiceManifest = {
  name: string;
  description: string;
  /** HTTPS URL for the service invoke endpoint. */
  url: string;
  auth?: ServiceAuthConfig;
  version?: string;
  /**
   * Confirmation policy before calling this service.
   * - "auto": confirm if the service has pricing (default)
   * - "always": always ask the user before calling
   * - "never": auto-approve (for trusted/internal services)
   */
  confirm?: "auto" | "always" | "never";
  /**
   * Trust level for data exposure.
   * - "external": third-party service — agent must not send secrets/credentials in task payload (default)
   * - "internal": same owner/org — agent may send workspace context but still avoids raw credentials
   */
  trust?: "external" | "internal";
  pricing?: {
    model?: string;
    note?: string;
  };
  /** References to SKILL.md files the service exposes. */
  skills?: ServiceSkillRef[];
  metadata?: {
    openclaw?: OpenClawSkillMetadata;
  };
};

export type ServiceEntry = {
  manifest: ServiceManifest;
  /** Markdown body from SERVICE.md (below frontmatter). */
  promptBody: string;
  source: "workspace" | "managed" | "bundled" | "plugin";
  /** Absolute path to the SERVICE.md file. */
  filePath: string;
  /** Skill names loaded from the service's skills directory. */
  skillNames: string[];
};

export type ServiceInvokeRequest = {
  version: "1";
  /** Which skill within the service to invoke. Optional for single-skill services. */
  skill?: string;
  /** The task description / prompt to send to the service. */
  task: string;
  context?: {
    agent_id?: string;
    service_id?: string;
  };
  options?: {
    max_tokens?: number;
    format?: string;
  };
};

export type ServiceInvokeResponse = {
  version: "1";
  status: "ok" | "error";
  result?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost_usd?: number;
  };
  metadata?: {
    model?: string;
    duration_ms?: number;
  };
  error?: {
    code?: string;
    message?: string;
    retryAfterMs?: number;
  };
};

export type ServicesConfig = {
  /** Enable/disable services feature. Default: true. */
  enabled?: boolean;
  load?: {
    /** Additional directories to scan for services. */
    extraDirs?: string[];
  };
  defaults?: {
    /** Default timeout for service invocations in ms. Default: 60000. */
    timeoutMs?: number;
    /** Maximum response body size in bytes. Default: 262144 (256KB). */
    maxResponseBytes?: number;
  };
};
