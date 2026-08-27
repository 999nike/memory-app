# Memory Graph Future Pin

Pinned: 27 Aug 2026

## Direction

Evolve Memory Graph from the current living 2D gravity map into a spatial brain bubble without replacing Memory Space as the source of truth.

The existing memory engine remains the source of truth. Graph position, rotation, nebula, focus effects and manual grouping are presentation state only and must never mutate `memory-space-v1`.

## Corrected visual roadmap

1. **Manual gravity group bubbles**
   - The user creates a larger titled bubble directly inside the Memory Graph with a small `+` control.
   - The user manually drags real memory bubbles onto that larger bubble.
   - Dropped memories become smaller satellite bubbles around the titled group node.
   - Each satellite keeps representing one real memory and still opens the existing Memory inspector.
   - Short electric links connect the titled group node to its satellite memories.
   - The titled group node itself remains connected into the same central brain/gravity visual system.
   - More member connections make the titled group more visually important/larger and pull its orbit inward.
   - Pulling a satellite memory away detaches it from that group; dropping it on another titled bubble moves it to the other group.
   - This is human-controlled organisation. No automatic Type/Project grouping.

2. **Focused memory card polish**
   - Selecting a memory feels like picking up a premium shiny card/object while still using the real inspector.

3. **Nebula / dust-cloud layer**
   - Faint cached gas/nebula clouds sit behind the graph and react subtly to pseudo-3D rotation.

4. **Pseudo-3D rotation mode**
   - Desktop Ctrl + drag orbits the brain bubble; Escape resets to normal 2D.

5. **True 3D graph mode later**
   - Optional only after the current 2D/pseudo-3D system remains solid.

## Tick system

[~] 01 - Manual gravity group bubbles patched; waiting for live drag/drop test
[x] 02 - Focused memory card polish accepted
[x] 03 - Nebula / dust-cloud layer live-tested and approved
[x] 04 - Pseudo-3D rotation live-tested and approved
[ ] 05 - True 3D graph mode later

## Manual grouping correction — 27 Aug 2026

The first Step 01 implementation was wrong for the requested interaction. It automatically grouped memories by Type/Project. That runtime has now been retired from `index.html` and is no longer loaded.

The old files may remain in Git history/repo for rollback/reference, but these are inactive:
- `memory-graph-groups.js`
- `memory-graph-groups-performance.js`

Correct manual implementation:
- Safety checkpoint: `backup/pre-manual-gravity-groups-2026-08-27`
- Manual gravity group runtime: `3fc55ab99fc8a4f0a501de617f875329351a115b`
- Loader swap / automatic grouping retirement: `238fe8fe64c02cd058f3ebe6d5e636a0168b80d2`
- Manual grouping state key: `memory-graph-folders-v1`
- The `+` button creates a titled large group bubble.
- Memory membership is only stored as visual member IDs in `memory-graph-folders-v1`.
- `memory-space-v1` is never rewritten by grouping.
- Grouped memories render as smaller satellites with short electric links.
- The original Space-to-memory electric spoke is suppressed for grouped satellites and replaced visually by Space -> group -> satellite links.
- Search matches can still expose the real satellite memory label.
- Normal real-memory click/inspector behavior remains the existing path.
- Ctrl-drag pseudo-3D is still delegated to the confirmed rotation system.

## Confirmed checkpoints

### Step 04 — pseudo-3D
- Backup: `backup/pre-pseudo3d-rotation-2026-08-27`
- Rotation module: `96436434a98b59f557f16f83ec5aac0b6b8d7a88`
- Graph integration: `ddc29586193d7cd2a63cfd5fd5470505028ca65e`
- Loader: `f0ed34f7df332066bf26f96eea067f79f0c0726e`
- User confirmed smooth rotation and Escape reset.

### Step 03 — nebula
- Backup: `backup/pre-nebula-2026-08-27`
- Runtime: `581709c61d55a88bb24d7a506073dd51032508e9`
- Loader: `2fbb37ca3a8d51a4d10a2ba433990335f5651369`
- User approved the deliberately faint nebula treatment.

### Step 02 — focus card
- Backup: `backup/pre-focus-card-2026-08-27`
- Focus styling: `76cc4fa9f44455c7e7a6ca2f3a1846c16cdf49c3`
- Loader: `abd3ef6e2771431d99fa45e8121f32a247e7e510`
- Existing inspector logic remains unchanged.

## Hard boundaries

Do not redesign Memory Bridge, OAuth/MCP/provider behavior, external-AI proposal rules, trusted-memory approval boundaries, or the current memory lifecycle/engine as part of this visual feature.
