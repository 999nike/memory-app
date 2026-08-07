# Memory App

A private, visible, long-term workspace that a human and AI systems build together.

**Core rule:** the AI can change. The workspace does not.

Memory Space is the user-owned source of truth. ChatGPT, Claude, Gemini, local models, IDE agents and future AI systems are replaceable workers that receive controlled access to the same workspace.

```text
Memory App
    |
    v
Memory Bridge
    |
    +-- ChatGPT
    +-- Claude
    +-- Gemini
    +-- Grok
    +-- Cursor
    +-- VS Code
    +-- Windsurf
    +-- Anything that speaks MCP
```

The long-term goal is not a ChatGPT-specific memory plugin. It is one user-owned sandbox that can be built over months or years and reused across different AI providers without rebuilding context from scratch.

---

# Living project ledger — 7 Aug 2026

This section is the handoff point for the next development chat. Read this before changing code. Keep it short and factual: build first, update the ledger after meaningful milestones.

## MAJOR MILESTONE — independent Grok MCP loop proven end to end

On **7 Aug 2026**, Grok was connected as a genuine independent third-party MCP client to the public Memory Bridge and the complete human-controlled memory round trip was verified.

The verified path was:

```text
Phone Memory App
      |
      | explicit Share
      v
HP Memory Bridge
      |
      | OAuth 2.0 + PKCE
      | public MCP /mcp
      v
Grok
      |
      | read confirmed Memory Space
      | propose_memory
      v
Bridge proposal queue
      |
      v
Phone Memory App
      |
      | Pull / review
      | human Approve
      v
Confirmed Memory Space
      |
      | explicit Share again
      v
Grok reads the newly confirmed memory back
```

The test proved all of the following in one live external-client flow:

1. Grok discovered the public MCP resource.
2. OAuth metadata discovery completed.
3. Grok opened the bridge authorization page.
4. User pairing-token consent succeeded.
5. OAuth authorization-code + PKCE exchange completed.
6. The bridge issued Grok an access token.
7. Grok discovered and used the Memory Space MCP tools.
8. Grok read the explicitly shared `Memory App` space and its 6 confirmed memories.
9. Grok called `propose_memory` and received a real external proposal ID.
10. The phone pulled the external proposal from the HP bridge.
11. The proposal appeared visibly in the Memory App with `Reject / Edit / Approve` controls.
12. The user approved the proposal.
13. The workspace increased from 6 to **7 confirmed memories**.
14. The updated workspace was explicitly shared again.
15. Grok read back the newly confirmed memory, including its memory ID, source/provenance, type, importance and confirmed status.

Read-back proof included the confirmed memory:

`First full loop with Grok`

Grok reported it as `status: confirmed` after the user approval and re-share.

This is the first verified proof of the intended product contract:

**an independent external AI can read the same user-owned Memory Space, propose a change, remain unable to silently approve it, and later read the user-approved result back.**

## Current state

The core local-first memory loop works and the remote bridge path is working end to end with a real third-party MCP client.

The current production web app is hosted on Vercel while trusted workspace data remains in browser storage. The HP Windows PC runs Memory Bridge and Ollama. Cloudflare Tunnel exposes the bridge securely over HTTPS.

The phone has successfully:

- paired with `WIZZ HP Bridge`
- chatted through the public bridge to Ollama `gemma3:1b`
- sent confirmed Memory Space context to the remote-local model
- explicitly shared the active Memory App space to the bridge
- published confirmed memories into bridge RAM
- verified the public MCP endpoint through the in-app MCP self-test
- pulled real external Grok proposals from the bridge
- reviewed and approved an external proposal locally
- reached **7 confirmed memories** after the first full Grok approval loop

The bridge self-test reports:

`MCP verified · 7 tools · shared workspace readable · 2026-07-28`

The live Grok OAuth flow additionally produced:

