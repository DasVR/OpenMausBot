import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreProvider } from "@/state/store";
import * as store from "@/state/store";
import { ApiKeyRow, ClaudeBillingNote, OpenAiCompatUrl, ProviderUrl } from "./ApiKeys";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const render = (element: React.ReactElement) => {
  vi.stubGlobal("window", {});
  return renderToStaticMarkup(createElement(StoreProvider, null, element));
};

describe("provider key rows", () => {
  it("describes a stored key as configured without claiming an authenticated connection", () => {
    vi.spyOn(store, "useStore").mockReturnValue({
      state: { ...store.initialState, config: {
        ...store.initialState.config, openaiCompat: { configured: true, url: "https://openrouter.ai/api/v1" },
      } as store.ConfigStatus },
      dispatch: vi.fn(),
      flushBotPatches: vi.fn(),
      refreshInstances: vi.fn(),
      refreshModels: vi.fn(),
    });
    const html = render(createElement(ApiKeyRow, { section: "openaiCompat", testProvider: "openaiCompat" }));
    expect(html).toContain("Configured");
    expect(html).not.toContain("Connected");
    expect(html).not.toContain("authenticated");
    expect(html).toContain(">Test<");
    expect(html).toContain('value=""');
  });

  it("renders the provider rows write-only, with the provider's own console linked", () => {
    const anthropic = render(createElement(ApiKeyRow, { section: "anthropic", testProvider: "anthropic" }));
    expect(anthropic).toContain("Anthropic API key");
    expect(anthropic).toContain('type="password"');
    expect(anthropic).toContain("sk-ant-…");
    // The console link and the description live in the help popover.
    expect(anthropic).toContain('aria-label="About Anthropic API key"');
    expect(anthropic).not.toContain("Connected");
    // Nothing to test until a key is typed or saved.
    expect(anthropic).not.toContain(">Test<");

    const openai = render(createElement(ApiKeyRow, { section: "openaiCompat", testProvider: "openaiCompat" }));
    expect(openai).toContain("OpenAI-compatible API key");
    expect(openai).toContain("sk-or-v1-…");

    expect(render(createElement(ApiKeyRow, { section: "xai", testProvider: "xai" }))).toContain("xAI API key");
  });

  it("offers the base URL as a setting next to the key", () => {
    const html = render(createElement(OpenAiCompatUrl));
    expect(html).toContain("OpenAI-compatible base URL");
    expect(html).toContain('placeholder="https://openrouter.ai/api/v1"');
    expect(html).toContain("api.openai.com/v1");
  });

  it("renders Ollama Cloud as its own write-only row with ollama.com defaults", () => {
    const row = render(createElement(ApiKeyRow, { section: "ollamaCloud", testProvider: "ollamaCloud" }));
    expect(row).toContain("Ollama Cloud API key");
    expect(row).toContain('type="password"');
    expect(row).toContain('aria-label="About Ollama Cloud API key"');
    expect(row).not.toContain(">Test<");

    const url = render(createElement(ProviderUrl, { section: "ollamaCloud" }));
    expect(url).toContain("Ollama Cloud base URL");
    expect(url).toContain('placeholder="https://ollama.com/v1"');
  });

  it("tells the operator which Claude account is paying", () => {
    const subscription = render(createElement(ClaudeBillingNote, { apiKeySaved: false, onOpenEngines: () => {} }));
    expect(subscription).toContain("Claude Code sign-in");
    expect(subscription).toContain("Open Engines");
    const apiKey = render(createElement(ClaudeBillingNote, { apiKeySaved: true, onOpenEngines: () => {} }));
    expect(apiKey).toContain("workspace Anthropic API key");
    expect(apiKey).toContain("takes precedence");
  });
});
