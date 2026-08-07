# Memory App

A private, visible, long-term workspace that a human and AI systems build together.

**Core rule:** the AI can change. The workspace does not.

Memory Space is the user-owned source of truth. Models are replaceable workers that receive controlled access to the same workspace.

```text
Memory App / Memory Space
        |
        v
Memory Bridge
        |
        +-- Grok       VERIFIED
        +-- Mistral    VERIFIED
        +-- Claude     next target
        +-- Cursor     next target
        +-- ChatGPT
        +-- Gemini
        +-- local models
        +-- VS Code / IDE agents
        +-- anything that speaks MCP
```

The goal is not a provider-specific memory plugin. It is one user-owned space that can be built over months or years and reused across different AI providers without rebuilding context from scratch.

The bigger architecture is deliberately broader than memory alone: Memory Space can become the trusted context and control layer underneath project workspaces, code sandboxes, files, tasks and multiple AI workers. That expansion is banked for later; the current product priority is to make the core Memory Space boringly easy, private and reliable.

---

# Living project ledger — 8 Aug 2026

This section is the handoff point for the next development chat. Read this before changing code. Keep it factual: build first, update the ledger after meaningful milestones.

## MAJOR MILESTONE — cross-provider Memory Space portability proven

On **8 Aug 2026**, the defining multi-provider test was completed with **Mistral** and **Grok** using the same user-owned Memory Space and the same generic MCP contract.

The verified chain was:

```text
Mistral
   |
   | read the existing shared Memory Space
   | propose_memory
   v
Memory Bridge proposal queue
   |
   v
Phone Memory App
   |
   | Pull / visible review
   | human Approve
   | archive an old duplicate memory
   v
Durable local Memory Space
   |
   | explicit Share again
   v
Mistral reads the changed state back
   |
   v
Grok re-authenticates after bridge restart
   |
   v
Grok reads the Mistral-created, human-approved memory
```

The live second-provider proof established all of the following:

1. Mistral connected to the same public `/mcp` endpoint as Grok.
2. Mistral completed OAuth 2.1 discovery using Dynamic Client Registration.
3. Mistral discovered the Memory Space tools without a provider-specific bridge fork.
4. Mistral read the existing `Memory App` space and the memories previously created/approved during the Grok tests.
5. Mistral called `propose_memory` for a new memory titled `Purpose of Memory Space`.
6. The proposal appeared in the phone app as a pending external-AI proposal.
7. The user approved it locally; Mistral never gained direct trusted-write authority.
8. The user archived one duplicate `First full loop with Grok` memory.
9. The workspace was explicitly shared again.
10. Mistral called `list_spaces` and reported the exact `memoryCount` as **9**.
11. Mistral read the new confirmed `Purpose of Memory Space` memory and correctly saw only one remaining `First full loop with Grok` entry.
12. Grok's old OAuth grant had been cleared by the bridge restart, so Grok correctly required re-authentication.
13. After user re-authentication, Grok also reported `memoryCount: 9` and read `Purpose of Memory Space` successfully.

The new confirmed memory used for the cross-provider test is:

`Purpose of Memory Space`

> Memory Space exists to give the user one private, visible, user-controlled source of long-term context that can be shared across different AI models without the memory belonging to any single model.

This proves more than two connectors working independently.

**Context proposed through one external AI can become durable only after human approval, then be read by another independent AI provider from the same user-owned source of truth.**

No provider-specific memory database was created.

## Earlier milestone — independent Grok MCP loop proven end to end

On **7 Aug 2026**, Grok was connected as the first genuine independent third-party MCP client to the public Memory Bridge and completed the full human-controlled memory round trip.

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

The first live Grok proposal ID was:

`external_b34d408b-77b0-42e4-918e-81ca95b14c9c`

The first approved/read-back memory was:

- title: `First full loop with Grok`
- type: `note`
- importance: `normal`
- status: `confirmed`
- source: `AI proposal approved by user · Chat: External MCP client proposal`

A later Grok proposal created the critical milestone memory:

`Major Milestone: Independent Grok MCP Loop Proven`

That first Grok loop established the product contract; the later Mistral → human approval → Grok read-back established provider portability.

## OAuth Dynamic Client Registration — implemented and live-proven

The bridge originally supported the fixed Grok OAuth client. To support independent providers without adding provider-specific client configuration, OAuth Dynamic Client Registration was added.

Important commit:

- `8d46c3c` — add OAuth dynamic client registration for MCP

Current DCR behaviour:

- in-memory dynamic client registry
- generated `memory-space-dcr-*` client IDs
- `registration_endpoint` advertised in authorization-server metadata
- `POST /register`
- authorization-code flow only
- PKCE / public-client model with `token_endpoint_auth_method=none`
- registered redirect URI must match exactly at authorization time
- redirect hosts remain allow-listed by bridge configuration
- dynamic registrations are RAM-only and disappear on bridge restart
- legacy fixed Grok client remains supported

