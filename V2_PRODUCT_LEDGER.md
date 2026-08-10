# Memory Space V2 Product Ledger

**Updated:** 10 Aug 2026

This is the working V2 architecture / handoff ledger for the Memory Space product family.

The V1 Memory App is now the proven trusted foundation. V2 grows **around it through separate applications**. It is not permission to reopen, move, split apart or rebuild the existing Memory App.

---

## AUTHORITATIVE V2 RULE — MEMORY APP IS FROZEN

```text
MEMORY SPACE
999nike/memory-app
MAIN TRUSTED APP / FOUNDATION / AUTHORITY
FROZEN — DO NOT REBUILD
```

The existing Memory App remains the trusted main application.

It already owns working product infrastructure including:

- Core Memory
- AI Access
- Permissions / human approval boundary
- Memory lifecycle / provenance
- customer / Space authority
- existing Memory Bridge integration
- bridge onboarding / customer access path
- external AI authorisation
- proposal -> human review -> confirmed memory loop
- existing provider / bridge connection machinery

**Do not move any of this out into another repository.**

**Do not refactor the existing app merely to make the new apps cleaner.**

**Do not rebuild working bridge, OAuth, provider, permission or memory systems in V2 apps.**

New applications must connect to the trusted foundation through explicit interfaces / permissions and leave the proven core alone.

If a future app requires a change to `999nike/memory-app`, that change is not automatically authorised by this ledger. It must be treated separately and explicitly approved.

---

## LOCKED REPOSITORY / PRODUCT STRUCTURE

```text
MEMORY SPACE
999nike/memory-app
main trusted app — FROZEN
│
├── Core Memory
├── AI Access
├── Permissions
├── existing Bridges / bridge integration
│
└── Apps
     │
     ├── Workspace
     │    999nike/wizz-workspace
     │    Cline-style project workspace
     │
     ├── Graph
     │    999nike/memory-graph
     │    visual memory / project graph
     │
     └── Connector
          999nike/memory-connector
          connections / providers / bridge status surface
```

### No Code Space

There is **no separate Code Space product in the current architecture**.

Coding/project capability belongs in the Workspace direction where appropriate. Do not create another repository or product called Code Space unless the architecture is explicitly changed later.

---

## WHAT “APPS” MEANS

The new repos are bolt-on applications that can eventually be installed / launched from Memory Space.

Conceptual user flow:

```text
Memory Space
    |
    | Apps
    v
Choose / install app
    |
    v
App requests permissions
    |
    | Example:
    | ✓ read selected Spaces
    | ✓ propose memories
    | ✓ access project metadata
    v
User approves
    |
    v
App connected
```

The exact packaging can evolve later. During development the apps can remain completely separate repositories and deployments.

That is preferred over prematurely bundling everything together.

The main app eventually has a reason to remain the **main app**: it is the trusted authority that owns memory and grants scoped access to the other applications.

---

# APP 1 — WIZZ WORKSPACE

Repository:

```text
999nike/wizz-workspace
```

## Purpose

A visual, Cline-style project workspace built as a separate application on top of Memory Space authority.

The goal is a human-friendly working environment where project structure is visible instead of everything being buried inside one chat or settings screen.

Possible workspace regions:

```text
+----------------------+----------------------+
| Project structure    | Active AI / chat     |
| folders / project    | worker conversation  |
| view                 |                      |
+----------------------+----------------------+
| Project memory       | Outputs / activity   |
| goals / decisions    | tasks / artifacts    |
+----------------------+----------------------+
```

The design inspiration is the useful human feel of tools such as Cline: multiple visible boxes/panes showing different parts of a project at the same time.

It is not intended to copy Cline literally.

## Workspace responsibilities

Workspace may eventually handle things such as:

- project overview
- project metadata
- visible project structure
- selected Memory Space context
- AI conversation / workers
- tasks / current work
- project files or artifact views where later authorised
- proposed project-state memories

Workspace does **not** become the source of long-term trusted memory.

Memory Space remains the authority.

## Workspace permission principle

Workspace asks for only what it needs.

Possible grant:

```text
Workspace
    ✓ read selected Space
    ✓ read confirmed project memories
    ✓ propose new memories
    ✓ access permitted project metadata
    ✗ approve its own memory proposals
    ✗ access unrelated Spaces
```

Artifact/file/write/execution permissions, if added later, are separate capabilities and must not be silently implied by memory access.

## First Workspace proof

The first useful integration proof should be deliberately small:

```text
Open Workspace
    -> connect / identify Memory Space authority
    -> choose an authorised Space
    -> read that Space's permitted project context
    -> display it inside Workspace
```

Then:

```text
Workspace / AI does useful project work
    -> proposes a project-state memory
    -> proposal returns to Memory Space
    -> human approves / edits / rejects
```

Do not start by moving code out of Memory App or recreating its storage / permission system.

---

# APP 2 — MEMORY GRAPH

Repository:

```text
999nike/memory-graph
```

## Purpose

A dedicated visual map of memories, projects and relationships.

The graph is an **organisational / visual layer**, not the trusted memory database.

Conceptually:

```text
Memory Space confirmed memory
          |
          v
     Memory Graph
          |
     +----+----+
     |         |
  project   decision
     |         |
  memories   related nodes
```

Possible modes:

- graph
- tree
- clusters
- search/highlight
- project relationships
- memory relationships

Selecting a node should ultimately resolve back to the actual authoritative Memory Space item.

## Graph rules

Graph may:

