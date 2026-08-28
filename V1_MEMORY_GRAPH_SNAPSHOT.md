# V1 Memory Graph Snapshot

Banked: 28 Aug 2026

## Approved foundation

The current Memory Graph keeps the working Memory Space data model and interaction model while using the shared branching neural scaffold for presentation.

Working behavior preserved:
- central Memory App node
- green memory bubbles
- green manual folder/group bubbles
- gravity / repulsion / settling
- pan / zoom / drag
- search focus and inspector routing
- create folder control
- drag a memory into a folder
- drag / return a memory back to the main graph
- separate graph layout and folder storage

## Neural visual stack

- `memory-graph-neural-scaffold.js` owns the shared branching visual routing.
- `memory-graph-neural-width.js` owns visual width tuning plus low-cost mobile/interaction raster reductions.
- `memory-graph-neural-flow.js` owns the large smooth bidirectional energy pulses and joint hand-off glow.
- The earlier multi-overlay experiments remain in repository history but are not loaded by the current graph.

## Folder UX polish

- `memory-graph-group-ux.js` adds a Rename group action to the existing folder inspector.
- Removing a memory from a folder is labelled as returning it to the main graph rather than deleting it.
- Empty folders explicitly tell the user to drag a memory bubble onto the folder.
- Deleting a group remains safe: memories return to the main graph and are not deleted.

## Performance pass

The scaffold keeps its existing interaction detail reduction. The width/tuning hook now additionally:
- drops the broadest glow pass during interaction
- removes selected decorative companion/fork/root strokes on narrow/mobile canvases
- slightly reduces heavy stroke gains on narrow/mobile canvases
- keeps desktop branch tissue slightly richer without changing routing

## Hard boundaries retained

No changes in this V1 graph polish pass to:
- `memory-space-v1` durable memory schema
- graph physics or semantic relationships
- Memory Bridge
- OAuth / MCP
- provider connections
- proposal / approval rules

## Recovery points

- Working pre-polish state: `backup/neural-graph-working-2026-08-28`
- Pre-V1-polish state: `backup/pre-v1-graph-polish-2026-08-28`
- Clean pre-neural baseline remains in history at `5a4a216a86eccc3ceeded57c34eaf18115de7dd1`.

This file describes the V1 graph state to preserve. Future graph work should be incremental and must not replace the shared branching scaffold without an explicit redesign decision.
