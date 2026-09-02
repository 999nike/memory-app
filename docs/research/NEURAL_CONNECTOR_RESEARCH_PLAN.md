# Universal Space — neural connector research and implementation plan

Date: 1 September 2026

Status: WORKING NEURAL BASELINE ACCEPTED at application commit `4694b41`; visual refinement remains. The current sequence below supersedes the initial research checklist. This document authorizes no code changes by itself.

Repository path: `docs/research/NEURAL_CONNECTOR_RESEARCH_PLAN.md` on `molecular-v2`.

Canonical Windows project: `E:\WIZZ-Server\new-version\universal-space`.

Read the root `UNIVERSAL_SPACE_RULES.txt` first. The user's terminal output and local visual acceptance are recorded in `UNIVERSAL_SPACE_LEDGER.md`; the application rollback commit is `4694b417c989b2ddd89a2c50e7849979a9c471b0`.

“Main folder” means that working directory, NOT the Git branch `main`.

## Current sequence after local acceptance — 2 September 2026

The stable simplified neural baseline is accepted again after the failed V7 visual trial was removed. The user’s latest HP screenshot confirms the centre-to-app links now look solid again. Existing EMAIL purple notification pulses are working; preserve them.

- [x] Establish the working baseline and save its exact rollback commit: `4694b41`.
- [x] Record user confirmation that EMAIL notification pulses are working.
- [x] Reject and remove the failed V7 single-route taper. Current renderer recovery is Nexus V8 / Width V18 at commit `cbd7049551b7c614e08d13467d2d43e75e27f348`. It changed rendering only; graph topology, physics, drag/drop, persistence and pulse logic were not changed.
- [ ] CURRENT TEST PATCH: Nexus V9 builds one visibly biological focus root from the existing central junction to one app cluster. It is selected from the longest visible root and then follows that root while the graph moves; it is never chosen by canvas capture order. It must retain its exact working endpoints throughout movement, use one shared centre path for both tissue and spine, and read clearly as:
  1. translucent blue/violet outer root,
  2. thin bright internal spine,
  3. attached fibres terminating on the same body.
  Do not use capture order to choose the route. Do not taper it so hard that the app end appears detached. Do not touch graph edges or node physics.
- [ ] Once that one root passes the user’s HP screen check, blend the central polygon/cage into a small organic soma and join the accepted root bases into it.
- [ ] Refine connected forks and fine webbing within the existing drawing budget. Keep clear hierarchy and attached junctions throughout movement.
- [ ] Carry the accepted biological style into the app-child connections, one bounded pass at a time, while retaining the green bubbles and all existing actions.
- [ ] AFTER DESIGN ACCEPTANCE: extend the existing pulse/activity system across the finished connection routes, including the middle trunks and app-child paths. Reuse existing blue flow and purple notification semantics. Route real activity through connected geometry; do not make every app falsely report new mail. Preserve the working EMAIL notification and acknowledgement path.
- [ ] Accept each local visual/performance result before continuing, and record passed milestones in the existing ledger.

Current drawing ownership: Nexus V9 draws the middle trunks/soma and bounded attached fibres; its one focus root uses a broader blue/violet tube, sustained app-end collar and brighter internal spine. Scaffold V7 draws the underlying main/manual connections and local dendrites; Flow V3 owns existing route pulses. Width V18 loads Nexus V9 only. Do not re-enable the retired overlay chain. The V7 trial only altered the outer tissue on the first captured route; its taper made the Memory end appear detached and was removed in V8.

Work from the user's newest screenshot and original neural reference side by side. The long middle routes still read as narrow rails and the central junction still reads as a polygonal cage; those are the next visible anatomy issues. Pulse expansion is deferred until the design is accepted and is not part of the next root patch.

## Original research decision

Build the middle connector as a small, bounded Canvas 2D drawing feature inside the restored app's existing rendering path. Use one shared geometric skeleton for the tissue, spine, branch attachments and lights. Start with a single trunk before attempting the whole organism.

Use **perfect-freehand as the first geometry-helper candidate** for variable-width tissue. It produces polygon coordinates; it does not require replacing our renderer. Use the published space-colonization method as a later source of bounded secondary branching, rather than importing a continuously growing demonstration wholesale. PixiJS is a reserve option only if a measured Canvas limitation remains after this small implementation.