```text
[oauth] protected-resource metadata /.well-known/oauth-protected-resource/mcp
[oauth] authorization-server metadata
[oauth] authorize page client=memory-space-grok redirectHost=grok.com
[oauth] consent approved client=memory-space-grok redirectHost=grok.com
[oauth] token request grant=authorization_code client=memory-space-grok redirect=present verifier=present
[oauth] token issued client=memory-space-grok expiresIn=28800
```

That proves the authenticated public MCP path can be discovered and authorised by an external provider, then used to read and propose against the explicitly shared workspace.

## Architecture now proven

```text
Phone / Browser Memory App
        |
        | explicit Share
        v
Cloudflare HTTPS route
        |
        v
HP Memory Bridge :8787
        |
        +-- ephemeral shared workspace in RAM only
        +-- OAuth 2.0 / PKCE authorization
        +-- MCP endpoint /mcp
        +-- external proposal queue
        |
        +------> external MCP clients (Grok proven)
        |
        v
Ollama :11434 / gemma3:1b
```

Important distinction:

- Browser storage is the durable workspace.
- The bridge does **not** persist the shared workspace to disk.
- Share is explicit.
- Only current confirmed memories are published.
- External AI changes are proposals only; approval remains human-controlled.

## MCP interface currently implemented

Public route:

`https://bridge.w-i-z-z-lab-studios.com/mcp`

The public bridge now supports OAuth 2.0 authorization-code flow with PKCE for external MCP clients. The private bridge pairing token is used at the consent boundary and must never be committed or pasted into public documentation.

Current MCP tools:

1. `list_spaces`
2. `search_memory`
3. `get_current_space_context`
4. `read_memory`
5. `get_current_decisions`
6. `inspect_provenance`
7. `propose_memory`

`propose_memory` queues a proposal for the user. It does not create trusted memory automatically.

A generic smoke-test client also exists at:

`bridge/mcp-smoke.mjs`

The browser MCP self-test was updated to use the stateless MCP discovery path and currently passes against the live HP bridge.

## External AI proposal loop — VERIFIED

Implemented and now proven with Grok:

```text
External MCP AI
      |
      v
propose_memory
      |
      v
HP bridge proposal queue
      |
      v
Memory App -> Pull / Check proposals
      |
      v
Reject / Edit / Approve
      |
      v
Confirmed Memory Space only after user approval
      |
      | explicit Share
      v
External AI can read the approved memory back
```

The Shared Chat screen contains an **External AI inbox** with `Check proposals`.

The first live Grok test produced proposal ID:

`external_b34d408b-77b0-42e4-918e-81ca95b14c9c`

The proposal was pulled to the phone, displayed in the visible proposal UI, approved by the user, and became confirmed memory.

The accepted memory was later read back by Grok as:

- title: `First full loop with Grok`
- type: `note`
- importance: `normal`
- status: `confirmed`
- source: `AI proposal approved by user · Chat: External MCP client proposal`

This completes the original defining external-MCP test.

## Next defining test

The next meaningful portability test is **two different external AI providers using the exact same workspace**.

Success criteria:

1. Keep the same Memory Space and bridge contract.
2. Connect a second independent MCP-capable AI/provider.
3. Let it read the same confirmed workspace without rebuilding context manually.
4. Confirm it can see the Grok-approved memory.
5. Have it submit a harmless proposal through the same human-review boundary.
6. Verify no provider-specific fork of the memory database is required.

That would prove provider portability, not merely single-provider MCP compatibility.

## ChatGPT test status

ChatGPT Developer mode was enabled on the HP browser account, but the visible UI currently exposes Plugins rather than an obvious `Create custom MCP app` / `Add MCP server` control. Do not redesign the bridge around ChatGPT's current UI.

ChatGPT is one compatibility target, not the architecture.

If ChatGPT's custom MCP UI becomes available, use the public `/mcp` endpoint. Otherwise continue testing the generic MCP contract with independent clients.

## Context selection now implemented

The app no longer assumes the entire workspace should be dumped into every model request.

