# Memory App

A private, visible, long-term workspace that a human and an AI build together.

This is not ordinary hidden chatbot memory and it is not a dump of every conversation. The product gives the user a dedicated virtual space where important facts, project decisions, plans, files, relationships, and history can be deliberately preserved, inspected, corrected, linked, and removed.

The AI can suggest what may be worth remembering. The user remains the final authority over what becomes trusted long-term memory.

## Current prototype status — 7 Aug 2026

The core product loop is proven. Memory Bridge is also proven from the phone to the HP at the network/pairing layer. The remaining bridge proof is the first normal in-app chat request through the paired HP model, which is currently blocked by an open mobile chat focus-zoom regression.

### Proven working

- Local-first workspace stored in the browser
- Separate memory spaces
- Create, edit, lock, archive, export, and import memory
- Shared chat inside the active space
- On-device browser inference using a small local WebGPU model
- Deterministic memory controller for important facts and project statements
- AI memory proposals with user approval before permanent storage
- Proven persistence test: approve a memory, clear chat, ask again, and recall from confirmed memory
- Proven source display through `Used: <memory title>` on recall
- Memory provenance from the original chat statement
- Memory version history
- Superseded memories retained as history rather than silently overwritten
- Context firewall: only current confirmed memories enter active AI context
- Provider registry so the memory system is not tied to one model
- Local provider connection UI for Ollama, LM Studio, and OpenAI-compatible local servers
- Safe provider connection test that sends no Memory Space context
- Memory Bridge v1 browser protocol client
- Memory Bridge pairing UI with a separate remote-local trust boundary
- Memory Bridge companion server for forwarding to a model on another trusted machine
- Pairing-token authentication and origin allow-listing on the bridge companion
- Bridge pairing test that sends no workspace memory
- Bridge protocol documented in `bridge/README.md`
- Mobile Send/touch handling fixed
- HP external-local runtime proof: standalone Ollama is running `gemma3:1b` and answered a direct local prompt
- HP bridge local proof: authenticated `/v1/info` and `/v1/chat` succeeded on `http://127.0.0.1:8787`
- Public bridge proof: authenticated `/v1/info` succeeded through `https://bridge.w-i-z-z-lab-studios.com`
- Phone pairing proof: the Samsung phone successfully paired Memory Space with `WIZZ HP Bridge`

### HP / Cloudflare test state

Current first bridge machine is the HP Windows server PC.

- Ollama lives under `E:\WIZZ-Server\ollama`
- Model storage is `E:\WIZZ-Server\ollama\models`
- First model is `gemma3:1b`
- Memory App repo is cloned at `E:\WIZZ-Server\workspaces\memory-app`
- Memory Bridge listens locally on `127.0.0.1:8787`
- Ollama listens locally on `127.0.0.1:11434`
- The pairing token is stored privately by the user and must never be committed to the repository
- Existing Cloudflare tunnel remains in use
- Existing media route remains `media.w-i-z-z-lab-studios.com -> http://127.0.0.1:8081`
- New bridge route is `bridge.w-i-z-z-lab-studios.com -> http://127.0.0.1:8787`
- The public bridge hostname is reachable and token authentication works
- The phone has already saved/paired the bridge connection
- Ollama and Memory Bridge are currently being run from PowerShell windows; persistence across reboot has not yet been configured

### Open blocker — mobile chat focus zoom

**OPEN. Do not mark this fixed until it is verified on the phone again.**

The main chat textarea automatically zooms the page when it receives focus on the Samsung S24 Ultra in Chrome. This behaviour had previously been fixed and was confirmed good at commit `4617cb1a5bfd4ad0ce233f05d715263370c5f3f6` (`Restore normal mobile viewport behavior`), but it has regressed during later bridge work.

User requirement is explicit:

- Manual pinch zoom must remain available
- Tapping/focusing the normal chat typing box must not change page scale
- Do not disable pinch zoom
- Do not use `maximum-scale=1` or `user-scalable=no`
- Do not add `visualViewport` resizing/scrolling hacks
- Do not add document-wide `zoom`, `transform: scale()`, or width compensation
- Do not rewrite the viewport dynamically in JavaScript

The intended viewport remains:

`width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content`

Recent attempts around the regression include commits `1927e829`, `74168080`, `a96d7077`, and `395163db`. They did not resolve the main chat focus zoom on the phone. The next debugging pass should compare the actual known-good mobile state at `4617cb1...` with current runtime/computed behaviour and avoid stacking more zoom workarounds.

### Architecture already in place

Memory Space owns the long-term truth. Models are replaceable workers.

Current provider path:

`Memory Space -> context firewall -> provider interface -> selected AI`

Remote-local path:

`Memory Space -> context firewall -> Memory Bridge -> model runtime on trusted machine`

