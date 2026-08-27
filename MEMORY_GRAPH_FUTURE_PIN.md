# Memory Graph Future Pin

Pinned: 27 Aug 2026

## Direction

Evolve Memory Graph from the current living 2D gravity map into a spatial "brain bubble" without replacing Memory Space as the source of truth.

The existing graph remains the safe base. Future visual modes must remain optional and must never alter durable memory records.

## Pinned visual roadmap

1. **Cluster / group memories**
   - Optional grouping by project, type, tag, person, job, repo, or other real metadata.
   - Collapsible/expandable clusters so the user can clean up dense graphs without deleting memories.
   - Grouping is a visual/file-state aid, not a rewrite of memory truth.

2. **Focused memory card polish**
   - Selecting a memory should feel like picking up a premium shiny card/object.
   - Stronger spotlight, halo and depth treatment while still opening the real existing Memory inspector.

3. **Nebula / dust-cloud layer**
   - Soft gas/nebula clouds behind clusters.
   - Clouds should dissipate and reform as the graph changes position rather than behaving like a static wallpaper.
   - Keep this subtle and cached/performance-aware.

4. **Pseudo-3D rotation mode**
   - Desktop control target: hold Ctrl + drag to orbit/rotate the whole graph brain bubble.
   - Horizontal drag should allow a full 360-degree orbit; vertical drag adds pitch.
   - Existing normal drag/pan/zoom must remain available outside rotation mode.
   - This should be implemented before any true WebGL/Three.js rewrite.

5. **True 3D graph mode later**
   - Optional separate mode only after the 2D/pseudo-3D system is solid.
   - Possible WebGL/Three.js implementation if the scale and interaction justify it.

## Hard safety rule

The visual brain bubble, node positions, rotation, clouds, grouping and focus effects are presentation state only. They must never mutate `memory-space-v1` memory truth.

## Tick system

[ ] 01 - Cluster / group memories
[ ] 02 - Focused memory card polish
[ ] 03 - Nebula / dust-cloud layer
[~] 04 - Pseudo-3D rotation mode patched; waiting for live desktop test
[ ] 05 - True 3D graph mode later

## Step 04 current patch

- Safety checkpoint branch: `backup/pre-pseudo3d-rotation-2026-08-27`
- Isolated rotation module: `96436434a98b59f557f16f83ec5aac0b6b8d7a88`
- Graph runtime integration: `ddc29586193d7cd2a63cfd5fd5470505028ca65e`
- Loader/cache update: `f0ed34f7df332066bf26f96eea067f79f0c0726e`
- Desktop-only activation: Ctrl + left-drag.
- Horizontal drag rotates the bubble around its vertical axis; vertical drag adds pitch.
- Escape resets the view back to the exact normal 2D graph.
- While pseudo-3D is active, memory nodes remain clickable; normal node repositioning is intentionally disabled until Escape resets 3D mode so visual projection cannot accidentally corrupt node layout.
- Rotation is transient presentation state and is not written into `memory-space-v1` or the durable graph layout store.
- Mobile activation is disabled by the rotation module; the current mobile graph treatment remains separate.