A focused local selector now:

- stays inside the active space
- uses confirmed memory only
- prioritises locked and critical memories
- scores memories against the current request/recent chat
- defaults to a maximum focused set rather than sending everything as the workspace grows

Shared Chat now shows a **Context budget** trace so the user can see how many memories were selected.

Current small workspace behaviour may still select the full current set when all items are relevant.

### Banked idea — not current priority

Later, expand Context Budget into a proper inspector with:

- estimated token count
- context package size
- selected-memory explanations
- `why selected` information
- package preview
- live rebuild after memory changes

Do **not** let this distract from provider-portability testing and runtime hardening.

## UI state

### Mobile

Mobile is the primary tested layout.

Current stacked order remains approximately:

```text
Purpose / Stats
Search / filters
AI Workspace
  Bridge selector
  External AI inbox
  Context budget
  Memory proposals when pending
  Chat
Shared Memory
```

On 7 Aug 2026 the mobile AI panel was patched so pending external proposals are no longer hidden under the chat. The fixed mobile height cap was removed, proposal cards now take natural space, chat remains scrollable, and confirmed memory cards were compacted to reduce vertical waste.

The first real Grok proposals were visibly reviewed on the phone with `Reject / Edit / Approve` controls.

### Desktop

Desktop was patched on 7 Aug 2026 to give Memory and AI proper side-by-side workspace weight rather than squeezing AI into a narrow rail.

For desktop, the intended layout is:

```text
Purpose / Stats
Search

+-----------------------------+-------------------------+
| Shared Memory               | AI Workspace            |
|                             |                         |
| Memory cards                | Bridge selector         |
| Memory cards                | External AI inbox       |
| Memory cards                | Context budget          |
|                             | Chat                    |
|                             | Message box / Send      |
+-----------------------------+-------------------------+
```

Desktop target is roughly **65% Memory / 35% AI**, with the AI pane sticky while scrolling.

Mobile/tablet stacking remains controlled by the existing lower-width media queries.

## Recent important commits

- `f498c59c` — external AI proposal inbox logic
- `9641674d` — external proposal inbox styling
- `df3aa087` — load external proposal phase
- `5edae3e8` — initial MCP self-test UI
- `38006f56` — focused context selector
- `a38ecf52` — context trace logic
- `ff773b5f` — fix context-trace mutation/render loop regression
- `71d48539` — modern stateless MCP self-test
- `ba63e476` — generic MCP smoke-test client
- `14bf5b35` — desktop 65/35 workspace layout
- `8bf7e64` — bridge/MCP/OAuth groundwork pulled to HP during external-client setup
- `302f09c` — MCP protected-resource metadata compatibility + OAuth diagnostics
- `61591e80` — fix Grok OAuth callback redirect
- `132c53dd` — fix mobile proposal visibility and compact memory cards
- `79cecf1e` — final mobile CSS cache bump while preserving existing app wiring

## Regression / debugging notes

A context-trace patch temporarily caused the Shared Chat UI to disappear because a `MutationObserver` repeatedly triggered its own render changes. This was fixed in `ff773b5f` by stopping the render loop and only observing until the panel exists.

During Grok OAuth testing, repeated `consent approved` logs with no `/token` request exposed a callback-navigation compatibility bug. The OAuth consent page redirect/CSP path was corrected and Grok then completed token exchange successfully.

If Shared Chat ever disappears again, inspect startup JavaScript before assuming Vercel or the phone is still loading.

If OAuth reaches `consent approved` but never logs `token request`, inspect the browser callback/redirect boundary rather than the pairing token first.

## HP / Cloudflare runtime

Current first bridge machine is the HP Windows server.

