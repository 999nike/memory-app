# Memory App

A private, visible, long-term workspace that a human and an AI build together.

This is not ordinary hidden chatbot memory and it is not a dump of every conversation. The product gives the user a dedicated virtual space where important facts, project decisions, plans, files, relationships, and history can be deliberately preserved, inspected, corrected, linked, and removed.

The AI can suggest what may be worth remembering. The user remains the final authority over what becomes trusted long-term memory.

## Current prototype status — 7 Aug 2026

The core product loop is now proven on a Samsung S24 Ultra in Chrome.

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
- Mobile Send/touch handling fixed
- Mobile chat now remains at normal page scale when the keyboard opens

### Architecture already in place

Memory Space owns the long-term truth. Models are replaceable workers.

Current provider path:

`Memory Space -> context firewall -> provider interface -> selected AI`

Current provider types:

- On-device browser model
- Ollama connection definition
- LM Studio connection definition
- Generic OpenAI-compatible local server

The browser-local model is only the prototype inference engine. It does not own memory and can be replaced without changing the workspace.

### Important product rules now enforced

- No permanent AI memory without user approval
- A proposed memory is not treated as confirmed memory
- Locked/current memory is visible to the user
- Superseded and archived history stays available but is excluded from current model context
- Provider connection tests receive no private workspace context
- No silent cloud fallback
- Approved memories are not silently rewritten after approval

### Next build order

1. **Memory Bridge protocol**
   - Allow a phone/browser Memory Space to reach an AI runtime on another trusted machine
   - Keep the model on that machine rather than turning Memory Space into a cloud inference service
   - Add explicit pairing/permission rather than open LAN access
   - Keep the context firewall at the browser boundary

2. **Real external-local provider test**
   - Test against Ollama or LM Studio on a machine running an actual model
   - Confirm provider switching preserves the same Memory Space
   - Confirm only current confirmed context is transmitted

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