Mistral's successful live connection validates the DCR path in a real external client.

## Current state

The core product is now beyond a single-provider proof of concept.

**Verified external providers:**

- Grok — read, propose, human approve, re-share, read-back verified
- Mistral — OAuth/DCR connection, read, propose, human approve, changed-state read-back verified
- Cross-provider portability — Mistral-created/human-approved memory read back by Grok verified

The current shared `Memory App` state used in the final portability test contained **9 confirmed memories**.

The current production web app is hosted on Vercel while trusted workspace data remains in browser storage. The HP Windows PC runs Memory Bridge and Ollama. Cloudflare Tunnel exposes the bridge securely over HTTPS.

The phone has successfully:

- paired with `WIZZ HP Bridge`
- chatted through the public bridge to Ollama `gemma3:1b`
- sent selected confirmed Memory Space context to the remote-local model
- explicitly shared the active Memory App space to the bridge
- published current confirmed memories into bridge RAM
- verified the public MCP endpoint through the in-app MCP self-test
- pulled real external AI proposals from the bridge
- visibly reviewed, edited/rejected/approved proposal state
- archived an obsolete/duplicate memory locally
- re-shared the changed source-of-truth state
- proved that two independent providers see that changed state

The bridge self-test reports:

`MCP verified · 7 tools · shared workspace readable · 2026-07-28`

## Architecture now proven

```text
                    USER
             final authority / approval
                       |
                       v
             Phone / Browser Memory App
             durable local source of truth
                       |
                       | explicit Share
                       v
             Cloudflare HTTPS route
                       |
                       v
              HP Memory Bridge :8787
                       |
          +------------+-------------+
          |                          |
          | ephemeral shared state   | OAuth / DCR / MCP
          | proposal queue in RAM    |
          |                          |
          +------------+-------------+
                       |
             +---------+---------+
             |                   |
             v                   v
           Grok                Mistral
          VERIFIED             VERIFIED
                       |
                       v
             future MCP clients
          Claude / Cursor / others
```

Important distinction:

- Browser storage is the durable workspace.
- The bridge does **not** persist the shared workspace to disk.
- Share is explicit.
- Only current confirmed memories are published as trusted current memory.
- Archived/superseded history does not silently re-enter current context.
- External AI changes are proposals only; approval remains human-controlled.
- OAuth grants and DCR registrations are runtime state and can require re-authentication after bridge restart.

## MCP interface currently implemented

Public route:

`https://bridge.w-i-z-z-lab-studios.com/mcp`

The public bridge supports OAuth authorization-code + PKCE and Dynamic Client Registration for compatible external MCP clients. The private bridge pairing token is used at the consent boundary and must never be committed or pasted into public documentation.

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

The browser MCP self-test uses the stateless MCP discovery path and passes against the live HP bridge.

## External AI proposal loop — VERIFIED ACROSS PROVIDERS

```text
External MCP AI
      |
      v
read/search explicitly shared context
      |
      v
propose_memory
      |
      v
HP bridge proposal queue
      |
      v
Memory App -> Pull
      |
      v
Reject / Edit / Approve
      |
      v
Confirmed Memory Space only after user approval
      |
      | explicit Share
      v
Same AI or another authorised AI can read the approved state
```

The Shared Chat screen contains an **External AI inbox** with visible proposal controls.

The verified rule remains:

**External AIs can suggest durable state. They cannot silently make themselves the source of truth.**

## Next provider tests — Claude, then Cursor

The original two-provider portability test is complete.

The next useful compatibility targets are:

1. **Claude** — prove another independent hosted AI can consume the same remote MCP contract.
2. **Cursor** — prove an IDE/coding agent can consume project memory through the same Memory Space rather than receiving a manually rebuilt prompt.

After Claude and Cursor, stop chasing provider count for its own sake. The higher-value work becomes productisation: installer/startup reliability, AI-access UX, permission enforcement, secret handling, clearer status/re-auth flows and a normal-user setup path.

## ChatGPT test status

ChatGPT remains one compatibility target, not the architecture.

The visible product UI previously did not expose a straightforward custom remote MCP control for this account. Do not redesign Memory Bridge around any single provider's current UI. Keep the generic MCP contract stable and retest providers as their product surfaces change.

## Context selection now implemented

The app no longer assumes the entire workspace should be dumped into every model request.

A focused local selector:

- stays inside the active space
- uses confirmed memory only
- prioritises locked and critical memories
- scores memories against the current request/recent chat
- defaults to a maximum focused set rather than sending everything as the workspace grows