Current provider types:

- On-device browser model
- Ollama connection definition
- LM Studio connection definition
- Generic OpenAI-compatible local server
- Memory Bridge remote-local provider

The browser-local model is only the prototype inference engine. It does not own memory and can be replaced without changing the workspace.

### Important product rules now enforced

- No permanent AI memory without user approval
- A proposed memory is not treated as confirmed memory
- Locked/current memory is visible to the user
- Superseded and archived history stays available but is excluded from current model context
- Provider and bridge connection tests receive no private workspace context
- The Memory Bridge requires explicit pairing and does not store the workspace
- No silent cloud fallback
- Approved memories are not silently rewritten after approval

### Next build order

1. **Fix the mobile main-chat focus zoom regression**
   - Restore the previously verified behaviour: keyboard opens, page scale stays unchanged
   - Preserve manual pinch zoom
   - Verify on the Samsung phone before marking closed

2. **Complete the real external-local provider test**
   - Phone is already paired to `WIZZ HP Bridge`
   - Send the first normal Memory Space chat request through the bridge to HP `gemma3:1b`
   - Ask a question that requires an existing confirmed memory
   - Confirm only current confirmed context is transmitted
   - Confirm provider switching preserves the same Memory Space
   - After the proof succeeds, make Ollama and Memory Bridge persistent across HP reboot

3. **MCP interface**
   - Expose Memory Space as controlled tools for compatible AI clients
   - Initial tools: search memory, get current space context, read a memory, propose a memory, list spaces, get current decisions
   - Approval remains human-only; external AIs do not receive an unrestricted write/approve tool

4. **Memory lifecycle improvements**
   - Contradiction detection
   - Explicit supersede proposals
   - Better history UI
   - Timeline view

5. **Storage hardening**
   - Move larger browser state toward IndexedDB
   - Add backup/versioned export manifest
   - Add optional client-side encryption experiments

6. **Native/desktop routes**
   - Android/native bridge for local device models such as AICore/ML Kit or bundled runtimes
   - Desktop packaging later with Tauri + SQLite

7. **Retrieval improvements only when needed**
   - Start with deterministic/full-text retrieval
   - Add semantic/vector search only after the current approach demonstrates a real limitation

### Test policy

We do not need the user to retest every internal patch. Testing is required at meaningful boundaries:

- visible mobile/UI behaviour
- persistence/lifecycle changes
- provider connection to a real model/runtime
- privacy/context-firewall boundaries
- import/export recovery

Small internal refactors can proceed with build/read-back verification and be recorded here.

## Core idea

Most AI assistants begin each conversation with incomplete context. Existing memory systems help, but the stored information is often invisible, difficult to correct, and mixed together across unrelated work.

Memory App turns long-term context into a visible product surface.

A user opens a space such as:

- A software project
- A business idea
- A game
- A book
- Personal planning
- Medical or legal notes
- Research
- A house renovation
- Any long-running area where continuity matters

Inside that space, the human and AI share the same structured memory. The AI can understand what the space is, what has already happened, which decisions were made, what must not be forgotten, and what remains unresolved.

The experience should feel like the AI is returning to the same room rather than meeting the user again from scratch.

## Product promise

Memory App should provide:

- User-owned memory
- Visible memory rather than hidden memory
- Deliberate saving of important information
- Separate spaces for separate projects or areas of life
- Source-backed facts and decisions
- Complete editing, export, and deletion
- Local-first storage
- Model portability
- Clear explanations of why a memory was used

## What makes it different

A notes app stores information.

Memory App helps maintain a living context system.

The AI should be able to:

- Suggest important memories from a conversation
- Organise information into the correct space
- Link related facts and decisions
- Detect likely contradictions
- Mark old information as superseded
- Build concise project summaries
- Surface unresolved questions
- Assemble the right context for a new conversation
- Explain where each memory came from

The user should be able to:

- Approve, edit, reject, lock, move, or delete a proposed memory
- See every trusted memory the AI can use
- Control which spaces an AI or model can access
- Inspect the original source of a memory
- Export the complete workspace in a portable format
- Wipe a space completely

## Memory model

The system should keep important memory separate from normal background context.

### 1. Confirmed workspace memory

Deliberately approved information that belongs to a space.

Examples:

- Project goals
- Architectural decisions
- Important numbers
- People and roles
- Constraints
- Reasons behind decisions
- Rejected approaches
- Current status
- Next actions

This is the most trusted memory layer.

### 2. Locked memory

Critical information that must not be silently changed or replaced.

Examples:

- Privacy rules
- Non-negotiable project requirements
- Legal or safety constraints
- Foundational decisions

Changing a locked memory should always require explicit user approval.

### 3. Proposed memory

