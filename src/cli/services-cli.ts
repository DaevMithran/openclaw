import type { Command } from "commander";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { installService, uninstallService } from "../agents/services/install.js";
import type { ServiceEntry } from "../agents/services/types.js";
import { loadServiceEntries, loadEligibleServiceEntries } from "../agents/services/workspace.js";
import { loadConfig } from "../config/config.js";
import { resolveGatewayPort } from "../config/paths.js";
import { pickPrimaryLanIPv4 } from "../gateway/net.js";
import { defaultRuntime } from "../runtime.js";
import { theme } from "../terminal/theme.js";

function formatServiceList(
  entries: ServiceEntry[],
  opts: { json?: boolean; eligible?: boolean; verbose?: boolean },
): string {
  if (opts.json) {
    return JSON.stringify(
      entries.map((e) => ({
        name: e.manifest.name,
        description: e.manifest.description,
        url: e.manifest.url,
        version: e.manifest.version,
        trust: e.manifest.trust ?? "external",
        confirm: e.manifest.confirm ?? "auto",
        skills: e.skillNames,
        source: e.source,
        pricing: e.manifest.pricing,
        auth: e.manifest.auth
          ? { type: e.manifest.auth.type, env: e.manifest.auth.env }
          : undefined,
      })),
      null,
      2,
    );
  }

  if (entries.length === 0) {
    return `${theme.muted("No services installed.")}\n\nInstall a service with: ${theme.accent("openclaw services install <url>")}, to provide your openclaw as a service: ${theme.accent("openclaw services init")}`;
  }

  const lines: string[] = [];
  lines.push(`${theme.bold("Services")} (${entries.length})\n`);

  for (const entry of entries) {
    const m = entry.manifest;
    const trustBadge =
      (m.trust ?? "external") === "external"
        ? theme.muted("[external]")
        : theme.accent("[internal]");
    const skills = entry.skillNames.length > 0 ? ` (${entry.skillNames.join(", ")})` : "";
    lines.push(`  ${theme.accent(m.name)} ${trustBadge}${skills}`);
    lines.push(`    ${theme.muted(m.description)}`);

    if (opts.verbose) {
      lines.push(`    ${theme.muted("URL:")} ${m.url}`);
      if (m.version) {
        lines.push(`    ${theme.muted("Version:")} ${m.version}`);
      }
      if (m.pricing?.note) {
        lines.push(`    ${theme.muted("Pricing:")} ${m.pricing.note}`);
      }
      if (m.auth) {
        lines.push(`    ${theme.muted("Auth:")} ${m.auth.type} (env: ${m.auth.env ?? "none"})`);
      }
      lines.push(`    ${theme.muted("Source:")} ${entry.source}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatServiceInfo(
  entries: ServiceEntry[],
  name: string,
  opts: { json?: boolean },
): string {
  const entry = entries.find((e) => e.manifest.name.toLowerCase() === name.toLowerCase());
  if (!entry) {
    return `Service "${name}" not found. Run ${theme.accent("openclaw services list")} to see available services.`;
  }

  const m = entry.manifest;

  if (opts.json) {
    return JSON.stringify(
      {
        name: m.name,
        description: m.description,
        url: m.url,
        version: m.version,
        trust: m.trust ?? "external",
        confirm: m.confirm ?? "auto",
        skills: entry.skillNames,
        source: entry.source,
        pricing: m.pricing,
        auth: m.auth ? { type: m.auth.type, env: m.auth.env } : undefined,
        filePath: entry.filePath,
      },
      null,
      2,
    );
  }

  const lines: string[] = [];
  lines.push(theme.bold(m.name));
  lines.push(`${theme.muted("Description:")} ${m.description}`);
  lines.push(`${theme.muted("URL:")} ${m.url}`);
  lines.push(`${theme.muted("Trust:")} ${m.trust ?? "external"}`);
  lines.push(`${theme.muted("Confirm:")} ${m.confirm ?? "auto"}`);
  if (m.version) {
    lines.push(`${theme.muted("Version:")} ${m.version}`);
  }
  if (m.pricing?.note) {
    lines.push(`${theme.muted("Pricing:")} ${m.pricing.note}`);
  }
  if (m.auth) {
    lines.push(`${theme.muted("Auth:")} ${m.auth.type} (env: ${m.auth.env ?? "none"})`);
  }
  if (entry.skillNames.length > 0) {
    lines.push(`${theme.muted("Skills:")} ${entry.skillNames.join(", ")}`);
  }
  lines.push(`${theme.muted("Source:")} ${entry.source}`);
  lines.push(`${theme.muted("File:")} ${entry.filePath}`);

  return lines.join("\n");
}

/**
 * Register the services CLI commands.
 */
export function registerServicesCli(program: Command) {
  const services = program
    .command("services")
    .description("Manage remote services (init, install, list, info, uninstall)");

  services
    .command("list")
    .description("List all installed services")
    .option("--json", "Output as JSON", false)
    .option("--eligible", "Show only eligible (auth configured) services", false)
    .option("-v, --verbose", "Show more details", false)
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
        const entries = opts.eligible
          ? loadEligibleServiceEntries(workspaceDir, { config })
          : loadServiceEntries(workspaceDir, { config });
        defaultRuntime.log(formatServiceList(entries, opts));
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  services
    .command("info")
    .description("Show detailed information about a service")
    .argument("<name>", "Service name")
    .option("--json", "Output as JSON", false)
    .action(async (name, opts) => {
      try {
        const config = loadConfig();
        const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
        const entries = loadServiceEntries(workspaceDir, { config });
        defaultRuntime.log(formatServiceInfo(entries, name, opts));
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  services
    .command("install")
    .description("Install a service from a URL")
    .argument("<url>", "Service URL (or URL to SERVICE.md)")
    .action(async (url) => {
      try {
        defaultRuntime.log(`Installing service from ${theme.accent(url)}...`);
        const result = await installService(url);
        if (!result.ok) {
          defaultRuntime.error(result.error);
          defaultRuntime.exit(1);
          return;
        }
        defaultRuntime.log(
          `${theme.accent("✓")} Service "${result.name}" installed.` +
            (result.skillCount > 0
              ? ` (${result.skillCount} skill${result.skillCount > 1 ? "s" : ""} fetched)`
              : ""),
        );
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  services
    .command("uninstall")
    .description("Uninstall a service")
    .argument("<id>", "Service name/id")
    .action(async (id) => {
      try {
        const result = uninstallService(id);
        if (!result.ok) {
          defaultRuntime.error(result.error ?? "Unknown error.");
          defaultRuntime.exit(1);
          return;
        }
        defaultRuntime.log(`${theme.accent("✓")} Service "${id}" uninstalled.`);
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  services
    .command("init")
    .description("Create a SERVICE.md to expose this agent as a service")
    .option("--name <name>", "Service name (kebab-case)")
    .option("--description <desc>", "Service description")
    .option("--url <url>", "Service invoke URL")
    .option("--trust <trust>", "Trust level: external or internal", "internal")
    .option("--confirm <confirm>", "Confirmation policy: auto, always, or never", "auto")
    .option("--all-skills", "Expose all available skills", false)
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));

        const { resolveAvailableSkills, writeServiceMd } =
          await import("../agents/services/init.js");
        const { createClackPrompter } = await import("../wizard/clack-prompter.js");

        const prompter = createClackPrompter();
        await prompter.intro("Create SERVICE.md");

        // 1. Service name
        const name =
          opts.name ??
          (await prompter.text({
            message: "Service name (kebab-case)",
            placeholder: "my-agent-service",
            validate: (v) => {
              if (!v.trim()) {
                return "Name is required.";
              }
              if (!/^[a-z0-9][a-z0-9-]*$/.test(v.trim())) {
                return "Must be lowercase kebab-case.";
              }
              return undefined;
            },
          }));

        // 2. Description
        const description =
          opts.description ??
          (await prompter.text({
            message: "Description",
            placeholder: "What does this service do?",
            validate: (v) => (!v.trim() ? "Description is required." : undefined),
          }));

        // 3. URL
        const detectedIp = pickPrimaryLanIPv4();
        const detectedPort = resolveGatewayPort(config);
        const defaultUrl = detectedIp
          ? `http://${detectedIp}:${detectedPort}/v1/invoke`
          : undefined;
        const url =
          opts.url ??
          (await prompter.text({
            message: "Service invoke URL (your gateway's public URL + /v1/invoke)",
            placeholder: "https://your-host.example.com/v1/invoke",
            initialValue: defaultUrl,
          }));

        // 4. Skills selection
        const availableSkills = resolveAvailableSkills(workspaceDir, config);
        let selectedSkills: string[] = [];

        if (availableSkills.length > 0) {
          if (opts.allSkills) {
            selectedSkills = availableSkills.map((s: { name: string }) => s.name);
          } else {
            selectedSkills = await prompter.multiselect({
              message: `Select skills to expose (${availableSkills.length} available)`,
              options: availableSkills.map((s: { name: string; description: string }) => ({
                value: s.name,
                label: s.name,
                hint: s.description,
              })),
              searchable: true,
            });
          }
        } else {
          await prompter.note(
            "No skills found in workspace. SERVICE.md will be created without skill references.",
          );
        }

        // 5. Trust + confirm
        const trust = opts.trust as "external" | "internal";
        const confirm = opts.confirm as "auto" | "always" | "never";

        // 6. Optional pricing
        const hasPricing = await prompter.confirm({
          message: "Add pricing information?",
          initialValue: false,
        });
        let pricingNote: string | undefined;
        if (hasPricing) {
          pricingNote = await prompter.text({
            message: "Pricing note (e.g. '$0.01 per request')",
            placeholder: "$0.01 per request",
          });
        }

        // Generate and write
        const result = writeServiceMd({
          workspaceDir,
          serviceParams: {
            name,
            description,
            url: url || undefined,
            trust,
            confirm,
            pricingNote,
            selectedSkills,
          },
          config,
        });

        const skillNote =
          result.copiedSkills.length > 0
            ? `\n  ${theme.muted("Skills copied:")} ${result.copiedSkills.join(", ")}`
            : "";
        const removedNote =
          result.removedSkills.length > 0
            ? `\n  ${theme.muted("Removed ineligible:")} ${result.removedSkills.join(", ")}`
            : "";
        const serveNote = `\n  ${theme.muted("Served at:")} /.well-known/service.md (when gateway is running)`;

        await prompter.outro(
          `${theme.accent("✓")} SERVICE.md created at ${result.filePath}${skillNote}${removedNote}${serveNote}`,
        );
      } catch (err) {
        if (err instanceof Error && err.name === "WizardCancelledError") {
          return;
        }
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });

  // Default action (no subcommand) — show list
  services.action(async () => {
    try {
      const config = loadConfig();
      const workspaceDir = resolveAgentWorkspaceDir(config, resolveDefaultAgentId(config));
      const entries = loadServiceEntries(workspaceDir, { config });
      defaultRuntime.log(formatServiceList(entries, {}));
    } catch (err) {
      defaultRuntime.error(String(err));
      defaultRuntime.exit(1);
    }
  });
}
