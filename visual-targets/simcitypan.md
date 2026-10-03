# Universal Space — miniature city visual plan

Date: 2 October 2026

> [!IMPORTANT]
> # CURRENT CHECKPOINT — RESUME HERE
> **Last updated:** 3 October 2026, after all three original Meshy shells and industrial-floor integration  
> **Preview:** `http://127.0.0.1:4173/?view=world`  
> **Working folder:** `E:\WIZZ-Server\new-version\universal-space`  
> **User override:** work directly in this folder using its current uncommitted files. Do **not** run Git commands, switch branches, commit, push, copy patches, or touch `universal-space-world`. Do **not** launch another backend or collide with ports `4173`/`8790`.

## Visual progress map

```text
PRESERVE + INSPECT      PROCEDURAL CITY       APP ACCESS          REAL ACTIVITY       MESHY SHELLS        FINAL POLISH
      ✅  ────────────────  🟡  ─────────────────  🟡  ─────────────────  🟠  ─────────────────  🟡  ────────────────  ⬜
     DONE              VISUAL REVIEW         IMPLEMENTED         WIRED, UNPROVEN      REVIEW CODE LAB      LATER
```

| Gate | State | Evidence / remaining work |
| --- | --- | --- |
| **A. Preserve and inspect** | ✅ Done | User confirmed their own backup. Direct-work override is active. Original services were not restarted. The abandoned sibling worktree must be left alone. |
| **B. One visual slice** | 🟡 Visual review | `world-view.js`/`.css` now render Office HQ, open Code Space Lab with walk/sit/type worker, Memory archive, plaza, machinery, lamps, stairs and walkways with an orthographic camera. Screenshot `234120` proved the denser layout; its overexposure was corrected in cache version `simcity-world-v1-6`, which still needs the next human screenshot check. |
| **C. Existing app entry points** | 🟡 Implemented; recheck | Selectable HTML building panels route back through existing Memory controls and `UniversalAppAdapters`. `World | Neural | Classic` is preserved. The switcher was moved into the Neural and Classic headers after screenshots showed overlap; confirm its final placement once more. |
| **D. One real job** | 🟠 Wiring ready; do not claim proof | Code worker presentation listens to the existing `code-space-memory-dispatch-*` events and supports waiting, walking, working, complete, failed and unknown states. No job was launched and no end-to-end real-job proof exists. Demo labels remain until an event is actually observed. |
| **E. Detailed assets** | 🟡 Three original-quality shells; visual review | Cache version `simcity-world-v1-13` sequentially loads untouched Office (56.46 MB / 1,557,964 triangles), Code Space (82.23 MB / 2,369,782 triangles at 140% scene scale) and Memory (83.14 MB / 2,355,052 triangles); each retains all three original 2K textures. The island floor is rebuilt as a larger layered steel deck with modular plates, foundations and restrained service lighting. Local validation and all procedural fallbacks remain wired; activity pieces, signs, workers and selection anchors remain independent. Optimize only after observed need. |
| **F. Integration and polish** | ⬜ Later | Real Memory activity, measured HP/S24 performance, reconnect/stale-state proof, one harmless authorised real-job observation, and final cross-view regression remain. |

### Implemented World controls

- Drag horizontally or vertically for a free two-axis orbit from near-ground to near-top-down. Shift/right-drag and arrow panning are unrestricted; `R` or `RESET VIEW` safely returns home.
- Wheel, visible `ZOOM −` / `ZOOM +` buttons and keyboard `+`/`-` share a broad 0.08×–10× range. The normal island framing remains the reset position; there is no separate wide-view mode.
- Low/medium/high quality presets adjust pixel ratio, shadows and local UnrealBloom processing.
- Building selection uses a pulsing colour ring and accessible HTML panels.
- Inactive World rendering pauses when another view or browser tab is active.
- Office and Memory activity are still labelled demo. Code Space changes to `LIVE + DEMO` only after an existing dispatch event is observed.

### Exact next implementation step

1. Hard-refresh `http://127.0.0.1:4173/?view=world`; allow all three originals to finish sequential loading, test orbit/pan/zoom, then capture the first `simcity-world-v1-13` screenshot.
2. Check all three shell scales, front orientations, ground contact, the new floor, lighting and whether separate activity pieces remain visible.
3. Tune only manifest transforms or local activity-piece placement if required; keep the procedural fallbacks and independent interactive pieces.
4. Recheck all building selections plus `World | Neural | Classic` switching. Browser automation was unavailable during integration, so no visual or console-clean proof is claimed yet.
5. Accept the three-building/floor composition before any performance reduction or final activity-piece placement.