This is a technically plausible route, not a promise of reference-image quality at 60 FPS on the HP. Both appearance and responsiveness must pass before each next step.

## Working baseline and boundaries

- Only working project: `E:\WIZZ-Server\new-version\universal-space`.
- Test URL on the user's HP: `http://127.0.0.1:4173`.
- The user preserved their earlier restoration, aligned the local checkout with `molecular-v2` at `4694b41`, and accepted the resulting neural visual baseline.
- GitHub `999nike/memory-app`, branch `molecular-v2`, contains that application baseline followed by documentation checkpoints. The earlier failed overlay sequence is historical; do not restore it.
- **Do not touch `main`**: it is the separate conventional interface.
- **Do not touch `E:\junkz backup`**: the user alone controls that backup.
- Other similarly named folders are not alternate working projects. No new project copies, backup branches or worktrees.
- Preserve all graph nodes/edges, physics, drag/drop, persisted positions, application actions, grouping and inspector behavior.
- This documentation publication changes no app files, server configuration, local branches or backups. Only remote molecular-v2 receives the documentation commit.

Read `docs/operations/UNIVERSAL_SPACE_LOCATIONS_AND_BASELINE_2026-09-01.md` for the folder map. Read the current operational handoff/ledger and `NEURAL_UI_WORK.txt` before implementation; entries 1–33 describe historical experiments, while entry 34 records the simplified baseline. Follow the current sequence above.

## What the reference actually requires

Reference: `ChatGPT Image Aug 30, 2026, 02_05_55 AM(5).png`, supplied in this conversation. The existing green bubbles and application behavior remain the anchors.

| Visual requirement | Drawing decision proposed for our app |
| --- | --- |
| One connected middle organism | A shared central junction with continuous root-to-junction paths; no independently guessed connector endpoints. |
| Irregular, translucent blue/violet trunks | Smooth centre paths with controlled width variation and tapered outlines. Avoid broad flat purple bands. |
| Thin bright internal spine | A narrow path derived from the same prepared centre samples as the tissue. |
| Trunk → root → fork → fine fibres | A bounded hierarchy, with parent references and thinner descendants. |
| Swollen organic soma | A small irregular junction continuous with the trunk bases; avoid a perfect glowing ring or polygonal cage. |
| Fine connected webbing | Short links within the local connector envelope, sharing actual junction coordinates. Density concentrated near forks and soma. |
| Small fibre lights | A few reusable light sprites travelling along cached path distances. Most tissue stays visually stable. |
| No dark petals or radial starbursts | No masks painted over old spokes and no identical thick root-to-every-child ribbons. |

The next implementation is **one middle trunk only**. Reskinning app-child connections follows acceptance of the middle anatomy in the user's stated design direction. Do not confuse a centre-only milestone with completion of the full reference image.

## Online examples and code findings

### 1. Closest branching morphology: Jason Webb's vein experiments