- read authorised confirmed memories
- reference stable IDs
- maintain its own layout / relationship metadata
- suggest relationships / clusters
- visually organise projects and memory

Graph may not:

- silently rewrite core memory
- become a second competing source of truth
- approve durable memory changes for itself
- inherit access to every Space automatically

AI-assisted organisation may later propose:

- related memories
- project clusters
- duplicate candidates
- possibly superseded decisions
- useful graph branches / labels

Human authority remains the final boundary for trusted changes.

---

# APP 3 — MEMORY CONNECTOR

Repository:

```text
999nike/memory-connector
```

## Purpose

A separate visibility / management application for the growing network of connections around Memory Space.

**Important:** Connector does NOT replace the bridge system already built in `memory-app`.

The bridge stays in the main app / existing runtime architecture.

No bridge code is moved out merely because Connector exists.

Connector's job is to provide a clearer surface over connections such as:

- connected providers
- connected external AI clients
- bridge connection status
- provider status
- customer / connection health where authorised
- online / offline indicators
- last known healthy contact / heartbeat where available
- revoke / disconnect visibility where the main authority exposes it
- normal-language diagnostics

Conceptual view:

```text
Memory Connector
│
├── Providers
│    ├── Claude      connected
│    ├── Grok        connected
│    └── ...
│
├── Bridges
│    ├── Bridge A    online
│    └── Bridge B    warning
│
└── Connections
     ├── customer / client status
     └── permission / health summary
```

The operator goal is to make connection problems visible quickly without exposing customer memory content unnecessarily.

## Connector boundary

Connector can display / manage connection state through approved interfaces.

It does not own Memory Space truth and does not gain unrestricted access to customer memories simply because it can observe bridge health.

A connection-health app and a memory-authority app are different trust roles.

---

# SHARED APP CONTRACT

Every bolt-on app follows the same basic model:

```text
Memory Space = authority
App          = scoped client / worker surface
User         = final permission authority
```

An app declares required capabilities.

Possible future capability vocabulary:

```text
memory.read
memory.propose
project.read
project.metadata
files.read
files.write
repo.read
repo.write
execution.run
connection.status
```

These names are conceptual until the actual cross-app protocol is designed.

The architectural rule is already fixed:

**Permission in one layer must not silently imply permission in another.**

Examples:

- reading memory does not mean writing files
- seeing project metadata does not mean reading every private Space
- seeing bridge health does not mean reading customer memory
- proposing memory does not mean approving memory
- repository access does not mean execution access

---

# PACKAGING DIRECTION

Build the new applications separately first.

```text
999nike/memory-app          stable authority
999nike/wizz-workspace      separate app
999nike/memory-graph        separate app
999nike/memory-connector    separate app
```

Later they can be presented to the user as one Memory Space product family:

```text
Memory Space
     |
     +-- Apps
           |
           +-- Workspace   [Open / Install]
           +-- Graph       [Open / Install]
           +-- Connector   [Open / Install]
```

The eventual user experience may feel like one application suite even if the internal products remain separate deployments / repositories.

Do not force bundling before the individual app contracts are proven.

---

# BUILD ORDER

Current working order:

## 1. Workspace

Build `999nike/wizz-workspace` first.

Reason: this establishes the basic external-app pattern and is the clearest proof that Memory Space can act as the stable project brain underneath a richer working application.

First target:

```text
Workspace starts independently
    -> has its own UI/state
    -> can later request authorised Memory Space context
    -> Memory App itself remains unchanged
```

Then establish the smallest safe Memory Space connection contract.

## 2. Graph

Once the app connection pattern is understood, build the visual graph against the same authority model rather than inventing a second integration method.

## 3. Connector

Build the dedicated connections/status application around the existing connection/bridge information without moving or replacing the bridge implementation.

This order can change if practical testing exposes a better dependency order, but **the frozen Memory App rule does not change.**

---

# BANKED V2 IDEAS

These remain valid directions but are not reasons to disturb the foundation:

- secondary / lower-priority memory layers
- larger-memory organisation
- smart graph clustering
- project-linked files / artifacts
- local reasoning / organiser engines
- richer AI worker surfaces
- teams / shared project rooms
- optional advanced organisation services
- future app marketplace / install model

They should become separate capabilities/modules when there is a real product need.

---

# DO NOT DO

Do not:

- rebuild `999nike/memory-app`
- move the bridge out of Memory App
- create a separate Code Space repo/app
- split working V1 systems into new repos for architectural neatness
- duplicate the trusted memory database in Workspace / Graph / Connector
- let an app approve its own lasting memory changes
- give apps blanket access to every Space
- mix memory, file and execution authority into one implicit permission
- turn V2 planning into a reason to keep rewriting V1

---

# CURRENT HANDOFF

Memory App is the finished/proven foundation for this phase.

The next active development repo is:

```text
999nike/wizz-workspace
```

Take this ledger into the Workspace development context as the architectural workplan.

For Workspace development:

1. treat `999nike/memory-app` as frozen external infrastructure
2. build Workspace as its own application
3. do not copy/rebuild the Memory App internals
4. establish the Workspace UX independently first
5. identify the smallest permission/interface needed to read an authorised Space
6. connect through that contract
7. prove read -> useful work -> memory proposal -> human approval without granting Workspace authority over trusted memory
8. record only tested milestones back into this ledger

---

# GUIDING PRINCIPLE

Memory Space is the trusted house.

Workspace, Graph and Connector are applications the user can add to that house.

They get keys to specific rooms and capabilities. They do not inherit ownership of the building.

**Build around the foundation. Do not rebuild the foundation.**
