import { afterEach, describe, expect, it, vi } from "vitest";
import { recordEvents } from "../testing/events.ts";
import { OllamaCloudDriver, ollamaNativeOrigin, parseOllamaCatalog } from "./ollama-cloud.ts";

const create = (environment: Record<string, string>, config: Record<string, unknown> = {}) =>
  OllamaCloudDriver.create({
    instanceId: "ollama-test",
    displayName: "Ollama Cloud",
    enabled: true,
    config: OllamaCloudDriver.decodeConfig(config),
    environment,
  });

describe("OllamaCloudDriver", () => {
  const savedKey = process.env.OLLAMA_API_KEY;

  afterEach(() => {
    if (savedKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = savedKey;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("registers as a cloud engine with ollama.com defaults", () => {
    expect(OllamaCloudDriver.driverKind).toBe("ollamaCloud");
    expect(OllamaCloudDriver.metadata.displayName).toBe("Ollama Cloud");
    expect(OllamaCloudDriver.metadata.access).toBeUndefined();
    const cfg = OllamaCloudDriver.defaultConfig();
    expect(cfg).toEqual({ url: "https://ollama.com/v1", apiKeyEnv: "OLLAMA_API_KEY" });
    expect(OllamaCloudDriver.decodeConfig({ url: "https://proxy.example.test/v1/", apiKeyEnv: "PROXY_KEY", tools: false }))
      .toEqual({ url: "https://proxy.example.test/v1", apiKeyEnv: "PROXY_KEY", tools: false });
    expect(() => OllamaCloudDriver.decodeConfig({ tools: "no" })).toThrow(/tools/);
    // The seeded catalog is the provider's own, so it belongs in the main picker pane.
    expect(OllamaCloudDriver.models.options.every((option) => !option.custom)).toBe(true);
  });

  it("derives the native API origin from the OpenAI-compatible base", () => {
    expect(ollamaNativeOrigin("https://ollama.com/v1")).toBe("https://ollama.com");
    expect(ollamaNativeOrigin("https://ollama.com/v1/")).toBe("https://ollama.com");
    expect(ollamaNativeOrigin("http://127.0.0.1:8080/proxy/v1")).toBe("http://127.0.0.1:8080/proxy");
  });

  it("reads either catalog shape and drops blanks and duplicates", () => {
    expect(parseOllamaCatalog({ models: [{ model: "gpt-oss:120b", name: "gpt-oss:120b" }, { name: "kimi-k2.6" }, { model: "" }, { model: "gpt-oss:120b" }] }))
      .toEqual(["gpt-oss:120b", "kimi-k2.6"]);
    expect(parseOllamaCatalog({ data: [{ id: "glm-5.2" }, { id: 7 }] })).toEqual(["glm-5.2"]);
    expect(parseOllamaCatalog(null)).toEqual([]);
  });

  it("is unavailable without a key and ignores a bare OLLAMA_API_KEY on the server", async () => {
    process.env.OLLAMA_API_KEY = "someone-elses-key";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const inst = await create({});
    const snapshot = await inst.snapshot();
    expect(snapshot).toMatchObject({ state: "unavailable" });
    expect(snapshot.state === "unavailable" && snapshot.reason).toMatch(/OMB_OLLAMA_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
    await inst.dispose();
  });

  it("lists the live hosted catalog from the native /api/tags with the key", async () => {
    const calls: Array<{ url: string; auth: string | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
      if (url === "https://ollama.com/api/tags") {
        return Response.json({ models: [{ model: "kimi-k2.6" }, { model: "gpt-oss:120b" }, { model: "brand-new:1t" }] });
      }
      return new Response("not found", { status: 404 });
    }));
    const inst = await create({ OLLAMA_API_KEY: "ollama-fixture-key" });
    await inst.refreshModels?.();

    expect(calls).toEqual([
      { url: "https://ollama.com/api/tags", auth: "Bearer ollama-fixture-key" },
      { url: "https://ollama.com/api/tags", auth: "Bearer ollama-fixture-key" },
    ]);
    expect(inst.models).toEqual({
      default: "gpt-oss:120b",
      options: [
        { id: "kimi-k2.6", label: "Kimi K2.6" },
        { id: "gpt-oss:120b", label: "gpt-oss 120B" },
        { id: "brand-new:1t", label: "brand-new:1t" },
      ],
    });
    expect(await inst.snapshot()).toMatchObject({ state: "available", authenticated: true, billing: "subscription" });
    await inst.dispose();
  });

  it("falls back to /v1/models when the native catalog is unavailable, and keeps the seed when both fail", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) return new Response("nope", { status: 502 });
      if (url.endsWith("/v1/models")) return Response.json({ data: [{ id: "glm-5.2" }] });
      return new Response("not found", { status: 404 });
    }));
    const viaModels = await create({ OLLAMA_API_KEY: "k" });
    await viaModels.refreshModels?.();
    expect(viaModels.models).toEqual({ default: "glm-5.2", options: [{ id: "glm-5.2", label: "GLM 5.2" }] });
    await viaModels.dispose();

    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const offline = await create({ OLLAMA_API_KEY: "k" });
    await offline.refreshModels?.();
    expect(offline.models).toEqual(OllamaCloudDriver.models);
    await offline.dispose();
  });

  it("streams a chat turn against /v1/chat/completions with the bearer key and usage", async () => {
    let chatRequest: { url: string; auth: string | undefined; body: Record<string, unknown> } | null = null;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/tags")) return Response.json({ models: [{ model: "gpt-oss:120b" }] });
      if (url.endsWith("/v1/chat/completions")) {
        chatRequest = {
          url,
          auth: (init?.headers as Record<string, string> | undefined)?.authorization,
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        };
        return new Response(
          'data: {"choices":[{"delta":{"reasoning":"weighing"}}]}\n' +
            'data: {"choices":[{"delta":{"content":"The sky is blue."}}]}\n' +
            'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":5}}\n' +
            "data: [DONE]\n",
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response("not found", { status: 404 });
    }));
    const inst = await create({ OLLAMA_API_KEY: "ollama-fixture-key" });
    const recorder = recordEvents(inst.adapter);

    await inst.adapter.sendTurn({ threadId: "thread", text: "Why is the sky blue?", model: "gpt-oss:120b" });
    const completed = await recorder.until((event) => event.type === "turn.completed");

    expect(chatRequest).toMatchObject({
      url: "https://ollama.com/v1/chat/completions",
      auth: "Bearer ollama-fixture-key",
      body: { model: "gpt-oss:120b", stream: true, stream_options: { include_usage: true } },
    });
    expect(completed).toMatchObject({ ok: true, usage: { input: 9, output: 5 } });
    expect(recorder.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "content.delta", streamKind: "reasoning_text", delta: "weighing" }),
      expect.objectContaining({ type: "item.completed", itemType: "assistant_text", text: "The sky is blue." }),
    ]));
    recorder.stop();
    await inst.dispose();
  });

  it("surfaces a rejected key as a failed turn without retrying forever", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith("/api/tags")) return Response.json({ models: [] });
      return Response.json({ error: { message: "Unauthorized", type: "api_error" } }, { status: 401 });
    }));
    const inst = await create({ OLLAMA_API_KEY: "revoked" });
    const recorder = recordEvents(inst.adapter);
    await inst.adapter.sendTurn({ threadId: "thread", text: "hello", model: "gpt-oss:120b" });
    const completed = await recorder.until((event) => event.type === "turn.completed");
    expect(completed).toMatchObject({ ok: false, stopReason: "error" });
    const failure = recorder.events.find((event) => event.type === "runtime.error");
    expect(failure).toMatchObject({ type: "runtime.error", message: expect.stringMatching(/Ollama Cloud.*401/) });
    recorder.stop();
    await inst.dispose();
  });
});
