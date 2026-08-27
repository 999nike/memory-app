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
