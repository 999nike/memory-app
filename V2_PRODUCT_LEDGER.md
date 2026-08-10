# Memory Space V2 Product Ledger

This file is for **future V2 ideas only**. It must not be treated as permission to reopen or destabilise the proven V1 core loop.

## Core rule

V1 remains the trusted foundation:

```text
Space
    -> confirmed memory
    -> AI reads / proposes
    -> human reviews
    -> human approves / edits / rejects
```

V2 should grow by **bolting on new layers beside the core**, not by rewriting the core memory system.

The core memories remain the trusted, user-controlled source of truth. New systems may reference them, organise around them, index them or propose relationships, but they do not silently rewrite or pollute them.

---

## V2 direction — layered Memory Space

The Memory App can evolve into a top-level workspace with separate sections/layers such as:

```text
Memory App
│
├── AI / Local AI
├── Core Memories
├── Secondary Memories
├── Projects / Workflow
├── Files / Storage
├── Smart Graph / Organiser
└── future add-ons
```

The important architectural decision is that these are **separate modules/layers**. They can be added later without changing the proven V1 bridge/OAuth/propose/review/confirm loop.

### Stable interface between layers

Future add-ons should work through a narrow contract:

- read confirmed core memories
- reference stable memory IDs
- create their own metadata / relationships / indexes
- propose organisation or structural changes
- require user approval before durable structural changes
- never silently mutate core memory truth

This is intended to let Memory Space grow into a platform rather than forcing every future feature into one memory table.

---

## V2 direction — Connector App + future Master App

A major V2 direction is to stop treating every future capability as something that must be inserted into the Memory App itself.

The current Memory App should remain the stable **memory/workspace core**. A separate **Connector App** should sit beside it and own the fast-changing connectivity/integration layer.

Conceptually:

```text
                    Future Master App
                 unified user control plane
                          |
          +---------------+----------------+
          |                                |
          v                                v
     Memory App                       Connector App
  trusted workspace                connections / bridges
  core + secondary memory          providers / clients
  projects / context               integrations / automation
          |                                |
          +---------------+----------------+
                          |
                     Memory Bridge
                          |
             external AI / apps / agents
```

This is a **bolt-on architecture**, not a replacement for V1.

### Memory App responsibility

Keep the Memory App focused on the durable user-owned state:

- Core Memories
- Secondary Memories
- Spaces / projects
- trusted context
- memory lifecycle and provenance
- human approval boundaries
- project state and future project-linked artifacts

It should not become a giant networking/settings application just because more external systems become connectable.

### Connector App responsibility

The Connector App is the front end for connectivity and integration. It can evolve faster without destabilising the trusted memory core.

Possible responsibilities:

- Memory Bridge setup and health
- external AI connections
- local AI connections
- provider/client registry
- tunnel/connection status
- future app integrations
- extension/add-on management
- automation/workflow connections
- permission visibility
- revoke/disconnect controls
- diagnostics expressed in normal user language

For the owner/operator view, it should eventually make client bridge health visible at a glance. The goal is not to expose customer memory internally; it is to see whether the **connection itself** is healthy so bridge failures can be found and fixed quickly.

Possible operator status surface:

```text
Client / connection
    -> online / offline
    -> bridge reachable
    -> tunnel healthy
    -> provider authorised
    -> last successful heartbeat/action
    -> warning/error state
```

Use simple live status lights/cards rather than requiring raw logs for routine monitoring.

### Future Master App

Longer term, the product can grow a **Master App** above the subsystems.

The Master App is the user's main house/control plane. Memory App and Connector App become major modules inside it, while later capabilities remain bolt-ons/extensions rather than being welded into one codebase.

Possible shell:

```text
Master App
│
├── Home / overview
├── Memory Spaces
├── Projects
├── AI workers
├── Connections
├── Files / artifacts
├── Graph / project map
├── Extensions
└── system / bridge health
```

The exact packaging is not decided: these may begin as separate applications and later appear inside one shell. Preserve clean subsystem boundaries either way.

### Human workspace / Cline-style visual direction

A key UX target is a more human project workspace rather than one long settings/chat screen.

Useful inspiration is the way coding workspaces can expose different parts of a project in separate visible panes/cards. Memory Space should eventually let a user **see their project, ideas, core memory, connected workers and structure at the same time**.

Possible workspace regions:

```text
+----------------------+----------------------+
| Project / graph      | Active AI / chat     |
| structure            | worker conversation  |
|                      |                      |
+----------------------+----------------------+
| Core / project       | Files / artifacts    |
| memory               | outputs / tasks      |
+----------------------+----------------------+
```

This should not copy any particular product literally. The design principle is the important part: make the project state visible and spatial, with separate boxes/panes for different jobs instead of burying everything in one feed.

The Smart Graph/Organiser described below fits naturally into this workspace as a visual project/memory structure view.

### Extension model

Treat future applications and specialised capabilities as **bolted-on extensions**.

An extension should declare what it needs rather than inheriting broad authority from the Master App.

Examples:

- memory read
- memory propose
- project metadata
- file read/write
- repository access
- execution/tool access
- bridge/network connection

Installing or opening an extension must not silently grant access to every Space, file or tool.

