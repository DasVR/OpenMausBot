// Ollama Cloud (ollama.com) driver. The wire protocol is OpenAI chat
// completions at https://ollama.com/v1; this file keeps only the cloud's
// credential, catalog, and billing differences. Local Ollama on
// 127.0.0.1:11434 is a different path (local-inject.ts) and needs no key.
import type { ModelCatalog, ProviderDriver } from "../contracts.ts";
import { createOpenAIChatRuntime } from "./openai-chat.ts";

const DRIVER_KIND = "ollamaCloud";
export const OLLAMA_CLOUD_URL = "https://ollama.com/v1";
/** The variable Ollama's own tooling reads for a cloud key; the workspace
 * key arrives under this name in the instance environment (config.ts). */
export const OLLAMA_CLOUD_KEY_ENV = "OLLAMA_API_KEY";
const CATALOG_TIMEOUT_MS = 8_000;
// Seeded from ollama.com/search?c=cloud; the live catalog replaces it once a
// key is present. No `custom` flag: these are the provider's own models, so
// the picker shows them in the main pane like any cloud engine.
const DEFAULT_MODELS: ModelCatalog = {
  default: "gpt-oss:120b",
  options: [
    { id: "gpt-oss:120b", label: "gpt-oss 120B" },
    { id: "gpt-oss:20b", label: "gpt-oss 20B" },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    { id: "kimi-k2.6", label: "Kimi K2.6" },
    { id: "glm-5.2", label: "GLM 5.2" },
    { id: "minimax-m3", label: "MiniMax M3" },
    { id: "qwen3.5:397b", label: "Qwen 3.5 397B" },
  ],
};

export interface OllamaCloudConfig {
  tools?: boolean;
  url: string;
  apiKeyEnv: string;
}

/** `https://ollama.com/v1` → `https://ollama.com`; the native API lives
 * beside the OpenAI-compatible one, not under it. */
export function ollamaNativeOrigin(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}

function decodeConfig(raw: unknown): OllamaCloudConfig {
  const config = (raw ?? {}) as Record<string, unknown>;
  if (config.tools !== undefined && typeof config.tools !== "boolean") throw new Error("tools must be a boolean");
  return {
    ...(config.tools !== undefined ? { tools: config.tools as boolean } : {}),
    url: (typeof config.url === "string" && config.url.trim() ? config.url.trim() : OLLAMA_CLOUD_URL).replace(/\/+$/, ""),
    apiKeyEnv: typeof config.apiKeyEnv === "string" && config.apiKeyEnv ? config.apiKeyEnv : OLLAMA_CLOUD_KEY_ENV,
  };
}

/** Model ids from either catalog shape: native `/api/tags` (`models[].model`)
 * or OpenAI-compatible `/v1/models` (`data[].id`). */
export function parseOllamaCatalog(json: unknown): string[] {
  const record = json && typeof json === "object" ? (json as { models?: unknown; data?: unknown }) : null;
  const rows = Array.isArray(record?.models) ? record.models : Array.isArray(record?.data) ? record.data : [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const item = row && typeof row === "object" ? (row as { model?: unknown; name?: unknown; id?: unknown }) : null;
    const id = [item?.model, item?.name, item?.id].find((value): value is string => typeof value === "string" && value.trim() !== "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export const OllamaCloudDriver: ProviderDriver<OllamaCloudConfig> = {
  driverKind: DRIVER_KIND,
  metadata: { displayName: "Ollama Cloud", supportsMultipleInstances: true },
  models: DEFAULT_MODELS,
  decodeConfig,
  defaultConfig: () => decodeConfig({}),

  async create(input) {
    const { config } = input;
    // Instance environment only, never process.env: a bare OLLAMA_API_KEY on
    // the server belongs to whoever runs `ollama` there, and must not quietly
    // put every bot in the workspace on that person's account.
    const apiKey = input.environment[config.apiKeyEnv]?.trim() || "";
    let catalog: ModelCatalog = DEFAULT_MODELS;

    const fetchCatalog = async (url: string): Promise<string[]> => {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      });
      if (!response.ok) return [];
      return parseOllamaCatalog(await response.json());
    };
    const fetchModels = async () => {
      // Only a keyed instance is worth a network round trip: the default
      // fleet ships this engine to everyone, most of whom never use it.
      if (!apiKey) return;
      try {
        const ids = (await fetchCatalog(`${ollamaNativeOrigin(config.url)}/api/tags`).catch(() => []));
        const live = ids.length ? ids : await fetchCatalog(`${config.url}/models`);
        if (!live.length) return;
        const options = live.map((id) => ({ id, label: DEFAULT_MODELS.options.find((option) => option.id === id)?.label ?? id }));
        catalog = { default: live.includes(DEFAULT_MODELS.default) ? DEFAULT_MODELS.default : live[0], options };
      } catch {
        // Catalog refresh is opportunistic; keep the seeded options.
      }
    };
    if (apiKey) void fetchModels();

    return createOpenAIChatRuntime({
      input,
      driverKind: DRIVER_KIND,
      apiKey,
      apiUrl: config.url,
      tools: config.tools,
      models: () => catalog,
      refreshModels: fetchModels,
      requestBody: (model, messages, stream) => ({
        model,
        messages,
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
      httpErrorLabel: "Ollama Cloud",
      missingKeyError: `no Ollama Cloud key — add it in Settings → Connections or set OMB_OLLAMA_API_KEY`,
      unavailableReason:
        `no Ollama Cloud API key — paste one from https://ollama.com/settings/keys in Settings → Connections → Model providers, or set OMB_OLLAMA_API_KEY on the server`,
      timeoutMs: 180_000,
      reasoning: true,
      // Pro/Max plans and the free tier meter usage against the account's
      // limits, not per token: any cost the ledger shows is notional.
      billing: "subscription",
      includeUsageInCompleted: true,
      nativeLog: {
        source: "ollama-cloud.chat.completions",
        outgoing: (_turn, messages, model) => ({ model, messageCount: messages.length }),
        incoming: ({ text, reasoning, usage }) => ({ textLength: text.length, reasoningLength: reasoning.length, usage }),
      },
    });
  },
};