### Current implementation files

- `index.html` — loads the World stylesheet/script with cache key `simcity-world-v1-13`.
- `world-view.js` — Three.js scene, sequential validated Office/Code Space/Memory Meshy shells and fallbacks, rebuilt industrial island, free camera controls, worker state, lifecycle, bloom, quality and existing-event adapter.
- `world-glbs/Meshy_AI_Neon_Helipad_Tower_1003004722_texture.glb` — untouched original-quality Office shell.
- `world-glbs/Meshy_AI_Neon_Nexus_Station_1003000450_texture.glb` — untouched original-quality Code Space source currently loaded for visual review.
- `world-glbs/Meshy_AI_Memory_Vault_City_1003010357_texture.glb` — untouched original-quality Memory shell.
- `assets/world/models/code-space-lab.glb` — rejected optimized derivative retained temporarily and not loaded by the scene.
- `world-view.css` — World UI, building inspector, activity panel and embedded cross-view switcher.
- `UNIVERSAL_SPACE_LEDGER.md` — verified implementation/check history.

Requested filename: `simcitypan.md`

Intended Windows destination: `E:\WIZZ-Server\new-version\universal-space\simcitypan.md`

Scope: this began as planning and is now the active implementation record. Preserve the existing Universal Space and its working Memory, Office and Code Space apps while developing the miniature city view.

## 1. Decision

Build a browser-based Three.js scene with an orthographic camera and three principal buildings. Use a hybrid asset workflow: procedural streets, lighting, signs, furniture and simple workers; image-guided Meshy building shells when the visual prototype works. Tripo is an optional alternative for a comparison test, not a required dependency.

The target is the cyberpunk miniature city in the supplied Tripo advertisement: dark industrial surfaces, chunky modular architecture, stairs, rooftop machinery, neon cyan/magenta signs, warm windows and small people. Use the other creator's tiny-city concept as an interaction reference. His exact implementation and agent capabilities have not been verified.

This is a new visual front-end for the user's three existing apps. It does not require building a new agent platform or city simulation.

## 2. Preserve the original before implementation

- Original source: `E:\WIZZ-Server\new-version\universal-space`.
- Inspect the actual checkout, branch, HEAD, working tree and project instructions locally before changing code. The supplied notes are historical evidence, not a fresh repository inspection.
- Make a dated backup of the working project, including uncommitted changes and required local configuration. Protect local credentials and runtime data; keep them out of Git. Do not copy live databases inconsistently: use their supported backup/export method if present.
- Record the original branch and HEAD; retain the existing approved neural work and original launcher.
- Use an isolated development worktree when possible, for example `E:\WIZZ-Server\new-version\universal-space-world`, on `design/simcity-world-v1`. If a worktree cannot capture required uncommitted work, resolve that explicitly rather than assuming HEAD is the complete working version.
- Do not merge into `main`, `molecular-v2`, or the approved neural fallback as part of the prototype.
- Keep `World | Neural | Classic` navigation. World becomes the default only after the working flows and visuals are verified.

Important: a backup folder and development worktree are different things. A worktree is not a full backup of local state.

## 3. Start a visual preview without duplicating services

The supplied 14 September service report says Universal's `server.mjs` owns both `4173` and the embedded Supervisor on `8790`. Changing only the web port would therefore still risk a collision.

First preview: serve the new scene with static assets and clearly labelled demo data on a locally checked unused port. Do not invoke a second Universal startup, `ensureSupervisor()`, Office launcher or Worker App supervisor for this preview.

For live integration, inspect the server and choose a supported method:

1. Add the World route to the development version of the existing Universal server, using its existing integration layer; or
2. Use an explicitly configured development server with Supervisor startup disabled and the existing backend addressed through a verified proxy.

Do not invent configuration flags that the project does not have. Add and verify any needed development mode before relying on it. Keep the original service available; do not stop the shared Worker App group merely to test the renderer.

## 4. The first district

Build one small city block around a central plaza. Three main buildings are enough. Additional AI Core, server and asset-studio buildings can come later when they have useful controls and observable activity.