The architectural rule remains:

> One main house, many replaceable rooms/tools, explicit doors between them.

---

## Core Memories — small, trusted, deliberately limited

Core Memories should stay high-value and human-trusted.

Nothing automated should dump large volumes of secondary context into Core Memories.

A future free tier may cap Core Memories at roughly **100–200 confirmed memories per user**. The exact number is **not decided yet** and should be based on real usage data, average memory size, retrieval quality and infrastructure cost rather than an arbitrary round number.

Current product hypothesis:

- 100 may become restrictive quickly once automatic proposals are used regularly
- 200 may be a safer free personal-core allowance
- measure before deciding

Hitting the Core Memory limit should not mean losing data. The user should be able to move/archive less-critical information into secondary layers or add additional memory capabilities.

---

## Secondary Memories

Secondary Memories are a separate layer for context that should not occupy the trusted Core Memory allowance.

Possible future uses:

- lower-priority memories
- archived context
- automatically extracted context awaiting organisation
- project-specific supporting material
- expanded long-term context that does not belong in the core truth layer

Secondary Memories can have their own list/tree/map view and remain separate from Core Memories.

---

## Smart organiser / visual memory graph

Manual filing will not scale once users reach hundreds or thousands of memories. Normal users should not be expected to spend hours maintaining folders and categories.

A future smart organiser should be able to read a memory layer and build a **proposed visual structure** for the user to inspect.

Possible UI modes:

```text
List
Tree
Map / Graph
Search
```

When a user opens `Core Memories` or `Secondary Memories`, they should eventually be able to switch to a visual node/tree/root system where:

- each memory can appear as a clickable node
- related memories are linked
- projects, workflows, decisions and themes can form branches/clusters
- selecting a node opens the actual memory
- search finds matching memories and highlights their node/location
- the graph is an organisational layer, not the memory itself

The smart organiser may propose things such as:

- related memories to group
- project/topic clusters
- duplicate or near-duplicate material
- older decisions possibly superseded by newer decisions
- memories that may belong in Secondary rather than Core
- useful branch/node names

The user remains the approval boundary.

### Reasoning engine placement

The organiser does **not** need to live inside the Core Memory implementation.

Preferred conceptual split:

```text
Memory Core = trusted truth
Memory Organiser = reasoning / clustering engine
Visual Sandbox = proposed tree / graph
User approval = accepted organisation
```

The organiser could later run:

- locally in the browser/device
- in the companion local runtime
- on the user's own server
- as an optional hosted/paid service

The app can still render the graph as a native part of Memory Space while the reasoning engine remains outside the core storage layer.

### Possible future implementation ingredients

Do not commit to a specific vendor or architecture yet. Candidate techniques may include:

- embeddings / semantic similarity for candidate links
- deterministic metadata such as project, type, date and provenance
- explicit user-created links
- an LLM for semantic interpretation, cluster naming and proposed organisation
- human approval before durable changes

No external memory product such as Mem0 is assumed or required for this design.

---

## Projects and file storage

If Memory Space later moves beyond ordinary browser-local storage capacity, it may grow project sections that include files as well as memories.

Possible future model:

```text
Project
├── memories
├── decisions
├── notes
├── files
├── screenshots
├── documents
└── project-specific AI context
```

The browser can remain the UI while a local companion runtime or filesystem-backed store handles larger project data.

This would allow the local AI and external authorised AIs to work with scoped project context without turning Core Memories into file storage.

Storage expansion is a future system and should not be forced into V1 browser persistence prematurely.

---

## Add-on architecture

The long-term goal is to make new capabilities bolt-ons rather than rewrites.

Examples of future add-ons that should be possible without changing the V1 core loop:

- Secondary Memory
- visual graph/tree organiser
- Projects
- file storage
- semantic/vector retrieval
- local AI enhancements
- agent registry / agent tools
- Connector App integrations
- specialised workflow layers
- future memory engines designed in-house

Each add-on should have its own schema/state and link back to stable core IDs where needed.

The guiding rule is:

> Build new systems around the proven core. Do not keep rebuilding the core every time the product grows.

---

## Paid / advanced memory direction

A future advanced tier may provide automatic organisation for users who do not want to manually maintain hundreds or thousands of memories.

The value proposition is not simply "more memory". It is **less maintenance**.

Example future behaviour:

> You have 387 memories and 64 project files. I found several project clusters, related decisions, possible duplicates and stale material. I built a proposed organisation for you to review.

The advanced organiser should do the heavy work while preserving the same human-control philosophy as V1.

The user should be able to review a proper visual sandbox/graph rather than approving tiny isolated text suggestions one by one.

---

## Explicitly not V2 implementation work yet

These ideas are deliberately parked.

Do **not** treat this ledger as a current patch list.

V1 should remain stable while real users are tested. V2 architecture should be informed by actual pain points such as:

- users struggling with 100+ memories
- search becoming insufficient
- project context outgrowing Core Memories
- browser storage becoming a real constraint
- users asking for automatic organisation
- users needing a clearer view of connected apps/bridges/providers
- users wanting project structure, memory and AI work visible in one workspace

Until those problems are observed, keep the V2 design modular and avoid premature implementation.
