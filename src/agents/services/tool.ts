import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "../tools/common.js";
import { jsonResult, readStringParam } from "../tools/common.js";
import { invokeService } from "./invoke.js";
import type { ServiceEntry } from "./types.js";

/**
 * Determine whether the agent should confirm with the user before calling a service.
 */
function shouldConfirmBeforeInvoke(entry: ServiceEntry): boolean {
  const confirm = entry.manifest.confirm ?? "auto";
  if (confirm === "always") {
    return true;
  }
  if (confirm === "never") {
    return false;
  }
  // "auto": confirm if service has pricing that is not free
  const pricing = entry.manifest.pricing;
  if (pricing && pricing.model && pricing.model.toLowerCase() !== "free") {
    return true;
  }
  return false;
}

/**
 * Create an agent tool for a given service entry.
 */
export function createServiceTool(
  entry: ServiceEntry,
  options?: {
    config?: OpenClawConfig;
    agentSessionKey?: string;
  },
): AnyAgentTool {
  const serviceName = entry.manifest.name;
  const toolName = `service_${serviceName.replace(/[^a-z0-9_]/gi, "_")}`;
  const hasMultipleSkills = entry.skillNames.length > 1;
  const needsConfirm = shouldConfirmBeforeInvoke(entry);

  const pricingNote = entry.manifest.pricing?.note
    ? ` Pricing: ${entry.manifest.pricing.note}.`
    : "";
  const skillList =
    entry.skillNames.length > 0 ? ` Available skills: ${entry.skillNames.join(", ")}.` : "";

  const trust = entry.manifest.trust ?? "external";
  const trustWarning =
    trust === "external"
      ? " IMPORTANT: Do NOT include secrets, credentials, API keys, or sensitive data in the task."
      : "";

  const description = `${entry.manifest.description}${pricingNote}${skillList}${trustWarning}`;

  // Build schema based on whether service has multiple skills
  const parameters = hasMultipleSkills
    ? Type.Object({
        skill: Type.String({
          description: `Which skill to invoke. One of: ${entry.skillNames.join(", ")}.`,
        }),
        task: Type.String({
          description: "The task description to send to the service.",
        }),
        confirmed: Type.Optional(
          Type.Boolean({
            description:
              "Set to true after the user has confirmed they want to call this service. Required for paid services.",
          }),
        ),
      })
    : Type.Object({
        task: Type.String({
          description: "The task description to send to the service.",
        }),
        confirmed: Type.Optional(
          Type.Boolean({
            description:
              "Set to true after the user has confirmed they want to call this service. Required for paid services.",
          }),
        ),
      });

  return {
    label: `Service: ${serviceName}`,
    name: toolName,
    description,
    parameters,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const task = readStringParam(params, "task", { required: true });
      const skill = hasMultipleSkills
        ? readStringParam(params, "skill", { required: true })
        : readStringParam(params, "skill");
      const confirmed = typeof params.confirmed === "boolean" ? params.confirmed : false;

      // Confirmation gate for paid services
      if (needsConfirm && !confirmed) {
        const pricingInfo = entry.manifest.pricing?.note ?? "This service may incur costs";
        return jsonResult({
          status: "confirmation_required",
          message: `This service requires confirmation before use. ${pricingInfo}. Please ask the user if they want to proceed, then re-call this tool with confirmed=true.`,
          service: serviceName,
          skill: skill ?? undefined,
        });
      }

      // Validate skill name if provided
      if (skill && entry.skillNames.length > 0 && !entry.skillNames.includes(skill)) {
        return jsonResult({
          status: "error",
          message: `Unknown skill "${skill}". Available skills: ${entry.skillNames.join(", ")}.`,
        });
      }

      const response = await invokeService(entry, {
        skill,
        task,
        agentId: options?.agentSessionKey,
        servicesConfig: options?.config?.services,
      });

      if (response.status === "error") {
        return jsonResult({
          status: "error",
          service: serviceName,
          error: response.error?.message ?? "Service returned an error.",
          code: response.error?.code,
        });
      }

      return jsonResult({
        status: "ok",
        service: serviceName,
        skill: skill ?? undefined,
        result: response.result ?? "",
        usage: response.usage,
        metadata: response.metadata,
        externalContent: {
          untrusted: true,
          source: `service:${serviceName}`,
        },
      });
    },
  };
}

/**
 * Create tools for all provided service entries.
 */
export function createServiceTools(
  entries: ServiceEntry[],
  options?: {
    config?: OpenClawConfig;
    agentSessionKey?: string;
  },
): AnyAgentTool[] {
  return entries.map((entry) => createServiceTool(entry, options));
}