Open the [demo gallery](https://jasonwebb.github.io/2d-space-colonization-experiments/) or the [Bounds example](https://jasonwebb.github.io/2d-space-colonization-experiments/experiments/bounds/). The Bounds demo was opened and visually inspected during this research: several organic vein systems grow within a circular boundary. It demonstrates branch hierarchy, not our blue tissue treatment or finished UI.

The [repository](https://github.com/jasonwebb/2d-space-colonization-experiments) includes growth constraints, obstacles and open/closed venation. In [Network.js](https://github.com/jasonwebb/2d-space-colonization-experiments/blob/master/core/Network.js), `update()` associates attractors, extends branches, thickens ancestors and rebuilds a spatial index; `getRelativeNeighborNodes()` contains nested neighbor comparisons. [Node.js](https://github.com/jasonwebb/2d-space-colonization-experiments/blob/master/core/Node.js) draws individual parent-child segments. These are useful ideas, but do not run the growth cycle every app animation frame; impose explicit operation caps.

**Reuse decision:** visual/algorithm reference. Its [licence is CC BY-NC-SA 4.0](https://github.com/jasonwebb/2d-space-colonization-experiments/blob/master/LICENSE), not MIT. Do not vendor its code or artwork into the product on the assumption it is unrestricted open-source software.

### 2. Best small geometry candidate: perfect-freehand

[perfect-freehand](https://github.com/steveruizok/perfect-freehand) converts supplied points into variable-width outlines and documents Canvas/SVG rendering. It supports explicit pressure and tapering and has an [MIT licence](https://github.com/steveruizok/perfect-freehand/blob/main/LICENSE).

Inspected code: [getStroke.ts](https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStroke.ts), [getStrokePoints.ts](https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokePoints.ts), and [getStrokeOutlinePoints.ts](https://github.com/steveruizok/perfect-freehand/blob/main/packages/perfect-freehand/src/getStrokeOutlinePoints.ts). The first prepares stroke points and then builds their outline. Preparation can move/filter samples; therefore the spine must use those same prepared samples. Explicitly set `simulatePressure: false` and `last: true`; do not depend on defaults. Supply controlled widths through pressure, not mouse velocity.

**Reuse decision:** trial a pinned version as a geometry utility, retaining its licence notice. No React UI, drawing-app event handlers or additional renderer. The author's [discussion of sparse generated points](https://github.com/steveruizok/perfect-freehand/discussions/34) makes sampling/endpoint verification a necessary gate. Do not assume four control points alone produce the intended curve.

### 3. Small branching package: useful, but not a drop-in

[Nick Nikolov's space-colonization](https://github.com/nicknikolov/space-colonization) declares MIT in its [package metadata](https://github.com/nicknikolov/space-colonization/blob/master/package.json). Its [actual index.js](https://github.com/nicknikolov/space-colonization/blob/master/index.js) scans buds against attractors and returns parent relationships.

A concrete defect is visible in the inspected source: `buds.indexOf(bud.parent) || -1` converts a valid parent index of zero into minus one. It also uses `Math.random()` and repeated `indexOf` calls. **Do not install it blindly** as our production generator. It is a useful implementation reference; a deterministic, capped implementation from the paper is preferable for the small amount of branching we need.

### 4. D3 edge bundling: routing reference, not the visual solution

[D3's hierarchical bundling example](https://observablehq.com/@d3/hierarchical-edge-bundling) demonstrates shared routing. The inspected [bundle.js](https://github.com/d3/d3-shape/blob/main/src/curve/bundle.js) blends intermediate points toward a straight chord and feeds a basis spline. The [curve documentation](https://d3js.org/d3-shape/curve#curveBundle) explains the strength parameter; the module uses an [ISC licence](https://github.com/d3/d3-shape/blob/main/LICENSE).

**Reuse decision:** borrow the idea of shared intermediate routes if app-child connections are addressed later. Do not import its circular node layout, force simulation or interaction system. A spline alone does not create shared branch junctions or organic tissue.

### 5. PixiJS ribbons: reserve rendering option

[PixiJS MeshRope](https://pixijs.com/8.x/guides/components/scene-objects/mesh) bends a texture along points. In the inspected [RopeGeometry.ts](https://github.com/pixijs/pixijs/blob/dev/src/scene/mesh-simple/RopeGeometry.ts), each centre point produces two side vertices; adjacent pairs become triangles. That gives a clear model for ribbon geometry. The inspected implementation uses a common half-width: irregular tapering still needs custom widths/geometry. PixiJS has an [MIT licence](https://github.com/pixijs/pixijs/blob/dev/LICENSE).

**Reuse decision:** reserve, not the first patch. A mesh can render precomputed tissue efficiently, but a new GPU engine does not guarantee a faster result on this HP. Pixi's own [performance guidance](https://pixijs.com/8.x/guides/concepts/performance-tips) warns about constantly changing complex graphics, masks, filters and blend-mode changes. Those are relevant to the previous failure too.

## What the earlier failure tells us

Evidence below belongs to the FAILED stack, from the earlier `NEURAL_UI_WORK.txt` audit and `Trace-20260901T134104.json.gz`; it is not a measurement of the restored app.

- Ten neural `drawFrame` callbacks were active in the captured stack.
- Across 98 animation batches, mean main-thread animation work was about 184.56 ms. Scaffold averaged 88.37 ms; Branches averaged 28.74 ms per recorded callback.
- Multiple systems rebuilt overlapping trunks, roots and webs. Some reconstructed supposedly identical curves using different formulas.
- The direct-load integration changed interception order. Executed source also showed SpokeMask V1 behind a URL labelled v2. A query string did not establish the executing version.
- The audit found Scaffold suppressing canonical thin blue `drawEdge()` strokes in that stack. Do not carry the initial “straight edges are still visible” hypothesis into the restored app without inspection.
- Reducing some work and adjusting geometry did not produce a user-accepted result. The user restored the working baseline.

The trace had a long inactive gap: do not divide its total duration into callback counts and call the result FPS. GPU work was substantial, but not attributable to individual canvases from that recording.

**Design consequence:** one owner for each connector, one geometric record, bounded work, actual browser comparison. Hiding a canvas is not proof its animation loop stopped.

## Proposed geometry and drawing approach

Everything in this section is our proposed adaptation; it is not a claim that an external library already implements Universal Space.

### A. Read existing anchors; keep decoration out of the graph

Use the existing visible root positions, projection and camera transform. The centre soma is a decorative coordinate, never a new physics node or persisted entity. Keep its derivation stable for the same root IDs and positions. For the three-root test, begin with a centroid in the renderer's coordinate system; handle collinear, overlapping and missing roots without division-by-zero or random flips.

The original research considered the scene-level `drawGraph()` in `memory-graph.js` as a possible integration point. **Subsequent local Codex source audits report that restored Scaffold V2 already owns connector drawing**, capturing and suppressing canonical blue strokes through the Canvas wrappers; Flow owns route pulses. Treat Scaffold's existing drawing stage as the first integration candidate, not a reason to add a competing call in `drawGraph()`.

Historical hook hypothesis, superseded for the accepted middle connector by the Nexus ownership recorded above: the proposed narrow hook was the `drawOrganicTube(ctx, geometry.trunk, ...)` call within Scaffold's `drawCluster()`. Its suitability is still unverified: establish whether that trunk is the requested connection between app clusters or an internal cluster trunk, and select one stable connector. `drawCluster()` runs for multiple clusters; do not change them all accidentally. Generic `drawOrganicTube()` also draws stems/branches and must not be changed globally for the single-trunk trial. Browser DOM/active-loop evidence was unavailable in that local audit; source inference is not runtime verification.

### B. Make one prepared path record

Each trunk record contains its anchor IDs, prepared centre samples, widths, cumulative distances, outline, bounds and attached branches. Cache it. Tissue, spine and lights consume this record instead of reconstructing curves independently.

For the first trunk, use about 32 sampled points on a gentle cubic curve. Vary width slowly and deterministically along its length; keep the spine thin. Generate the outline using the tested helper. Use the prepared centreline for branch attachment positions and light motion. Degenerate or extremely short paths fall back to a small joined shape or no decoration.

### C. Join tissue without masks

For the later three-root scene, combine the trunk bases and soma into one silhouette. A proposed Canvas implementation is a compound path with consistent winding and nonzero fill so overlapping same-material areas are filled once. Test junctions carefully: a compound fill does not itself invent smooth branch geometry.

Use a small number of tissue/fibre passes in the same renderer. A drawing pass is not another canvas or animation loop. Avoid opaque dark covers, independent “repair” strokes, full-screen blur and a heavy outline around every root. Start with zero live `shadowBlur`; add depth through translucent fills, narrow highlights and a small cached glow sprite if needed.

### D. Add bounded branch morphology only after the trunk works

The [2007 space-colonization paper](https://algorithmicbotany.org/papers/colonization.egwnp2007.pdf) separates skeleton growth, simplification, smoothing and surface construction; it also allows a fixed iteration limit. Its branching-radius model combines child radii using an exponent commonly between two and three. The [2005 leaf-venation research](https://algorithmicbotany.org/papers/venation.sig2005.html) covers branching and interconnected vein networks.

Our adaptation: keep the major anchor-to-soma routes guaranteed. Grow a small secondary network only inside narrow envelopes around those routes, then simplify it. Seed deterministically, cap nodes/iterations and stop on no progress. Never depend on random growth to reach an actual app root.

Store branch attachments as a parent path ID plus a distance fraction and local offset. When roots move, deform the existing branch structure with its parent. Do not regrow a new random network during each drag frame. For the fine web, add only a bounded number of short nearby links; avoid all-pairs cross-links. A tree alone is not the full fine mesh in the reference.

### E. Cache geometry separately from pixels

[Path2D](https://developer.mozilla.org/en-US/docs/Web/API/Path2D) can retain path commands; it does not mean painting those paths becomes free. MDN's [Canvas optimization guide](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas) recommends pre-rendering repeated work, batching calls and avoiding unnecessary state changes and shadow blur.

Cache geometry until anchors, projection, membership or style changes. Pure camera translation can reuse geometry through the existing transform. Rotation/projection changes may require reprojection; handle those explicitly. Cache static tissue/web pixels only where a tight offscreen buffer measurably helps; that buffer has no DOM presence, timer or event listener. Reuse one small light sprite instead of constructing gradients for every particle.

No worker migration in the first implementation. [OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) supports worker rendering, but changing thread ownership is a separate integration project and does not remove the amount of pixel work. If later measurements justify it, evaluate geometry generation in a worker separately.

### F. Preserve the scheduler and inputs

The geometry helper owns no canvas, `requestAnimationFrame`, input listeners, persistence, graph refresh or prototype overrides. The selected existing rendering owner calls it. Do not introduce new global wrappers around `CanvasRenderingContext2D` methods or infer app identity from stroke colors.

If the restored stack already draws the connection being replaced, disable that exact old drawing path as part of the same change. Do not cover it with a mask. Keep unrelated connections and node drawing intact. Any old loop being retired must actually stop or stop scheduling its former work; CSS hiding alone is insufficient.

## Original research build sequence - reference only

Use the current sequence at the top for the accepted baseline. This initial table explains the original staged proposal; it is not a command to restart the completed audit or remove working EMAIL pulses. Each further implementation still needs one coherent diff and a visual/performance gate.

| Step | Deliverable | Required gate |
| --- | --- | --- |
| 0 — Establish restored runtime | Read-only inventory of served scripts, actual exported versions, visible canvases/z-order, drawing owners and active loops. Identify the exact restored files and browser baseline. | Correct directory; no guessed renderer; baseline trace and screenshot recorded. |
| 1 — One trunk | Trial the tapered outline helper on one curve with fixed anchors, then moved anchors. Tissue and spine share prepared samples. No branches, web or animated lights. | Looks like a translucent irregular root; exact endpoints; no gaps, petals or substantial drag regression. |
| 2 — Middle junction | Three major trunks with one small connected soma, invoked once from the identified existing drawing stage behind nodes. | Connected and organic across several root positions; bubbles, hit-testing and inspector behavior unchanged. |
| 3 — Sparse branching | Bounded secondary forks and short fine links using the same geometry records and draw owner. | Branches stay attached throughout pan, zoom, root drag and rotation. Density improves the reference match within budget. |
| 4 — Small moving lights | A few cached light sprites following distance along the existing paths. Tissue geometry remains unchanged by time alone. | Motion is subtle; no continued geometry rebuild at rest; no frame-time regression beyond the gate. |
| 5 — Bank only a passed result | User's local acceptance, then the existing authorized commit/push workflow for the spatial branch. Update the operational record with measured results. | `main` and personal backup untouched; local/remote differences understood before any synchronization. |

Step 1 may use a disposable fixture in the system temporary directory if the developer needs isolation. It must exercise the same helper and is not a new app checkout or a second production rendering stack. Do not activate a replacement across the whole app merely to test one trunk.

If a result is visually unchanged, verify its active call path once. If it is wrong or slow, repair or remove that step. **Do not compensate by adding another layer.**

## Initial budgets and browser acceptance

These are proposed engineering limits to validate, not numbers claimed by a library and not measured HP capability.

| Item | Initial limit / policy |
| --- | --- |
| New production canvases / new animation loops | Zero; use the identified existing renderer/scheduler. |
| Major trunks in the first scene | Three, roughly 32 centre samples each. |
| Secondary forks | At most nine in total to start, with roughly 16 samples each. |
| Fine links | At most 96 short links across the middle organism; fewer during interaction if necessary. |
| Moving light sprites | At most 12; zero until step 4 passes its own comparison. |
| Geometry growth work | No growth in the drawing hot path; bounded build jobs, no-progress exit and invalidation only when necessary. |
| Added geometry/draw CPU time | Initial target: p95 no more than 2 ms for this feature; separately inspect actual presentation/frame behavior. |
| Cache allocation | Tight bounds, fixed count, explicit disposal; no allocation of full-viewport buffers per branch. |

For scale: an illustrative 1920×1080 RGBA pixel buffer at DPR 1.5 is about 17.8 MiB; ten are about 178 MiB before additional buffering. These are arithmetic examples, not measurements of the HP's allocated memory. Keep the baseline DPR unchanged for the first A/B comparison. Any later reduction in connector resolution must be explicit and must not silently lower node/text quality.

Use a short, repeatable HP test: 10 seconds idle, 10 seconds panning, 10 seconds dragging the same root. Keep viewport, browser zoom, DPR, expanded nodes and inspector state matched. Chrome's [Performance panel](https://developer.chrome.com/docs/devtools/performance/reference) supplies frame and main-thread inspection. Compare short active intervals; keep the page foregrounded. Avoid another six-minute capture with long inactive gaps.

Proposed minimum acceptance: at least 30 presented frames/second during the matched interaction, and no more than a 10% regression in the baseline's p95 frame interval. Target the restored experience, not merely the 30 FPS floor. If the baseline itself misses the floor, record that and agree the target before visual expansion. JavaScript call timing and `requestAnimationFrame` frequency alone are not presented FPS or GPU duration.

Also verify: no new tasks over 50 ms attributable to the connector; no accumulating canvases, listeners or allocations after repeated open/close; no increasing memory trend across repeated interaction cycles after normal collection.

Behavior checks: drag each app root and a memory group, expand/collapse Settings, open/close Code Space, pan/zoom/rotate, and revisit the saved workspace. For a purely visual feature, compare graph/persistence state before and after; use the user's normal test workflow for any unpin/delete regression test, not their protected backup or irreplaceable data.

## Source evidence and unresolved work

Research inspected live public demos, official documentation and actual upstream source. No third-party library was installed into the app during the original research. Subsequently, the simplified connector at `4694b41` was implemented, checked in a native Canvas fixture and a deployed browser, installed locally, and accepted by the user. See `NEURAL_UI_WORK.txt` entry 34 and the operational ledger for the specific verification limits. Direct control of the HP and measured HP FPS remain unavailable. The supplied older V1 documents/index were read for context and are not treated as the restored spatial entry point.

The following Git blob hashes identify representative source files actually read on 1 September; branch URLs may change later. Pin and record the selected package release before implementation rather than importing a moving branch/CDN URL.

| Source | File | Inspected Git blob SHA |
| --- | --- | --- |
| Jason Webb vein experiments | `core/Network.js` | `a09121a59b896242445282d867440cf21018ffbc` |
| Nick Nikolov space-colonization | `index.js` | `c2c1a1c1bcf554e1caf49d285fc485e48a63e58b` |
| perfect-freehand | `packages/perfect-freehand/src/getStrokePoints.ts` | `1b130e59eb3a2359bd9150c14b3e0fb5417f7fb2` |
| perfect-freehand | `packages/perfect-freehand/src/getStrokeOutlinePoints.ts` | `ec5f75caf09a8cf499441bf5eb889b9a18d0a172` |
| D3 shape | `src/curve/bundle.js` | `ac1014ebc0324e8a0fed7f8a5082f47f31f3b553` |
| PixiJS | `src/scene/mesh-simple/RopeGeometry.ts` | `cb02e66d39a1580370ad3f426287dfb5e7298932` |

## Next implementation task when requested

Read the current sequence above and the accepted baseline in the operational ledger. Work on `molecular-v2` in the canonical project, or its existing GitHub files when explicitly requested. Verify the current Nexus trunk drawing path and make the smallest single-trunk tissue/spine refinement. Preserve the existing connected forks, graph state and EMAIL activity pulses. Do not restart branch reconciliation, add renderer overlays, alter physics/persistence, create project copies or touch `main` or the private backup. After one meaningful visual change, compare the local result with the target before proceeding. Wider pulse routing follows completion and acceptance of the design.