| Building | Visual design | Real purpose | Visible activity |
| --- | --- | --- | --- |
| Office HQ | Compact 4–6-storey skyscraper, magenta/cyan sign, warm windows, rooftop antenna, visible ground-floor desk | Jobs, workers, queues, dispatch and Memory Jobs | Worker at dispatch console, queue indicator, assigned-job handoff |
| Code Space Lab | Lower industrial building, cyan trim, roof vents, open front/cutaway computer room | Projects, files, Codex, terminal and Git | Little worker visibly sits at a computer during an observed execution; terminal changes state |
| Memory Space | Green-accent archive/lab, blue energy centre, rooftop node motif | Memories, groups, search, new memory and Bridge activity | Observed retrieval/storage lights an archive bank; selecting the neural view opens the existing graph |

Place taller Office HQ behind the plaza so it does not hide the Code Lab workstation. Use a cutaway wall or open bay for visible workers instead of attempting a complete interior behind opaque walls.

Shared street language: short walkways, kerbs, service doors, cables, small lamps, restrained haze, rooftop pipes and planters. Keep signs readable at the default camera scale. Add signs in code rather than depending on generated text in textures.

Lighting provides much of the reference's appearance. A building with neon painted onto a flat texture will not automatically cast convincing light or bloom.

## 5. Building selection and existing app access

A single click selects a building and opens a normal HTML panel. The panel shows status, current activity and the app's existing actions. A dedicated button opens the full original app. Focus/zoom is optional; never require a long camera animation to reach a control.

| App | First-level controls retained from the supplied notes |
| --- | --- |
| Memory | Memories, New Memory, Groups, Search, Settings, Open Memory App |
| Office | Memory Jobs prominently first, Dashboard, Jobs, New Job, Workers, Dispatch, Projects, Important, Settings, Open Office |
| Code Space | Jobs, Projects, Files, Codex, Terminal, Git, Settings, Open Code Space |

Prefer existing Universal adapters and panels where they work. Do not assume arbitrary cross-origin apps can be embedded: verify iframe policy, origin rules, authentication and routing. If embedding is unsupported, open the existing app normally.

For a phone/DeX accessing the HP, browser `127.0.0.1` points to the phone, not the HP. Keep backend loopback addresses server-side and use the existing authenticated Universal access route or a verified proxy. Do not expose local services just to make a city panel work.

## 6. Meshy, Tripo or buildings made in code?

| Route | Useful for this project | Limitation | Recommendation |
| --- | --- | --- | --- |
| Procedural Three.js/Blender models | Predictable building dimensions, desks, cutaways, separate parts, quick iteration and small assets | Detailed industrial art takes deliberate modelling work | Use for the initial city and every interactive element |
| Meshy image-to-3D | Turning individually designed building references into detailed shells; user already has experience with it | Generated geometry/materials require inspection and may need cleanup | First choice for the final three building shells |
| Tripo image-to-3D | Alternative building generation and polygon reduction | Advertisement is not proof of consistent results, free access or production readiness | Compare one identical building input only if Meshy disappoints |
| Generated 2D art | Establishing a coherent design and preparing individual building references | A concept image is not a rotatable 3D model | Useful before image-to-3D, or for a deliberately fixed-angle 2.5D version |

Meshy documents image-to-3D, remeshing and GLB export. Tripo documents image-to-model and retopology with GLB output. No quality ranking between the two has been established for these specific buildings. Recommend Meshy for familiarity and workflow continuity, not because an advert proves one generator is better.

I can create similar concept art and author a procedural browser scene, including the buildings and worker animation. Detailed generated building meshes require a 3D generation service or a modelling workflow; image generation alone does not supply usable GLBs.

Do not commit to a paid plan or automated generation API before testing one building with the user's existing access.

## 7. Asset production workflow

1. Establish one style sheet: proportions, shared charcoal materials, warm windows, cyan/magenta neon, green Memory accent, roof detail and common street scale.
2. Produce one isolated reference per building. Show the entire building on a plain background with a readable silhouette and consistent three-quarter angle. Avoid streets, UI overlays, labels and workers in generation inputs.
3. Test Code Space Lab first because it must support a visible desk. Keep its generated exterior independent of a procedural open computer bay.
4. Generate/remesh/export a textured GLB using the currently supported tool settings. Inspect all sides, underside, material count and triangle count before accepting it.
5. Normalise scale, orientation and ground pivot. Remove unwanted scenery and hidden geometry. Simplify textures and material splits. Use Blender where necessary.
6. Attach independently controlled signs, doors, status lights, desk, chair, monitor and worker. A single fused generated mesh must not prevent job-state animation.
7. Load assets locally from the project. Match compression to the configured loader; retain a simple placeholder when an asset fails.
8. Repeat for Office and Memory only after the first building looks good inside the actual scene.

