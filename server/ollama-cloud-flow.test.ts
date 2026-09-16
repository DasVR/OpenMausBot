import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";
import { fixtureApi } from "../scripts/testing/preview-fixture.ts";
import { openSse } from "./testing/sse.ts";

// A loopback stand-in for ollama.com: a public catalog like the real one,
// an /api/ps that only a valid key opens, and OpenAI-shaped chat.
it("an Ollama Cloud key saved in Settings lists the hosted catalog, passes Test, and carries a bot's turn", async () => {
  const received: string[] = [];
  const provider = createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    if (req.url === "/api/tags") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ models: [{ model: "gpt-oss:120b" }, { model: "fixture-hosted:1b" }] }));
      return;
    }
    if (req.url === "/api/ps") {
      if (auth !== "Bearer ollama-fixture-key") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    if (req.url !== "/v1/chat/completions") { res.writeHead(404).end(); return; }
    received.push(auth);
    req.resume();
    if (auth !== "Bearer ollama-fixture-key") {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Unauthorized", type: "api_error" } }));
      return;
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "hosted fixture reply" } }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", resolve));
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("fixture provider has no port");
  const base = `http://127.0.0.1:${address.port}`;
  const fixture = await launchVerificationServer();
  const api = fixtureApi(fixture.info.url);
  const sse = await openSse(`${fixture.info.url}/api/events`);
  try {
    const before = await api("GET", "/api/instances");
    const unkeyed = before.instances.find((instance: { instanceId: string }) => instance.instanceId === "ollamaCloud");
    expect(unkeyed).toMatchObject({ driverKind: "ollamaCloud", displayName: "Ollama Cloud", snapshot: { state: "unavailable" } });
    expect(unkeyed.snapshot.reason).toMatch(/OMB_OLLAMA_API_KEY/);

    expect(await api("POST", "/api/keys/test", { provider: "ollamaCloud", key: "wrong-key", url: `${base}/v1` }))
      .toEqual({ ok: false, reason: "rejected", status: 401 });
    const status = await api("PUT", "/api/config", { ollamaCloud: { url: `${base}/v1`, key: "ollama-fixture-key" } });
    expect(status.ollamaCloud).toEqual({ configured: true, url: `${base}/v1` });
    expect(JSON.stringify(status)).not.toContain("ollama-fixture-key");
    expect(await api("POST", "/api/keys/test", { provider: "ollamaCloud" }))
      .toEqual({ ok: true, check: "authentication", models: [] });

    const { instances } = await api("GET", "/api/instances");
    const keyed = instances.find((instance: { instanceId: string }) => instance.instanceId === "ollamaCloud");
    expect(keyed.snapshot).toMatchObject({ state: "available", authenticated: true, billing: "subscription" });
    expect(keyed.access).toBe("subscription");
    await api("POST", "/api/instances/ollamaCloud/refresh-models", {});
    const refreshed = (await api("GET", "/api/instances")).instances
      .find((instance: { instanceId: string }) => instance.instanceId === "ollamaCloud");
    expect(refreshed.models.options.map((option: { id: string }) => option.id)).toEqual(["gpt-oss:120b", "fixture-hosted:1b"]);

    const { bot } = await api("POST", "/api/bots", {
      name: "Ollama fixture", modelSelection: { instanceId: "ollamaCloud", model: "fixture-hosted:1b" },
    });
    await api("POST", `/api/bots/${bot.id}/messages`, { text: "Reply briefly for the Ollama Cloud fixture." });
    await sse.until((frame) => frame.kind === "message" && frame.threadId === bot.threadId
      && frame.message?.role === "bot" && frame.message?.text === "hosted fixture reply");
    expect(received).toEqual(["Bearer ollama-fixture-key"]);

    const disk = JSON.parse(readFileSync(join(fixture.info.dataDir, "config.json"), "utf8"));
    expect(disk.ollamaCloud).toEqual({ url: `${base}/v1`, key: "ollama-fixture-key" });
    const publicState = JSON.stringify([await api("GET", "/api/bots"), await api("GET", "/api/config"), await api("GET", "/api/instances"), sse.frames]);
    expect(publicState).not.toContain("ollama-fixture-key");
    expect(readFileSync(fixture.info.logPath, "utf8")).not.toContain("ollama-fixture-key");
  } finally {
    sse.close();
    await fixture.close();
    await new Promise<void>((resolve) => provider.close(() => resolve()));
  }
});
