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

[~] 01 - Cluster / group memories works live; performance optimization waiting for retest
[x] 02 - Focused memory card polish accepted; moved on
[x] 03 - Nebula / dust-cloud layer live-tested and approved
[x] 04 - Pseudo-3D rotation mode live-tested and approved
[ ] 05 - True 3D graph mode later

## Step 04 confirmed checkpoint

- User live-tested Ctrl-drag pseudo-3D and confirmed the effect is good and rotates smoothly.
- Escape stops/resets the pseudo-3D mode correctly.
- Safety checkpoint branch before Step 04: `backup/pre-pseudo3d-rotation-2026-08-27`
- Isolated rotation module: `96436434a98b59f557f16f83ec5aac0b6b8d7a88`
- Graph runtime integration: `ddc29586193d7cd2a63cfd5fd5470505028ca65e`
- Loader/cache update: `f0ed34f7df332066bf26f96eea067f79f0c0726e`
- Desktop-only activation: Ctrl + left-drag.
- Horizontal drag rotates the bubble around its vertical axis; vertical drag adds pitch.
- Escape resets the view back to the exact normal 2D graph.
- While pseudo-3D is active, memory nodes remain clickable; normal node repositioning is intentionally disabled until Escape resets 3D mode so visual projection cannot accidentally corrupt node layout.
- Rotation is transient presentation state and is not written into `memory-space-v1` or the durable graph layout store.
- Mobile activation is disabled by the rotation module; the current mobile graph treatment remains separate.

## Step 03 confirmed checkpoint

- User live-tested the nebula pass and approved it as good to move on.
- The visible effect is deliberately faint: a few subtle nebula-style blobs behind the graph rather than a heavy animated wallpaper.
- Safety checkpoint branch before Step 03: `backup/pre-nebula-2026-08-27`
- Isolated nebula runtime: `581709c61d55a88bb24d7a506073dd51032508e9`
- Loader update: `2fbb37ca3a8d51a4d10a2ba433990335f5651369`
- Desktop-only first pass so the approved mobile graph remains untouched.
- Five cached gas-cloud sprites sit behind the lightning and memory nodes.
- Blue and lime-green cloud families follow the existing Memory Space visual language.
- Clouds drift subtly at rest.
- During Ctrl-drag rotation they move with yaw/pitch, expand and fade to simulate dissipation.
- When rotation stops they settle and regain density at their new projected positions, creating a reforming-nebula effect.
- A lightweight dust field moves with the same rotation state.
- No CSS filters or per-frame blur are used; cloud textures are generated once and reused as cached canvases.
- Nebula state is presentation-only and does not write to memory or graph layout storage.

## Step 02 confirmed checkpoint

- Safety checkpoint branch before Step 02: `backup/pre-focus-card-2026-08-27`
- Isolated focused-card stylesheet: `76cc4fa9f44455c7e7a6ca2f3a1846c16cdf49c3`
- Focus stylesheet loader through existing graph CSS: `abd3ef6e2771431d99fa45e8121f32a247e7e510`
- Existing inspector logic is unchanged; this is visual-only.
- Opening a memory gives the real inspector a glass/shiny-card treatment with blue/lime depth lighting, a one-shot sheen, and a small active-memory glow marker.
- Inspector detail blocks become inset glass compartments while retaining all existing controls and text.
- The corresponding Shared Memory card gets a stronger lifted selected state.
- Mobile receives the same visual language but no graph/layout changes.
- No memory data, Memory Bridge, provider, permission, or lifecycle code is touched.
- User moved on to the next roadmap item after this pass.

## Step 01 current patch

- Safety checkpoint branch before Step 01: `backup/pre-memory-grouping-2026-08-27`
- Optional grouping runtime: `58b363110382b8766a7246608bd3478bbc424196`
- Loader update: `670bcf745eea46b12b7b0742d7eec3309839aa32`
- Group state is stored separately in `memory-graph-groups-v1`; durable memories in `memory-space-v1` are never rewritten.
- Default mode is Off, so the approved normal graph remains the baseline.
- User controls: Off / Type / Project plus Compact all.
- Type mode uses the real memory type metadata already stored on each memory.
- Project mode uses real job/project metadata where present and places memories without a project into General.
- Group chips show the real confirmed-memory count for each group and can compact/expand one group at a time.
- Compact groups pull their nodes into a tight visual cluster and reduce repeated labels to a single group/count label; search matches remain readable.
- Grouping is applied through the existing projection layer, so graph edges, hit testing, search focus, lightning and optional Ctrl-drag pseudo-3D follow the grouped positions without changing the underlying memory records.
- While grouping is active, normal node repositioning is treated as inspect/pan rather than rewriting individual graph positions.
- The pre-group normal graph layout is snapshotted into the separate grouping state when grouping is enabled and restored when grouping is switched Off.
- Grouping controls work on desktop and mobile but the mode starts Off on every untouched Space.
- User live-tested grouping and confirmed it works, but reported the grouped view was a little laggy.

## Step 01 performance pass

- Safety checkpoint before optimization: `backup/pre-grouping-performance-2026-08-27`
- Isolated performance cache: `1f1bfb9dac3b1043543c4948174720fd9c3b4bd4`
- Loader update: `81286dbeb25c397b279dda5f9698b351af84f0c4`
- Workspace memory lookup is cached instead of reparsing `memory-space-v1` for every node projection.
- Group mode and compact state are cached instead of reparsing `memory-graph-groups-v1` for every node projection.
- Group membership and projected node positions are built once per graph/mode/state revision and reused by edges, sorting, hit testing and drawing.
- Ctrl-drag rotation keeps a lightweight in-memory yaw/pitch snapshot, so grouped nodes can rotate without rebuilding group geometry on every projection call.
- Cache invalidation is tied to memory/space UI mutations, grouping controls, storage events and rotation state changes.
- This pass does not change grouping visuals, controls, memory truth, durable graph layout, Bridge, provider, permission, or lifecycle behavior.
- Waiting for live smoothness retest before marking Step 01 complete.