Information the AI believes may be worth keeping.

Proposed memories remain in an inbox until the user approves, edits, rejects, or marks them temporary.

### 4. Working memory

Recent context that helps with the current task but does not automatically become permanent.

Examples:

- Recent messages
- Temporary calculations
- Draft ideas
- Current task state

Working memory can expire automatically.

### 5. Automatic personal memory

Ordinary convenience memory such as preferences, recurring settings, or communication style.

This tier should remain separate from trusted project memory so it cannot pollute important decisions.

### 6. Raw archive

Full conversations, imported notes, and source material that remain searchable but are not automatically inserted into every AI request.

The archive is evidence, not active memory.

## Memory states

Every memory item should have a clear state:

- Proposed
- Confirmed
- Locked
- Temporary
- Superseded
- Archived
- Deleted

Deleting should remove the item from active use. The product should clearly explain whether deletion is soft, permanent, or awaiting secure cleanup.

## Memory item structure

A useful memory record should include:

- Unique identifier
- Space identifier
- Title
- Content
- Type
- Importance
- Status
- Scope
- Source
- Created by
- Created date
- Last updated date
- Expiry date when temporary
- Links to related memories
- Superseded-by or supersedes relationship
- Version history
- User approval state

The source matters. A memory without provenance can allow a misunderstanding or AI guess to become accepted as fact.

## Main user experience

### Spaces

Users create isolated spaces for projects, work, research, or personal areas.

A space contains its own:

- Memories
- Conversations
- Files
- Decisions
- Timeline
- Relationships
- Open questions
- Tasks or next actions

Global memories should only enter a space when the user has allowed them.

### Shared chat and memory view

The main screen should place the conversation beside the visible memory workspace.

During a conversation, the AI can propose a memory. The user can immediately approve, edit, reject, lock, or assign it to another space.

The AI should never pretend that a proposed memory has been permanently saved before the application confirms it.

### Memory inbox

A review queue for AI-proposed memories.

Each proposal should show:

- The proposed memory
- Why the AI believes it matters
- Suggested space
- Suggested importance
- Original source
- Possible conflicts with existing memory

### Memory board

A clean card view of active goals, facts, decisions, people, constraints, and open questions.

### Timeline

A chronological view showing how a project or personal situation changed over time.

### Relationship view

A graph or linked view showing how memories support, depend on, contradict, or replace one another.

This is useful later, but it is not required for the first working prototype.

### Context inspector

Before or after an AI response, the user should be able to inspect which memories were supplied to the model and why.

This is one of the most important trust features.

### Search

Search should cover:

- Confirmed memories
- Archived memories
- Conversations
- Files
- Sources
- Dates
- People
- Tags
- Relationships

Start with normal full-text search. Add semantic search only when it solves a demonstrated problem.

## AI interaction rules

The AI should receive controlled tools rather than unrestricted database access.

Initial actions should include:

- Read relevant memory
- Search a space
- Propose a new memory
- Propose an update
- Propose a relationship
- Propose that an item is superseded
- Request user approval
- Explain why a memory was retrieved

By default, important changes should require approval.

Automatic saving may be offered later for low-risk preferences or temporary working memory, but it must be optional and transparent.

## Context assembly

The application should not send the entire database to the model.

For each AI request, the client builds a focused context package from:

1. The current space instructions
2. Locked memories
3. Relevant confirmed memories
4. Current goals and open decisions
5. Recent conversation context
6. Retrieved archive material when needed
7. The user's current request

The user should be able to inspect this package through the context inspector.

## Local-first architecture

The first version does not need Pinecone, Upstash, or a hosted vector database.

The project should begin with local storage and simple retrieval.

### Web prototype

Because this repository is connected to Vercel, the first usable version can be a local-first web application where:

- The interface is served by Vercel
- User memory remains in the browser
- IndexedDB stores spaces, memories, conversations, and settings
- A service worker enables offline use
- Export and import protect against browser data loss
- No server database is required

This allows the product and interaction model to be proven before introducing infrastructure.

### Private desktop version

After the browser prototype proves the idea, the application can be packaged as a desktop app using Tauri.

The desktop version can use:

- SQLite for structured storage
- Local files for attachments
- Full-text search through SQLite FTS
- Operating-system key storage
- Optional encryption at rest
- Optional local model access through Ollama or another local runtime

### AI providers

The memory system should not belong to one model provider.

Possible model modes:

- User-supplied cloud API key
- Server-mediated cloud model, only when explicitly enabled
- Local model through Ollama
- No-AI mode for manual workspace management

The model is replaceable. The user-owned context is the long-term asset.

## Privacy and security principles

