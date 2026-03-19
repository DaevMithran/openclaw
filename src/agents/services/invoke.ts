import { createSubsystemLogger } from "../../logging/subsystem.js";
import { fetchWithWebToolsNetworkGuard } from "../tools/web-guarded-fetch.js";
import type {
  ServiceEntry,
  ServiceInvokeRequest,
  ServiceInvokeResponse,
  ServicesConfig,
} from "./types.js";

const servicesLogger = createSubsystemLogger("services");

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 262_144; // 256KB
const SERVICE_USER_AGENT = "OpenClaw/1.0";

type InvokeServiceOptions = {
  /** Which skill within the service to invoke. */
  skill?: string;
  /** The task/prompt to send. */
  task: string;
  /** Agent ID for context. */
  agentId?: string;
  /** Service config defaults. */
  servicesConfig?: ServicesConfig;
};

function resolveAuthHeader(entry: ServiceEntry): Record<string, string> {
  const auth = entry.manifest.auth;
  if (!auth || auth.type === "none") {
    return {};
  }

  const credential = auth.env ? process.env[auth.env] : undefined;
  if (!credential) {
    return {};
  }

  if (auth.header) {
    return { [auth.header]: credential };
  }

  // Default: Authorization: Bearer <token>
  if (auth.type === "bearer" || auth.type === "api_key") {
    return { Authorization: `Bearer ${credential}` };
  }

  return {};
}

/**
 * Invoke a remote service endpoint with the OpenClaw service protocol.
 */
export async function invokeService(
  entry: ServiceEntry,
  options: InvokeServiceOptions,
): Promise<ServiceInvokeResponse> {
  const timeoutMs = options.servicesConfig?.defaults?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    options.servicesConfig?.defaults?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  const requestBody: ServiceInvokeRequest = {
    version: "1",
    task: options.task,
    context: {
      agent_id: options.agentId,
      service_id: entry.manifest.name,
    },
  };

  if (options.skill) {
    requestBody.skill = options.skill;
  }

  const authHeaders = resolveAuthHeader(entry);

  const bodyJson = JSON.stringify(requestBody);

  servicesLogger.debug("Invoking service.", {
    service: entry.manifest.name,
    skill: options.skill,
    url: entry.manifest.url,
  });

  const start = Date.now();

  try {
    const { response, release } = await fetchWithWebToolsNetworkGuard({
      url: entry.manifest.url,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": SERVICE_USER_AGENT,
          ...authHeaders,
        },
        body: bodyJson,
      },
      timeoutMs,
    });

    try {
      if (!response.ok) {
        const errorText = await readResponseTextCapped(response, maxResponseBytes);
        servicesLogger.warn("Service returned non-OK status.", {
          service: entry.manifest.name,
          status: response.status,
        });

        return {
          version: "1",
          status: "error",
          error: {
            code: `http_${response.status}`,
            message: `Service returned HTTP ${response.status}: ${errorText.slice(0, 500)}`,
          },
        };
      }

      const responseText = await readResponseTextCapped(response, maxResponseBytes);
      const parsed = parseServiceResponse(responseText);

      const durationMs = Date.now() - start;
      servicesLogger.debug("Service responded.", {
        service: entry.manifest.name,
        status: parsed.status,
        durationMs,
      });

      return parsed;
    } finally {
      await release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    servicesLogger.warn("Service invocation failed.", {
      service: entry.manifest.name,
      error: message,
    });

    return {
      version: "1",
      status: "error",
      error: {
        code: "network_error",
        message: `Failed to reach service: ${message}`,
      },
    };
  }
}

async function readResponseTextCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        chunks.push(value.slice(0, maxBytes - (totalBytes - value.byteLength)));
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode();
}

function parseServiceResponse(text: string): ServiceInvokeResponse {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") {
      return {
        version: "1",
        status: "error",
        error: { code: "invalid_response", message: "Service returned non-object response." },
      };
    }

    return {
      version: "1",
      status: parsed.status === "ok" ? "ok" : "error",
      result: typeof parsed.result === "string" ? parsed.result : undefined,
      usage: parsed.usage && typeof parsed.usage === "object" ? parsed.usage : undefined,
      metadata:
        parsed.metadata && typeof parsed.metadata === "object" ? parsed.metadata : undefined,
      error: parsed.error && typeof parsed.error === "object" ? parsed.error : undefined,
    };
  } catch {
    return {
      version: "1",
      status: "error",
      error: { code: "invalid_json", message: "Service returned invalid JSON." },
    };
  }
}
