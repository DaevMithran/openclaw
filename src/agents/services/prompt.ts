import type { ServiceEntry } from "./types.js";

/**
 * Format service entries into a system prompt section that describes
 * available services and their skills to the agent.
 */
export function formatServicesForPrompt(entries: ServiceEntry[]): string {
  if (entries.length === 0) {
    return "";
  }

  const sections: string[] = [];

  sections.push("## Available Services");
  sections.push("");
  sections.push(
    "The following remote services are available as tools. Each service is called via its `service_<name>` tool.",
  );
  sections.push("");

  for (const entry of entries) {
    const m = entry.manifest;
    const trust = m.trust ?? "external";
    const trustLabel = trust === "external" ? "third-party" : "internal";

    sections.push(`### ${m.name} (${trustLabel})`);
    sections.push(`**Description:** ${m.description}`);

    if (m.pricing?.note) {
      sections.push(`**Pricing:** ${m.pricing.note}`);
    }

    if (entry.skillNames.length > 0) {
      sections.push(`**Skills:** ${entry.skillNames.join(", ")}`);
    }

    // Trust warning
    if (trust === "external") {
      sections.push(
        "**Security:** This is an external service. Do NOT send secrets, credentials, API keys, or sensitive data in the task payload.",
      );
    }

    // Include the SERVICE.md body as usage guidance
    if (entry.promptBody) {
      sections.push("");
      sections.push(entry.promptBody);
    }

    sections.push("");
  }

  return sections.join("\n").trim();
}