- Store data locally by default
- Do not sync without explicit opt-in
- Do not log private memory on the server
- Never expose provider API keys to other users
- Make export and deletion straightforward
- Encrypt sensitive local data where practical
- Keep spaces isolated
- Ask before allowing one space or agent to read another
- Show what context was sent to a model
- Avoid placing raw private content in analytics

The distinction between local storage and local inference must remain clear. A user may store memory locally while still choosing to send selected context to a cloud model.

## Recommended first stack

The exact framework should be confirmed after the initial repository setup, but a practical route is:

- Next.js with TypeScript
- Vercel for the hosted web shell
- IndexedDB through Dexie for browser-local data
- Tailwind CSS and accessible UI components
- Zod for schema validation
- Web Crypto for client-side encryption experiments
- Optional AI SDK integration behind a provider interface
- Vitest for unit tests
- Playwright for end-to-end tests

Do not add cloud databases, authentication systems, queues, or vector infrastructure until the local product loop works.

> **Prototype note:** the current proof-of-concept intentionally uses a simpler static JavaScript/CSS web shell and browser storage. The heavier stack above remains an option after the interaction model is stable; it is not a requirement for the prototype.

## MVP

The first MVP should prove one complete loop:

1. Create a space
2. Add a confirmed memory manually
3. Start a conversation inside that space
4. Let the AI read the relevant memory
5. Let the AI propose a new memory
6. Show the proposal in the memory inbox
7. Approve or edit it
8. Use the approved memory in a later conversation
9. Show why that memory was retrieved
10. Export and restore the space

### MVP screens

- Space list
- Create space
- Space dashboard
- Shared chat and memory view
- Memory inbox
- Memory editor
- Search
- Context inspector
- Export, import, and delete settings

### MVP memory types

- Fact
- Goal
- Decision
- Constraint
- Person
- Preference
- Open question
- Next action
- Note

## Build phases

### Phase 0 — Product foundation — substantially complete

- Confirm product language and naming
- Define the memory schema
- Define space isolation rules
- Define AI proposal and approval rules
- Establish local-first and privacy requirements
- Create basic application structure

### Phase 1 — Manual local workspace — working prototype complete

- Create, rename, and delete spaces
- Create, edit, lock, archive, and delete memory items
- Filter memories by type, status, and importance
- Store all data locally
- Add export and import
- Add basic full-text search

This phase works without any AI model.

### Phase 2 — AI-assisted memory — core loop proven

- Add a provider interface
- Add chat inside a selected space
- Build focused context packages
- Add AI memory proposals
- Add approval, edit, reject, and lock actions
- Record source and provenance
- Add the context inspector
- Add Memory Bridge v1 protocol/client/companion for remote-local inference

### Phase 3 — Continuity and trust — in progress

- Memory version history — implemented
- Superseded relationships — implemented at lifecycle level
- Current-memory context firewall — implemented
- Contradiction warnings — next
- Timeline view — pending
- Improve retrieval scoring — pending
- Add clear explanations for every retrieved memory — basic `Used:` provenance works; richer explanation pending

### Phase 4 — Private desktop/native app — planned

- Package with Tauri
- Move primary storage to SQLite
- Add local attachments
- Add encrypted vault support
- Add local-model integration
- Add backup and restore

The Memory Bridge and provider work is intentionally being built before packaging so the same provider contract can be reused by browser, desktop, and native clients.

### Phase 5 — Optional sync and collaboration — intentionally deferred

Only after the private single-user product works:

- Encrypted user-controlled sync
- Multiple devices
- Shared spaces
- Permission roles
- Team memory proposals and approvals

Cloud sync must remain optional, not foundational.

## Initial data entities

The first implementation will likely need:

- User settings
- Spaces
- Memory items
- Memory versions
- Memory relationships
- Source references
- Conversations
- Messages
- Context runs
- AI proposals
- Attachments
- Export manifests

## Non-goals for the first version

- Storing every message as trusted memory
- Building a social network
- Building a general cloud knowledge platform
- Supporting teams before the single-user experience works
- Adding Pinecone or another vector database immediately
- Building a complex agent swarm
- Allowing the AI to silently rewrite critical memories
- Locking the product to one AI provider

## First success test

The prototype succeeds when a user can save an important project decision, close the app, return later, open the same space, and have the AI correctly use that decision while showing the user exactly what it remembered and why.

A simple example is an important number such as ten. The value itself is not the product. The product is that the user can see that ten was saved, understand why it matters, control where it applies, correct or remove it, and verify when the AI uses it.

**Status:** this success test has been passed on the current prototype. A favourite-number memory was approved, chat history was cleared, and a later conversation recalled the current confirmed value while identifying the memory that supplied it.

## Guiding principle

The memory is not generated about the user behind the scenes.

It is created with the user in a space they can see, understand, and control.

That shared space is the product.