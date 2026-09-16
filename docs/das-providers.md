# Providers for a self-hosted deploy: Ollama Cloud and Claude

A short operator note for a headless or Docker deploy that wants two things
working without a desktop: **Ollama Cloud (Pro/Max or free tier)** as a
first-class engine, and **Claude** on a clearly chosen account. Everything
here is optional; a server with none of it still boots, and Composio and Box
are never required.

Every value below can be set in **Settings → Connections** instead of the
environment. The page is write-only: it shows configured-or-not plus a
**Test** button, never the key. Env wins over `config.json` at boot, and a
save from Settings keeps the running process in step.

## Ollama Cloud

| Setting | Env | Default |
| --- | --- | --- |
| API key from [ollama.com/settings/keys](https://ollama.com/settings/keys) | `OMB_OLLAMA_API_KEY` | none — the engine shows *Needs setup* until one is present |
| Base URL | `OMB_OLLAMA_API_URL` | `https://ollama.com/v1` (only change for a proxy) |

```sh
OMB_OLLAMA_API_KEY=... npx openmausbot serve
```

What the key gives you:

- The **Ollama Cloud** engine in every model picker, with the hosted catalog
  listed live from ollama.com (`/api/tags`, falling back to `/v1/models`).
- Chat through the OpenAI-compatible `/v1/chat/completions` on ollama.com,
  streaming, with reasoning text and MCP tool calls on models that support
  them. Turn tools off per instance with `PATCH /api/instances/ollamaCloud
  {"tools": false}` if a model rejects schemas.
- **Test** in Settings makes one authenticated, read-only request to
  `https://ollama.com/api/ps`. The model catalog on ollama.com is public, so
  a catalog request alone would say nothing about the key.

What it does not do:

- It never reads a bare `OLLAMA_API_KEY` from the server's environment. That
  variable belongs to whoever runs the `ollama` CLI on the box; the workspace
  key is always `OMB_OLLAMA_API_KEY` or the Connections page.
- It is not local Ollama. A local `ollama serve` on `127.0.0.1:11434` needs
  no key and is discovered separately as **Local models**.
- Billing is your ollama.com plan's usage limits, not per token; any cost
  the usage ledger shows for this engine is notional.

Several accounts or a proxy: add more `ollamaCloud` instances in
`config.json`, each with its own `environment` and `apiKeyEnv`, exactly as
[custom-engines.md](custom-engines.md) shows for `openai-compat`.

## Claude: subscription or API key

Two paths, one active at a time. Settings → Connections states which.

**Claude Code sign-in (Pro/Max subscription).** Install the `claude` CLI on
the server (`npm install -g @anthropic-ai/claude-code`, or **Install** in
Settings → Engines when npm is on the PATH) and sign in from
**Settings → Engines → Claude → Sign in to Claude**. The code you paste back
goes to the unmodified CLI once; the login lives where Claude Code keeps it
for the account that runs your bots. Usage counts against that person's
subscription. Add further accounts under **Add Claude account** and pick one
per bot. This is the only way a Claude subscription is ever used; there is no
"Claude Pro API".

**Anthropic API key (per token).** Save a key from the Anthropic console in
Settings → Connections, or set `OMB_ANTHROPIC_API_KEY` (and
`OMB_ANTHROPIC_API_URL` for a proxy). While a key is saved every Claude bot
uses it, nobody signs in, Engines shows *workspace API key*, and Claude Code
reports the real cost per turn to the usage ledger. Remove the key to return
to sign-ins. A plain `ANTHROPIC_API_KEY` in the server's environment is
deliberately ignored so a stray variable can never move every bot onto
pay-as-you-go billing.

## Everything at a glance

```sh
# Ollama Cloud
OMB_OLLAMA_API_KEY=...            # from https://ollama.com/settings/keys
# OMB_OLLAMA_API_URL=https://ollama.com/v1

# Claude via workspace API key (omit both to use Claude Code sign-ins)
# OMB_ANTHROPIC_API_KEY=sk-ant-...
# OMB_ANTHROPIC_API_URL=https://api.anthropic.com

# Other OpenAI-compatible endpoints (OpenRouter by default)
# OPENAI_COMPAT_API_KEY=...
# OPENAI_COMPAT_URL=https://openrouter.ai/api/v1

# Optional integrations — leave unset unless you use them
# COMPOSIO_API_KEY=...
# BOX_TOKEN=...
```

The rest of the self-hosting story — sign-in allow-lists, HTTPS, phones,
fleets — is in [self-hosting.md](self-hosting.md).