- Repo: `E:\WIZZ-Server\workspaces\memory-app`
- Ollama: `E:\WIZZ-Server\ollama`
- Ollama model storage: `E:\WIZZ-Server\ollama\models`
- Ollama runtime: `127.0.0.1:11434`
- Memory Bridge: `127.0.0.1:8787`
- Public bridge: `bridge.w-i-z-z-lab-studios.com -> 127.0.0.1:8787`
- Media route remains separate: `media.w-i-z-z-lab-studios.com -> 127.0.0.1:8081`
- Model currently used: `gemma3:1b`

The bridge server is currently started manually with Node from PowerShell. Ollama/bridge persistence across reboot is still future work.

After bridge server code changes on GitHub, remember the HP clone needs `git pull` and the Node bridge process must be restarted. Pure frontend/Vercel patches do not require an HP restart.

OAuth grants and the shared bridge workspace are currently held in RAM. Restarting the bridge clears that runtime state and requires the workspace to be explicitly shared again.

## Security housekeeping

The bridge pairing token appeared during live setup/screenshots and should be rotated after the milestone test. Do not place the replacement token in this README, Git history, screenshots, or chat logs.

## Product rules — do not break these

- Memory Space owns the long-term truth.
- Models are replaceable workers.
- The user chooses what becomes trusted memory.
- External AIs may read/search explicitly shared memory and propose changes.
- External AIs must not silently approve/write/delete trusted memory.
- Only current confirmed memories enter active trusted context.
- Superseded/archived history remains history, not current context.
- Pairing/connection tests should not leak workspace data.
- Shared bridge workspace remains ephemeral RAM-only unless the product deliberately changes later.
- No silent cloud fallback.
- No provider-specific fork of the user's memory database.
- Keep the bridge generic: ChatGPT, Claude, Gemini, Grok, Cursor, VS Code, Windsurf and future MCP clients should use the same contract.

## Development working rule

Do not turn the ledger into the project.

1. Read this section when context is uncertain.
2. Read the actual files before patching.
3. Make the smallest safe patch.
4. Test meaningful boundaries.
5. Update this ledger only after real milestones.
6. Keep building the app.

---

# Product model

Memory App is not ordinary hidden chatbot memory and it is not a dump of every conversation. It gives the user a dedicated virtual space where important facts, decisions, goals, project state, sources and history can be deliberately preserved, inspected, corrected and removed.

The experience should feel like every authorised AI is entering the **same room**, rather than forcing the user to rebuild that room for each model provider.

## Memory layers

### Confirmed memory

User-approved information that belongs to a space and may be supplied as trusted current context.

### Locked memory

Critical confirmed information that must not be silently changed or replaced.

### Proposed memory

Information an AI believes may be worth keeping. It remains pending until the user approves, edits or rejects it.

### Working memory

Recent/temporary context useful for the current task but not automatically permanent.

### Raw archive

Conversation/source material that remains evidence and searchable history rather than being inserted into every model request.

## Context assembly principle

Do not send the whole database to a model by default.

A context package should be assembled from the active space, locked memory, relevant confirmed memory, current goals/decisions, recent conversation context and the user's current request.

The user should be able to inspect what was selected and why.

## Privacy principles

- local storage by default
- explicit sharing only
- clear provenance
- clear deletion/export controls
- no private memory in analytics
- no unrestricted external database access
- human approval for trusted long-term changes

## Roadmap after the external MCP proof

1. Formal provider portability test with two different external models using the exact same workspace.
2. Make HP Ollama + Memory Bridge persistent across reboot.
3. Rotate exposed development pairing credentials and tighten operational secret handling.
4. Contradiction detection and explicit supersede proposals.
5. Better history/timeline UI.
6. Storage hardening toward IndexedDB/versioned exports.
7. Desktop/native packaging later with Tauri + SQLite.
8. Semantic/vector retrieval only when deterministic/full-text retrieval demonstrates a real limitation.

## Guiding principle

The memory is not generated about the user behind the scenes.

It is created **with** the user in a space they can see, understand and control.

The AI is a worker. The provider is replaceable. The bridge is infrastructure.

**The shared Memory Space is the product.**