Shared Chat shows a **Context budget** trace so the user can see how many memories were selected.

Current small-workspace behaviour may still select the full current set when all items are relevant.

### Banked context-inspector idea

Later, Context Budget can become a proper inspector with:

- estimated token count
- context package size
- selected-memory explanations
- `why selected` information
- package preview
- live rebuild after memory changes

Do not let this distract from productisation and permission hardening.

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

On 7 Aug 2026 the mobile AI panel was patched so pending external proposals are no longer hidden under the chat. Proposal cards take natural space, chat remains scrollable, and confirmed memory cards were compacted to reduce vertical waste.

Real external Grok and Mistral proposals have now been reviewed through the human-controlled loop.

### Desktop

Desktop gives Memory and AI proper side-by-side workspace weight.

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
- `8bf7e64` — bridge/MCP/OAuth groundwork
- `302f09c` — MCP protected-resource metadata compatibility + OAuth diagnostics
- `61591e80` — fix Grok OAuth callback redirect
- `132c53dd` — fix mobile proposal visibility and compact memory cards
- `79cecf1e` — final mobile CSS cache bump while preserving existing app wiring
- `ffc8b082` — record Grok full MCP round-trip milestone
- `8d46c3c` — add OAuth dynamic client registration for MCP

## Regression / debugging notes

A context-trace patch temporarily caused the Shared Chat UI to disappear because a `MutationObserver` repeatedly triggered its own render changes. This was fixed in `ff773b5f` by stopping the render loop and only observing until the panel exists.

During Grok OAuth testing, repeated `consent approved` logs with no `/token request` exposed a callback-navigation compatibility bug. The OAuth consent page redirect/CSP path was corrected and Grok then completed token exchange successfully.

If Shared Chat ever disappears again, inspect startup JavaScript before assuming Vercel or the phone is still loading.

If OAuth reaches `consent approved` but never logs `token request`, inspect the browser callback/redirect boundary rather than the pairing token first.

A bridge restart clears the current RAM-only OAuth grants, dynamic client registrations and shared workspace state. External providers may therefore show `Auth required` until the user re-authenticates and the workspace is explicitly shared again. This behaviour was observed and successfully recovered with Grok during the Mistral portability test.

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

After bridge server code changes on GitHub, the HP clone needs `git pull` and the Node bridge process must be restarted. Pure frontend/Vercel patches do not require an HP restart.

OAuth grants, dynamic registrations and the shared bridge workspace are currently held in RAM. Restarting the bridge clears that runtime state and requires re-authentication/re-sharing where applicable.

## Security / permission housekeeping

The bridge pairing token appeared during live development setup/screenshots and should be rotated. Do not place the replacement token in this README, Git history, screenshots or chat logs.

Current OAuth scopes include `memory.read` and `memory.propose`. These scopes should become hard tool-level authorization boundaries rather than merely being issued/recorded.

Target permission model:

- access is granted **per Space**
- read/search confirmed memory can be granted independently from proposal rights
- external AI may propose only when `memory.propose` is granted
- external AI never receives direct approve/delete/archive/lock authority over trusted memory
- user can revoke an AI's grant clearly and immediately
- every external action keeps provider/client provenance
- future grants may be time-limited or task-scoped

The app/phone remains the human control surface and root authority.

## Product rules — do not break these

- Memory Space owns the long-term truth.
- The user is the final authority.
- Models are replaceable workers.
- The user chooses what becomes trusted memory.
- External AIs may read/search only explicitly shared/authorised memory.
- External AIs may propose changes only when granted that capability.
- External AIs must not silently approve/write/delete/archive trusted memory.
- Only current confirmed memories enter active trusted context.
- Superseded/archived history remains history, not current context.
- Pairing/connection tests should not leak workspace data.
- Shared bridge workspace remains ephemeral RAM-only unless the product deliberately changes later.
- No silent cloud fallback.
- Local-only/private operation remains a first-class mode, not a degraded fallback.
- No provider-specific fork of the user's memory database.
- Access to one Space must not imply access to another Space.
- **Knowledge, artifacts and execution are separate permission layers.** Knowing project context does not automatically grant authority to modify code/files or execute tools.
- Keep the bridge generic: Grok, Mistral, Claude, ChatGPT, Gemini, Cursor, VS Code, local models and future MCP clients should use the same contract.

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

The current Grok + Mistral proof demonstrates that this room can persist while the AI changes.

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
- per-space authorization
- clear provenance
- clear deletion/export controls
- no private memory in analytics
- no unrestricted external database access
- human approval for trusted long-term changes
- local/private mode remains available even if cloud conveniences are added later

---

# Banked expansion — Memory Space as an AI workspace control layer

This is **not the current build priority**, but it is a natural extension of the architecture now proven.

