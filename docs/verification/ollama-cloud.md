# Ollama Cloud engine

## Sub-features

- The `ollamaCloud` default-fleet instance shows *Needs setup* without a key
  and names `OMB_OLLAMA_API_KEY` in its reason.
- Saving a key in Settings → Connections makes it available, lists the hosted
  catalog live, and never echoes the key.
- **Test** authenticates against the native running-models endpoint
  (`https://ollama.com/api/ps`), not the public catalog.
- A bot on the instance completes a chat turn with the bearer key.

## Driving it

Run the permanent acceptance test. It launches its own isolated server with
`launchVerificationServer` and a loopback stand-in for ollama.com; no real
key or account is contacted:

```sh
pnpm exec vitest run server/ollama-cloud-flow.test.ts
```

Driver and key-check contract tests:

```sh
pnpm exec vitest run server/drivers/ollama-cloud.test.ts server/provider-key-check.test.ts
```

For a manual pass against a fixture, launch one, then point the engine at a
loopback provider so nothing reaches a live account:

```sh
node --experimental-strip-types scripts/control-omb.ts launch
# second terminal, with the printed URL
curl -X PUT http://127.0.0.1:PORT/api/config -H 'content-type: application/json' \
  -d '{"ollamaCloud":{"url":"http://127.0.0.1:FAKEPORT/v1","key":"fixture"}}'
pnpm control:omb models --url http://127.0.0.1:PORT
```

## Gotchas

- `https://ollama.com/v1/models` and `https://ollama.com/api/tags` answer
  without a key, so a catalog request never proves a key. Only
  `https://ollama.com/api/ps` (401 on a bad key) does.
- The driver reads its key from the instance environment only. A bare
  `OLLAMA_API_KEY` on the server is ignored by design.
- A live turn against ollama.com spends the account's plan usage; this map
  proves the wire path with a fixture, not any particular hosted model.