Initial budgets, to be measured and adjusted: roughly 5,000–20,000 triangles per principal building, around 1,000–3,000 for a simple worker, 1K textures first and 2K only when visually justified. These are planning targets, not generator guarantees or proof of performance.

Reusable art prompt direction:

> Isolated stylised miniature cyberpunk building for a browser city, chunky modular industrial architecture, charcoal concrete and dark metal, rooftop vents and pipes, warm amber windows, restrained cyan and magenta neon fittings, clear entrance, complete visible silhouette, consistent three-quarter view, plain neutral background, no text, no UI, no people, no surrounding city. Preserve simple readable forms suitable for a lightweight game asset.

Building variants: Office = compact skyscraper; Code Space = two-storey tech workshop with a separate open computer bay; Memory = archive lab with green fittings and a blue core feature. Treat these as original WIZZ assets inspired by the reference style.

## 8. Worker behaviour: visual movement versus real execution

Backend job state remains authoritative. Animation never starts a job by itself and never delays job completion until a character finishes walking.

Worker presentation states: `IDLE`, `WALKING`, `WORKING`, `WAITING`, `COMPLETE`, `ERROR`, and `UNKNOWN` when telemetry is stale. These describe presentation; the backend's actual state must also remain visible.

Example: Office assigns a coding job. Its worker walks along a predefined route toward Code Lab, sits at a terminal, animates typing while execution is observed, and shows the result when the backend reports completion. If the job finishes before the walk, shorten/skip the travel and immediately show the real result. A desk worker in Office represents dispatch/Office work; it must not imply Office itself ran Codex when Code Space executed it.

Map workers to stable real IDs where available. If one avatar represents several jobs or a logical execution slot, label that grouping clearly. Do not invent a person or extra agent for every visual animation.

- Use a waypoint graph and scripted walk/sit/type loops initially; no physics engine or general navigation system.
- Idle fidgets are decorative. They must not look like active coding when no job is running.
- Only animate a Memory visit when a retrieval/storage event is actually observable. Otherwise show job activity without inventing its internal steps.
- Model health/calls can later drive an Orb in the plaza. A healthy model process does not imply it is currently thinking.
- During disconnected/stale telemetry, display unknown/offline status and stop presenting typing as confirmed live work.

## 9. Live data plan

Inspect the actual Office, Code Space, Memory and Universal endpoints before implementation. The supplied notes confirm concepts and historical service locations, not a ready-made event stream.

Start with a current state snapshot. If suitable status endpoints already exist, use bounded polling for the first live slice. For push updates, prefer SSE for server-to-browser events and existing authenticated HTTP routes for actions. Use WebSocket only if an existing implementation or genuine bidirectional requirement makes it useful.

Proposed normalised event fields:

```json
{
  "id": "unique-event-id",
  "sequence": 123,
  "timestamp": "ISO-8601 timestamp",
  "source": "office|code-space|memory",
  "type": "job.started",
  "workerId": "stable-worker-id",
  "jobId": "stable-job-id",
  "status": "running",
  "summary": "Short safe description"
}
```

These are proposed fields, not claims about existing schemas. Useful event types include `job.assigned`, `job.started`, `job.waiting`, `job.completed`, `job.failed`, `worker.status`, `memory.retrieved`, `memory.stored`, and `service.status`. Support each only where the source can emit or reliably derive it. Do not manufacture `agent.thinking`, file changes or memory accesses from a running-job flag.

Reconnect using a fresh snapshot plus an ordered cursor/replay when available. Deduplicate events, reject stale job updates and expose last-updated time. Subscribe without a snapshot/event race so jobs cannot disappear between the two. Keep private prompts, memory contents, credentials and terminal output out of public status summaries.

Existing actions retain their authentication and confirmation behaviour. The city status feed does not grant extra execution authority.

## 10. Renderer structure

Adapt paths to the actual repository after inspection. Suggested separation:

| Module | Responsibility |
| --- | --- |
| World view | Canvas lifecycle and HTML controls |
| Scene | Camera, lights, ground and shared renderer |
| Buildings | Layout, asset loading, selection and attachment points |
| Agents | Waypoints, visual state and animation |
| World state | Reducer driven by authoritative snapshots/events |
| Activity adapter | Existing app integrations and normalised updates |
| Asset manifest | Model locations, scale, pivot and interaction anchors |

Use locally bundled/versioned Three.js and loaders; avoid a runtime CDN dependency. Use one active WebGL renderer where practical. If World and Neural must use separate renderers, mount only the active view and dispose/pause the inactive one.

## 11. Performance and usability

