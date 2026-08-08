# Memory Bridge v1

Memory Bridge lets the hosted/local-first Memory Space UI talk to an AI model running on another trusted machine without moving workspace storage to that machine.

The browser remains the owner of workspace data. Before any model call, the existing context firewall builds the current approved context package. Only that request package is sent to the bridge.

## Trust model

- Workspace storage remains in the browser.
- The bridge does not persist Memory Space data.
- Bridge access requires a pairing token.
- OAuth client registrations, access tokens, and refresh tokens are persisted locally only so authorised AI apps can recover after a bridge restart.
- OAuth state is encrypted at rest with AES-256-GCM using a key derived from the bridge pairing token with scrypt.
- The encrypted OAuth state defaults to `bridge/.state/oauth-state.enc.json` and `bridge/.state/` is Git-ignored.
- Authorization codes, the currently published Space snapshot, and pending external proposals remain RAM-only.
- The bridge accepts requests only from configured web origins.
- Connection tests use `GET /v1/info` and send no memory context.
- Normal model requests receive only the context already approved by the Memory Space context firewall.
- Superseded, archived, and deleted memories are excluded before the bridge is called.
- Permanent memory changes still require approval inside Memory Space.

Changing the bridge pairing token intentionally makes the previous encrypted OAuth state unreadable, which effectively requires external AI apps to authorize again.

## Protocol

Protocol name: `memory-space-bridge`

Version: `1`

### GET /v1/info

Authenticated capability/pairing check. No workspace memory is sent.

Response example:

```json
{
  "protocol": "memory-space-bridge",
  "version": 1,
  "name": "Memory Bridge",
  "model": "gemma3:4b",
  "transport": "openai-compatible-local-target",
  "storesWorkspace": false
}
```

### POST /v1/chat

Request:

```json
{
  "protocol": "memory-space-bridge",
  "version": 1,
  "requestId": "uuid",
  "message": "What should I work on next?",
  "context": "current confirmed Memory Space context",
  "history": [],
  "memoryPolicy": {
    "currentOnly": true,
    "approvalRequired": true
  }
}
```

The bridge forwards the request to its configured local model runtime and returns a normal reply.

## Run the companion

Requires Node.js 18+ and a local OpenAI-compatible model endpoint. Ollama and LM Studio both provide this style of endpoint.

Environment variables:

- `MEMORY_BRIDGE_TOKEN` — required pairing secret. This also protects the encrypted OAuth recovery state.
- `MEMORY_BRIDGE_MODEL` — required local model name, for example `gemma3:4b`.
- `MEMORY_BRIDGE_TARGET` — optional target chat-completions endpoint. Defaults to `http://127.0.0.1:11434/v1/chat/completions`.
- `MEMORY_BRIDGE_HOST` — optional bind address. Defaults to `127.0.0.1`.
- `MEMORY_BRIDGE_PORT` — optional port. Defaults to `8787`.
- `MEMORY_BRIDGE_NAME` — optional display name.
- `MEMORY_BRIDGE_ORIGINS` — comma-separated allowed browser origins. Defaults to the production Memory Space origin.
- `MEMORY_BRIDGE_OAUTH_STATE_FILE` — optional local path for the encrypted OAuth recovery file. Defaults to `bridge/.state/oauth-state.enc.json`.

Example on a machine running Ollama:

```bash
MEMORY_BRIDGE_TOKEN="replace-with-a-long-random-secret" \
MEMORY_BRIDGE_MODEL="gemma3:4b" \
node bridge/server.mjs
```

On Windows PowerShell:

```powershell
$env:MEMORY_BRIDGE_TOKEN="replace-with-a-long-random-secret"
$env:MEMORY_BRIDGE_MODEL="gemma3:4b"
node bridge/server.mjs
```

### First persistence rollout

A bridge process started before OAuth persistence was installed has no encrypted state file yet. The first restart onto the new code therefore cannot recover grants that existed only in the old process RAM.

After that first restart, authorize each desired AI app once. The new access/refresh state is written to the encrypted local state file automatically. Subsequent bridge restarts can restore still-valid grants without repeating authorization.

## HTTPS requirement

The production Memory Space page is served over HTTPS. Browsers will block an ordinary insecure LAN `http://192.168.x.x` bridge as mixed content.

For phone-to-PC use, expose the local bridge through one of these trusted HTTPS routes:

1. A local HTTPS reverse proxy with a certificate trusted by the phone.
2. A private VPN/tunnel that provides HTTPS.
3. A dedicated Cloudflare Tunnel hostname pointing to `http://127.0.0.1:8787`.

Using a tunnel does not move inference to the tunnel provider. The model still runs on the local machine, but the selected request/context does traverse that encrypted transport. Users who require no third-party transport should use trusted LAN HTTPS or a private VPN.

## Current target adapters

Bridge v1 forwards to an OpenAI-compatible local target. This already covers Ollama, LM Studio, llama.cpp servers, and many local runtimes.

Future adapters can implement the same bridge protocol for native Android inference, direct llama.cpp bindings, custom Wizz runtimes, or other engines without changing Memory Space itself.
