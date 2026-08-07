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
    +-- Cursor
    +-- VS Code
    +-- Windsurf
    +-- Anything that speaks MCP
```

The long-term goal is not a ChatGPT-specific memory plugin. It is one user-owned sandbox that can be built over months or years and reused across different AI providers without rebuilding context from scratch.

---

# Living project ledger — 7 Aug 2026

This section is the handoff point for the next development chat. Read this before changing code. Keep it short and factual: build first, update the ledger after meaningful milestones.

## Current state

The core local-first memory loop works and the remote bridge path is working end to end.

The current production web app is hosted on Vercel while trusted workspace data remains in browser storage. The HP Windows PC runs Memory Bridge and Ollama. Cloudflare Tunnel exposes the bridge securely over HTTPS.

The phone has successfully:

- paired with `WIZZ HP Bridge`
- chatted through the public bridge to Ollama `gemma3:1b`
- sent confirmed Memory Space context to the remote-local model
- explicitly shared the active Memory App space to the bridge
- published **6 confirmed memories** into bridge RAM
- verified the public MCP endpoint through the in-app MCP self-test

The bridge reports:

`MCP verified · 7 tools · shared workspace readable · 2026-07-28`

That proves the authenticated public MCP path can discover tools and read the explicitly shared workspace.

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
        +-- MCP endpoint /mcp
        +-- external proposal queue
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

Authentication is bearer-token based. The private pairing token must never be committed or pasted into public documentation.

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

## External AI proposal loop

Implemented in the app:

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
Memory App -> Check proposals
      |
      v
Reject / Edit / Approve
      |
      v
Confirmed Memory Space only after user approval
```

The Shared Chat screen contains an **External AI inbox** with `Check proposals`.

The full external-client round trip has **not yet been proven with a genuinely separate third-party MCP client**. That is the next defining test.

## Next defining test — do this next

Connect a real independent MCP client to the public bridge and prove the complete loop.

Success criteria:

1. External client authenticates to the bridge.
2. It discovers the 7 MCP tools.
3. It reads the active shared Memory App workspace.
4. It can search/read the 6 confirmed memories.
5. It uses that context to answer a question.
6. It calls `propose_memory` with a harmless test proposal.
7. Phone Memory App pulls that proposal through **Check proposals**.
8. User approves it.
9. Re-share the updated workspace.
10. A different AI/client can later read the newly approved memory.

That is the proof of the intended product:

**Memory App -> Memory Bridge -> any compatible AI.**

## ChatGPT test status

ChatGPT Developer mode was enabled on the HP browser account, but the visible UI currently exposes Plugins rather than an obvious `Create custom MCP app` / `Add MCP server` control. Do not redesign the bridge around ChatGPT's current UI.

ChatGPT is one compatibility target, not the architecture.

If ChatGPT's custom MCP UI becomes available, use the public `/mcp` endpoint. Otherwise test first with another independent MCP-capable client.

## Context selection now implemented

The app no longer assumes the entire workspace should be dumped into every model request.

A focused local selector now:

- stays inside the active space
- uses confirmed memory only
- prioritises locked and critical memories
- scores memories against the current request/recent chat
- defaults to a maximum focused set rather than sending everything as the workspace grows

Shared Chat now shows a **Context budget** trace so the user can see how many memories were selected.

Current small workspace behaviour is expected to show all current memories, e.g. `6/6`.

### Banked idea — not current priority

Later, expand Context Budget into a proper inspector with:

- estimated token count
- context package size
- selected-memory explanations
- `why selected` information
- package preview
- live rebuild after memory changes

Do **not** let this distract from the external MCP round-trip test first.

## UI state

### Mobile

Mobile layout is currently the preferred layout and should be left alone unless a real mobile bug is found.

Stacked order remains approximately:

```text
Purpose / Stats
Search / filters
AI Workspace
Shared Memory
```

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

Latest desktop layout commits:

- `14bf5b35` — desktop 65/35 Shared Memory / AI Workspace layout
- `105494fc` — `phase2.css?v=6` cache bump

This desktop layout still needs a visual confirmation screenshot after Vercel deploys.

## Recent important commits

- `f498c59c` — external AI proposal inbox logic
- `9641674d` — external proposal inbox styling
- `df3aa087` — load external proposal phase
- `5edae3e8` — initial MCP self-test UI
- `38006f56` — focused context selector
- `54cbf0d9` — provider cache bump
- `a38ecf52` — context trace logic
- `5b1e4956` — context trace mobile styling
- `cf1eb035` — context trace wiring
- `ff773b5f` — fix context-trace mutation/render loop regression
- `36d45e61` — context trace cache bump
- `04d0d1ff` — load context-trace CSS
- `71d48539` — modern stateless MCP self-test
- `bad2452a` — MCP self-test cache bump
- `ba63e476` — generic MCP smoke-test client
- `14bf5b35` — desktop 65/35 workspace layout
- `105494fc` — desktop CSS cache bump

## Regression note

A context-trace patch temporarily caused the Shared Chat UI to disappear because a `MutationObserver` repeatedly triggered its own render changes. This was fixed in `ff773b5f` by stopping the render loop and only observing until the panel exists.

If Shared Chat ever disappears again, inspect startup JavaScript before assuming Vercel or the phone is still loading.

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
- Keep the bridge generic: ChatGPT, Claude, Gemini, Cursor, VS Code, Windsurf and future MCP clients should use the same contract.

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

1. Formal provider portability test with two different models using the exact same workspace.
2. Make HP Ollama + Memory Bridge persistent across reboot.
3. Contradiction detection and explicit supersede proposals.
4. Better history/timeline UI.
5. Storage hardening toward IndexedDB/versioned exports.
6. Desktop/native packaging later with Tauri + SQLite.
7. Semantic/vector retrieval only when deterministic/full-text retrieval demonstrates a real limitation.

## Guiding principle

The memory is not generated about the user behind the scenes.

It is created **with** the user in a space they can see, understand and control.

The AI is a worker. The provider is replaceable. The bridge is infrastructure.

**The shared Memory Space is the product.**