- Orthographic camera with pan, bounded zoom, reset and optional limited orbit. Start at a readable three-quarter angle.
- Pause rendering in hidden tabs; cap device pixel ratio and provide low/medium/high quality settings.
- Use emissive materials plus restrained bloom. Limit dynamic lights and shadow casters; offer reduced effects on the HP and S24/DeX.
- Reuse meshes/materials and instance repeated windows, lamps and street props where useful.
- Dispose geometries, textures, animation mixers and event subscriptions when switching views.
- Keep controls and selected-job details in accessible HTML with keyboard navigation. Provide reduced motion and a usable Classic fallback if WebGL fails.
- Measure on the actual HP/browser and S24/DeX. Aim for stable 30 fps on the low preset and 60 fps where feasible; do not promise results before profiling.

## 12. Delivery gates

### A. Preserve and inspect

Record actual source state, backup, service ownership and integration paths. Acceptance: original launches as before, development work is isolated, and preview cannot collide on `4173`/`8790`.

### B. One visual slice

Create the plaza, all three procedural silhouettes, camera, lighting and one Code Lab computer/worker. Use an explicitly labelled demo sequence. Acceptance: style is recognisable at the default view, the worker remains visible and the scene is usable on the target screen.

### C. Existing app entry points

Building selection opens real existing panels or supported app links. Acceptance: all three apps can be reached, Office Memory Jobs stays prominent, and Neural/Classic remain available.

### D. One real job

Connect one existing user-authorised Office-to-Code Space flow. Acceptance: a real assignment, execution and result are reflected, failures/waiting/offline are honest, and refresh/reconnect restores state. Observe an existing job or use an isolated harmless test workspace when an execution check is needed.

### E. Detailed assets

Generate and clean one Code Lab shell, verify it in the scene, then add Office and Memory. Acceptance: visual quality improves without losing independent controls or target-device performance.

### F. Integration and polish

Add observable Memory activity, job selection, quality presets and finishing details. Acceptance: original app flows, authenticated actions, reconnect behaviour, fallback and view-switch lifecycle remain working.

Allow a short prototype effort for B once repository setup is known. Do not treat the earlier 'day one plus a couple of days' discussion as a delivery commitment. Live telemetry gaps, asset cleanup and integration ownership determine the schedule. Estimate each gate after A.

## 13. Checks before calling the prototype ready

- World/Neural/Classic switching does not lose app state or leak active render loops/subscriptions.
- Selecting each building reaches the correct real app/functions.
- A running coding job lights the actual corresponding workstation; completion and failure match the backend even during travel.
- Concurrent jobs remain distinguishable; an idle worker is not shown as executing work.
- Restart/reconnect/reordered events cannot leave a permanently typing worker or replace a completed job with stale running state.
- Service disconnection shows stale/unknown rather than false success or a fabricated job failure.
- Desktop and S24/DeX can pan, zoom and use HTML controls; missing assets/WebGL have a fallback.
- The original checkout, launchers, service ports and approved neural fallback remain preserved.

## 14. Boundaries of this planning session

This plan was written from the uploaded references and project/service notes. The Windows checkout itself was not accessible or inspected here. No Windows backup, branch, service restart, project change, model generation or API integration has been performed.

The downloadable file must be placed at the intended Windows destination. Implementation should begin with gate A, not by launching another full copy of Universal.

## 15. Sources checked

- Supplied `bracnhes for all new working v3.txt`: saved branches and first-level app functions. Historical branch/commit references require a fresh local check.
- Supplied `Untitled.txt`: service discovery dated 14 September 2026, including the shared Universal/Supervisor process.
- Supplied `newunversal-plan.txt`: neural fallback, local Three.js direction and performance considerations. The actual CodePen URL was not included; this plan does not claim to have inspected it.
- Supplied Tripo advert image and Primarydesignco profile screenshot: visual references only.
- [Meshy image-to-3D help](https://help.meshy.ai/en/articles/9996860-how-to-use-meshy-image-to-3d)
- [Meshy remesh documentation](https://docs.meshy.ai/en/api/remesh)
- [Tripo image-to-model documentation](https://developers.tripo3d.ai/en/docs/generation-image-to-model)
- [Tripo retopology documentation](https://developers.tripo3d.ai/en/docs/mesh-decimate)
- [Three.js documentation](https://threejs.org/docs/)

Use currently supported generation models/settings at implementation time. The style target is low-poly cyberpunk art; it does not depend on a model literally named 'lowpoly' or on the advertisement's P2.0 name.