The same rules can govern more than long-term memory. A Space can become a project room in which the user controls what each AI may know and what each AI may do.

```text
                         USER
                  root authority / approval
                           |
                           v
                     PROJECT SPACE
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
       MEMORY           ARTIFACTS        EXECUTION
   trusted context     code / files      tools / sandbox
          |                |                |
          +----------------+----------------+
                           |
                     scoped AI worker
```

The separation is deliberate:

- **Memory / knowledge** — what trusted project context the AI may read.
- **Artifacts** — which files, repositories, documents, images or outputs it may access.
- **Execution** — which tools/actions it may actually run.

Permission in one layer must not silently imply permission in another.

## Code Space concept

A future `Code Space` can attach a repository or code-server/IDE sandbox to a Memory Space.

A coding AI could receive a task-scoped context package such as:

```text
PROJECT
Space Junkz

GOAL
Integrate reusable BossBrain into selected bosses

TRUSTED PROJECT MEMORY
- architecture decisions
- current milestone
- known regressions
- coding rules
- previous decisions relevant to this task

CAPABILITIES
+ read/search project memory
+ read repository
+ modify isolated branch/sandbox
+ run approved tests
- merge to main
- approve its own memory proposals
- read unrelated/private Spaces
```

The coding model can change over time — Cursor, Claude Code, Codex, a local model or another IDE agent — while the project knowledge remains in the same user-owned Space.

When work finishes, the agent can return artifacts plus proposed project-state memories for human review rather than silently rewriting the project's trusted history.

```text
Memory Space provides project brain
          |
          v
Coding AI works in sandbox
          |
          v
code / tests / artifacts
          |
          v
proposed project-state update
          |
          v
human review
          |
          +--> merge code if approved
          +--> confirm memory if approved
```

## Nested spaces / user-designed AI network

Longer term, users could design their own trust network with isolated spaces and explicit capability grants.

```text
User / Company
|
+-- Personal
|   +-- private memory
|
+-- Project A
|   +-- Memory
|   +-- Code Space
|   +-- Files
|   +-- AI workers
|
+-- Project B
|   +-- Research
|   +-- Artifacts
|   +-- AI workers
|
+-- Private
    +-- undiscoverable to workers without permission
```

Potential permission patterns include:

- read-only researcher
- read + propose memory worker
- coding worker with one sandbox branch
- reviewer with read access but no execution
- temporary two-hour access
- one-task capability grants

This can support several future product surfaces without changing the core trust model:

- **Memory Space Personal** — portable long-term personal/project context across AI providers
- **Memory Space Dev** — project memory + code sandbox + IDE/coding agents
- **Memory Space Teams** — company/project rooms with human and AI workers
- **Memory Space Studio** — creative files, briefs, images/video/3D and AI workers
- **Memory Space Research** — sources, conclusions, provenance and research agents
- **Memory Space Agent Office** — multiple scoped AI workers collaborating through shared user-controlled state

The stable layer is the workspace, not any individual model.

---

# Roadmap after the multi-provider proof

1. Connect and verify **Claude** against the same generic Memory Space MCP contract.
2. Connect and verify **Cursor** or another coding/IDE client using the same project memory.
3. Then stop expanding provider count temporarily and focus on productisation.
4. Make HP Ollama + Memory Bridge persistent across reboot.
5. Rotate exposed development pairing credentials and tighten operational secret handling.
6. Enforce OAuth scopes at individual MCP tool boundaries.
7. Add a simple user-facing **AI Access** view: provider, Space, Read, Propose, Revoke.
8. Replace developer-facing setup language with `Connect AI -> Authorize -> Connected` for normal users.
9. Hide bridge URLs, tokens, DCR/OAuth details and MCP diagnostics behind Advanced/Developer controls.
10. Add contradiction detection and explicit supersede proposals.
11. Improve history/timeline and archive UX.
12. Harden durable storage toward IndexedDB/versioned exports.
13. Package local/private mode so normal users do not need Node, PowerShell, Cloudflare or manual token handling.
14. Only after the core product is reliable, prototype Code Space / task-scoped sandboxes using the same permission model.
15. Semantic/vector retrieval only when deterministic/full-text retrieval demonstrates a real limitation.

## Productisation target

The normal-user path should eventually be approximately:

```text
Install
  -> Create Space
  -> Connect AI
  -> Authorize what it can access
  -> Connected
```

A non-technical user should not need to understand MCP, OAuth, Cloudflare, Node, PowerShell or long bearer tokens to get the core benefit.

---

# Guiding principle

The memory is not generated about the user behind the scenes.

It is created **with** the user in a space they can see, understand and control.

The user owns the room. AI gets a key, not the building.

The AI is a worker. The provider is replaceable. The bridge is infrastructure.

**The shared Memory Space is the product.**