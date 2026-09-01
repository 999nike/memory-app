# Universal Space Ledger

## Verified baseline — 30 August 2026

- Architecture: one universe, canonical graph, solver and renderer with multiple local app/root gravity wells.
- Clusters: Memory (real memories, titled groups and proven molecular behaviour), Settings (independent root), and EMAIL (independent root with Inbox, Unread, Sent, Drafts, Search, Compose, Settings and Gmail).
- Gmail OAuth Phase 1 is live using server-side `gmail.metadata` only. Latest verified state: connected, Inbox 2, Unread 1, Drafts 0, no error.
- Live Gmail counts flow through `gmail-adapter.js` and `MemoryGraph.updateAppNodes()`.
- Mailbox expansion fetches up to 10 metadata headers; message-node click shows sender, subject and date in the existing inspector. No message bodies are requested.
- Gmail credentials and tokens remain outside the project at `E:\WIZZ-Server\secrets\universal-space-gmail\` and must never be printed or moved into source/backups.

## Protected rules

- Do not modify `memory-app-visual-lab\memory-app`.
- Do not rebuild or duplicate the molecular engine, graph, solver, renderer or physics.
- Preserve Memory, Settings, titled groups, connectors, dragging, boundaries and inspector-close behaviour.
- Local only unless explicitly authorised; no commit or push.

## Universal App Adapter milestone — 30 August 2026

- Introduced `universal-app-adapters.js`: adapter registration/lookup, normalized app definitions, generic state updates and owning-adapter action dispatch.
- `gmail-adapter.js` now owns the EMAIL definition, Gmail state mapping, Gmail endpoints/OAuth actions and Inbox inspector view.
- `memory-graph.js` contains no Gmail endpoint, OAuth or Gmail action knowledge; it consumes registered `appId`, `nodeId`, `label`, `state`, `action`, `view` and `children` fields.
- Files involved: `universal-app-adapters.js`, `gmail-adapter.js`, `memory-graph.js`, `index.html` and this ledger.
- Automated verification passed: JavaScript syntax, served assets, live Gmail summary (1/0/0), one live message header, one EMAIL registration, seven EMAIL nodes, state-label mapping, Inbox action dispatch/inspector rendering and no duplicate EMAIL definition.
- Not yet visually verified after this patch: cluster appearance/physics, Inbox click and close, Memory-root stability, and browser console cleanliness.

## Gmail app-button milestone — 30 August 2026

- All eight EMAIL child nodes dispatch through the owning Gmail adapter; no EMAIL node is defined without an action.
- Inbox, Unread, Sent and Drafts reuse the metadata-header endpoint with allowlisted Gmail labels (`INBOX`, `UNREAD`, `SENT`, `DRAFT`). No message bodies or new OAuth scopes were added.
- Search and Compose open local capability-status views explaining their Phase 1 permission limits.
- Settings and Gmail open local account inspectors. OAuth navigation occurs only from their explicit Connect/Reconnect button.
- Files involved: `gmail-adapter.js`, `server.mjs`, `index.html` and this ledger. Graph/physics files were not changed for this milestone.
- Automated live verification passed: Inbox 1, Unread 0, Sent 0, Drafts 0; all eight actions produced content; Settings/Gmail caused no direct navigation; one EMAIL definition with eight nodes; unsupported labels return HTTP 400.
- Not yet visually verified after this patch: canvas appearance/physics, pointer clicks, inspector close/root stability and browser console cleanliness.

## Hierarchical app adapter milestone — 30 August 2026

- The generic adapter contract now supports nested `children`, `expandable`, node `state`, state-driven labels and in-place dynamic child replacement.
- EMAIL Settings defines Account, Connection, Permissions, Sync and Disconnect children. Gmail defines connection-state and Connect/Reconnect children.
- Inbox, Unread, Sent and Drafts expand to at most 10 adapter-owned message/status nodes. `message.open` shows available metadata and explicitly states that body access is unavailable under `gmail.metadata`.
- Graph hierarchy uses canonical `parentId`, existing nodes/edges/solver and hidden-node physics. Expand/collapse and dynamic replacement do not call graph refresh/rebuild; graph/registry contain no Gmail route or action logic.
- Files involved: `universal-app-adapters.js`, `gmail-adapter.js`, `memory-graph.js`, `index.html` and this ledger. Physics constants were unchanged; `server.mjs` was unchanged for this milestone.
- Automated live verification passed: one EMAIL definition, eight top-level nodes, expected Settings/Gmail children, bounded live mailbox children, metadata inspector, explicit no-body notice, child actions, state labels, and no duplicate IDs after repeated mailbox loads.
- Not yet visually verified: pointer-driven expand/collapse, connector/physics appearance, inspector close/Memory-root stability and browser console cleanliness.

## Root physics and hierarchy interaction milestone — 30 August 2026

- All `appRoot` nodes now enter the one canonical solver even when the Memory root retains its legacy fixed rendering marker. Existing root inertia remains unchanged.
- Cluster-root dragging moves only the root and keeps the solver running; children follow through canonical parent attraction instead of rigid translation. The solved Memory root continues updating the canonical Memory centre position.
- Generic app-node radius decreases modestly by hierarchy depth: 15 at top level, approximately 12.3 at depth two and 10.1 at depth three, with a minimum of 9.
- Double-clicking a registered app root collapses expanded descendants for that `appId` only. It changes visibility in place and does not refresh/rebuild the graph.
- Files involved: `memory-graph.js`, `index.html` and this ledger. Physics constants, renderer, connectors, Gmail adapter and protected Memory source were unchanged.
- Automated canvas verification passed: Memory/EMAIL root-only drag, non-rigid children following on solver tick, Settings expand/collapse, smaller nested/message nodes, EMAIL-root full collapse with top-level nodes retained, and live Gmail Inbox action. Static checks confirm one solver, app-scoped collapse, no rebuild call and no Gmail logic in the graph.
- Not yet human-visually verified: final feel of root inertia/trailing, rendered depth balance, other-cluster isolation on screen, inspector close/Memory-root stability and browser console cleanliness.

## Safe Memory group inspector milestone - 30 August 2026

- Confirmed root cause: a no-movement group click entered the manual-gravity drag-end lifecycle, persisted group bodies and woke the shared solver; with the Memory app root participating in that solver, the wake exposed repulsion from canonical grouped-memory nodes even though group membership remained intact.
- Group-title hit detection now records the title from the canvas that actually renders it (`memory-graph-manual-gravity-body-canvas`). A 6 px movement threshold keeps pure clicks outside physics; only real drags persist the body and wake the existing simulation.
- Contained-memory Open calls the Memory detail inspector directly through `MemoryApp.openMemoryInspector(memoryId)`. It does not fabricate a `#memoryGrid` trigger, refresh/rebuild the graph or wake the solver; its overlay presentation preserves the graph surface width.
- Files involved: `memory-graph-manual-groups.js`, `memory-graph-manual-gravity.js`, `app.js`, `styles.css`, `index.html` and this ledger. Gmail, adapters, EMAIL hierarchy, physics constants, root participation and protected Memory source were unchanged.
- Controlled event verification passed: pure click with 5 px jitter caused zero group-storage writes, zero refreshes and zero wakes; Memory-root coordinates, group projection and member count remained unchanged; direct contained-memory dispatch and three open/close cycles remained inert. A 24 px drag persisted once and woke once without membership loss. Updated assets and the app returned HTTP 200.
- Not yet human-visually verified: rendered title hit area, inspector appearance, contained-memory detail reading/close, and final drag feel in the browser.

## Stable standalone Settings click milestone - 30 August 2026

- Confirmed two generic cluster-click causes: sub-threshold pointer movement was applied to the root while still classified as a click, and Settings expansion woke the solver with newly visible children immediately applying asymmetric repulsion to their own root. In the controlled pre-fix trace, pointer-down scheduled one simulation wake, expansion scheduled a second, a 2 px jitter moved the root by 2 px, and revealed-child force dominated nearby app-root force on the first expanded tick.
- Cluster roots now remain at their pointer-down coordinates until movement exceeds the existing 6 px threshold. Real drag then uses the full pointer displacement and retains the shared solver/child-follow path.
- An expandable cluster root is held at zero velocity only while its newly visible children settle in the already canonical solver. The temporary anchor is released when that run settles or a real interaction begins; no force constants or solver equations changed.
- Files involved: `memory-graph.js`, `index.html` and this ledger. Memory/EMAIL definitions, Gmail/adapters, renderer, connectors, graph construction and protected Memory source were unchanged.
- Controlled verification passed: zero sub-threshold displacement, zero Settings-root velocity on the first expansion tick and after settling, five rapid open/collapse cycles with zero progressive drift, and a real 18 x 7 px root drag whose visible child followed through solver ticks. Syntax and served-asset checks passed; app and updated graph asset returned HTTP 200.
- Not yet human-visually verified: final Settings click/expand/collapse feel in the browser.

## Universal external-activity pulse milestone - 30 August 2026

- `UniversalAppAdapters` now owns generic per-node activity through `setAppActivity(appId, nodeId, { pending, count })`, `clearAppActivity`, and read APIs. Identical updates are deduplicated and no activity timers or particle collections were added.
- The existing `memory-graph-neural-flow.js` canvas, animation loop, captured connector segments, cluster geometry and `drawRoutePulse()` path now also render pending activity. Blue flow is unchanged; activity uses that same route in child-to-root direction with a neon-purple palette, 1.18x pulse radius, stronger glow and a soft root heartbeat.
- Gmail Inbox is the first producer. The first observed unread count establishes a quiet local baseline; an increase sets generic `email/inbox` activity; intentional Inbox action acknowledges the current count locally and clears activity without changing Gmail remotely. The baseline is stored in browser local storage only.
- Dev simulation: `UniversalAppAdapters.setAppActivity('email', 'inbox', { pending: true, count: 1 })`; clicking Inbox clears it through the normal adapter action.
- Files involved: `universal-app-adapters.js`, `gmail-adapter.js`, `memory-graph.js`, `memory-graph-neural-flow.js`, `index.html` and this ledger. Physics constants, solver, graph rebuilding, grouping, Settings physics, Gmail scope and protected Memory source were unchanged.
- Automated verification passed: baseline/increase/acknowledgement persistence, no retrigger at unchanged unread count, deduplicated activity events, one shared animation loop, blue and purple coexistence, Inbox-only branch selection, reverse progress, 1.18x size, purple clearing with blue retained, syntax, no graph refresh/rebuild from activity, and HTTP 200 for updated assets. Live Gmail remained connected at Inbox 2 / Unread 1 / Drafts 0; an actual external unread increase was not generated during this test.
- Not yet human-visually verified: final purple colour, size, direction, heartbeat and Inbox-click clearing on the rendered graph.

## Activity routing refinement - 30 August 2026

- EMAIL Inbox now keeps the visible label `Inbox`; its live count remains adapter state without being baked into that control label.
- Pending activity is fanned generically across connector branches sharing the active app id. Non-target branches travel toward the app-root junction; the target branch travels from the junction toward the active node, with staggered phases and the existing purple pulse renderer.
- No Gmail-specific geometry, second effect system, physics, graph rebuild, timer or particle collection was added. Memory and standalone Settings activity remain unaffected by app-id filtering.
- Syntax, focused static checks, served asset HTTP 200 checks, and live Gmail status/summary checks passed. Browser visual verification of the final whole-cluster fan and acknowledgement remains pending.

## Immediate next step

- Human visual test of simulated Inbox activity, whole-cluster convergence and acknowledgement. Keep `gmail.metadata`; do not add permission expansion or automatic mapping yet.

## Live adapter refresh milestone - 30 August 2026

- Added generic `UniversalAppAdapters.startAppRefresh(appId, { intervalMs })` lifecycle support with one controller per adapter, immediate refresh, 15-second scheduling, focus/visibility refresh, hidden-tab pause, and in-flight request protection.
- Gmail now starts that lifecycle instead of performing a one-time-only mount refresh. Identical adapter state is deduplicated before the state event reaches the graph path; no document reload, graph rebuild or solver change is involved.
- Syntax checks and served asset/API checks passed. A real external unread increase and browser no-refresh visual verification remain pending.

## Activity source-to-target routing correction - 30 August 2026

- Activity routes now compose each visible sibling's own captured connector leg, reversed from source toward the app root, followed by the active target's captured root leg. The target branch remains the final attention destination.
- This reuses the existing `drawRoutePulse()` path and connector capture; no new renderer, timer, particle collection, physics or graph rebuild was added.
- Syntax and served-asset checks passed. Final browser verification of source-adjacent pulses and Inbox acknowledgement remains pending.

## Activity fan-density refinement - 30 August 2026

- Pending activity now schedules a purple route for every visible connector child in the active app cluster, rather than selecting a subset. Each route uses the existing captured connector geometry and `drawRoutePulse()` path; sibling legs travel toward the app root and the active target leg travels from the root toward the target.
- Branch phases are offset by child index so the existing purple pulses remain independent and staggered. Activity remains keyed by generic `appId`/`nodeId`; no EMAIL names or coordinates were added to the renderer.
- Syntax and served-asset checks passed after the refinement. Browser visual verification of all-branch density, convergence and acknowledgement is still pending.

## Activity route endpoint correction - 30 August 2026

- Activity route construction now explicitly reverses each source branch from its captured outer endpoint to the app root, then appends the captured target branch toward the pending node. This preserves each source node as the route's physical start rather than beginning on the shared trunk.
- A temporary route sampler verified `t=0` at the source endpoint, the source-leg boundary at the app-root coordinate, and `t=1` at the target endpoint for the composed route; the test hook was removed afterward. Syntax and served-asset checks passed.

## Activity cross-cluster routing correction - 30 August 2026

- Pending activity is now resolved once from the full captured app connector set before `maxCluster` visual partitioning. The resulting target route context is shared with every visual geometry cluster, while each cluster retains its own source branches and existing blue geometry.
- A focused synthetic test with seven branches confirmed multiple visual clusters and one shared active target context available to every cluster. Temporary instrumentation was removed; no physics, renderer, timer, particle or Gmail permission changes were made.

## Gmail Phase 2 read-only body setup - 30 August 2026

- Server OAuth now requests only `gmail.readonly`; existing `gmail.metadata` tokens remain recognized as connected but are reported as insufficient for bodies.
- Added one normalized read-only message endpoint and MIME text extraction in `server.mjs`. The Gmail adapter fetches that endpoint from `message.open` and renders the existing inspector, with an explicit Reauthorize action when the old scope is detected.
- Verified: syntax, app HTTP 200, OAuth start redirect contains `gmail.readonly`, old token status reports connected/read-only false, and the body endpoint returns the expected upgrade response without exposing credentials. Actual body rendering awaits explicit reauthorization of the account.

## Code Space adapter #2 milestone - 30 August 2026

- Added `code-space-adapter.js` as a second generic adapter with seven top-level capabilities: Projects, Files, Jobs, Codex, Terminal, Git and Settings. Settings is expandable with local workspace controls.
- Added bounded read-only server routes for immediate project folders and a maximum-100-entry/depth-2 file listing under the configured `E:\WIZZ-Server\new-version` root. Terminal is status-only; no commands or Git operations execute.
- Verified: adapter registration, all top-level action dispatches, nested Settings definition, Code Space activity API targeting, route HTTP responses, traversal rejection, application HTTP 200, JavaScript syntax, and no Code Space-specific logic in `memory-graph.js`.
- Browser visual verification of root placement, drag trailing, expand/collapse and rendered cluster isolation remains pending.

## Gmail refresh resilience milestone - 30 August 2026

- `server.mjs` now refreshes expired/401 Gmail access tokens once, updates in-memory state, persists the refreshed token safely, and retries the original request once. Refresh/API failures are distinguished from confirmed reauthorization failures.
- `/api/gmail/summary` now returns `{ connected: true, stale: true, error: 'gmail_summary_unavailable' }` for transient failures instead of falsely disconnecting the account.
- `gmail-adapter.js` retains the last known summary and Inbox activity across transient polling failures; only confirmed disconnected responses replace state and clear activity.
- Real-token verification passed: expired token refreshed and persisted; summary returned Inbox 10, Unread 9, Drafts 0; the subsequent summary succeeded without another token write. A controlled transient adapter refresh retained connected state and activity.

## Code Space embed integration - 31 August 2026

- The Code Space `codex.open` adapter action now opens the existing `http://127.0.0.1:8090/` Code Space wrapper inside Universal Space's existing detail panel via an iframe. No second Codex connection or Code Space source change was added.
- The panel receives a wider layout and contained full-height iframe styling; replacing/closing the existing detail content removes the iframe without a graph refresh. Static syntax and HTTP checks passed; browser interaction/visual verification remains pending.

## Code Space overlay correction - 31 August 2026

- Confirmed the iframe panel's prior grid-width rule resized the graph surface. Removed that rule and now apply the existing `detail-overlay` mode only for the Code Space iframe, with width increased on the fixed overlay itself.
- Universal Space, Code Space, Gmail summary and Code Space project routes returned HTTP 200; browser repeated open/close and Memory-coordinate verification remains pending.

## Canonical Memory velocity ownership fix - 30 August 2026

- Removed the legacy manual-gravity velocity writes to ordinary canonical Memory nodes. Group bodies retain their existing manual force, drag, persistence and projection behavior; the canonical solver is now the only integrator for ordinary Memory nodes.
- Verified `memory-graph-manual-gravity.js` syntax and served app/Gmail/Code Space endpoints (HTTP 200). Browser drag/settling feel remains pending visual verification.

## Verified Memory position and launch invariants - 31 August 2026

- Group-inspector unpin uses the narrow `MemoryGraphManualGravity.prepareGroupedMemoryRelease(memoryId)` coordinate handoff: it copies only the current visible satellite x/y to the existing canonical Memory node and zeros that node's vx/vy before normal membership detach. It does not rebuild, wake the solver, or alter the group body.
- Group deletion prepares every member through that same coordinate handoff before deleting the group. The delete path contains no `MemoryGraph.refresh()` and ends with the explicit non-destructive `MemoryGraphManualGravity.redrawOnly()` path.
- `MemoryGraph.redraw` is exposed as a draw-only graph operation; manual gravity's `redrawOnly()` deliberately does not fall back to `refresh()`. This preserves root, camera and remaining group/body positions during delete/unpin presentation updates.
- `memory-graph.js` preserves a live Memory root's x/y/vx/vy across legitimate rebuilds. Fresh graph creation alone uses a startup state, so group create/delete/rename/unpin rebuilds no longer recenter the blue root.
- Memory-root launch position is now saved only at deliberate blue-root drag end in `memory-graph-layout-v1` as normalized x/y ratios. Startup restores it before Memory nodes and manual group bodies are constructed; root velocity is not persisted. When no saved root exists, the fresh launch anchor is 50% canvas width / 22% canvas height.
- Visually verified: grouped-member unpin and group delete retain member positions; group bodies and the blue root remain stable; group lifecycle rebuilds preserve live root state; hard refresh restores a deliberately moved Memory root; fresh layout uses the upper launch anchor.
- Files changed: `memory-graph.js`, `memory-graph-manual-gravity.js`, `memory-graph-manual-groups.js`. Relevant pre-change backups: `backupbranches\\inspector-unpin-position-handoff-prepatch-2026-08-31`, `backupbranches\\group-delete-position-handoff-prepatch-2026-08-31`, `backupbranches\\memory-root-rebuild-invariant-prepatch-2026-08-31`, and `backupbranches\\memory-root-launch-position-prepatch-2026-08-31`.

## Accepted neural rollback baseline - 1 September 2026

- User explicitly accepted the displayed HP version as a working baseline toward the reference picture and requested a rollback version on the spatial branch only.
- Exact application commit: `4694b417c989b2ddd89a2c50e7849979a9c471b0` — Simplify neural rendering and draw connected fibres in the central trunk.
- Application tree: `196421d2a62ed21d1524aa7486ea410ac24a3bf1`. Repository: `999nike/memory-app`; branch: `molecular-v2`.
- User terminal evidence: `E:\WIZZ-Server\new-version\universal-space` is on `molecular-v2`, tracking `origin/molecular-v2`; HEAD and remote-tracking ref both equal `4694b41`; no modified/untracked paths were printed. This supersedes earlier dirty-main and failed-pull reports.
- User screenshot at `http://127.0.0.1:4173` shows green memory groups, blue Memory/EMAIL/Code Space roots, the connected fine blue-violet branching trunk and separate Settings. The screenshot is conversation evidence, not an added repository asset.
- Retained renderer configuration: Scaffold + Flow + Nexus; Width loads Nexus only. No new canvas or animation loop was added. See `NEURAL_UI_WORK.txt` entry 34 for implementation and earlier verification.
- Human acceptance establishes this visual baseline. It does not establish measured HP FPS, a completed match to the target artwork or full interaction regression coverage.
- Earlier restored work remains separately preserved by the reported local stash "HP restored state before molecular-v2 update" and tag `restored-before-neural-update` at `b112af3`; these are distinct from this accepted neural baseline.
- Recovery reference is the exact application commit above in existing branch history. A future rollback must preserve then-current local work and restore deliberately on `molecular-v2`; do not reset `main`, force-push, or blindly apply the older stash.
- This checkpoint publication updates existing documentation only. It introduces no application changes, new branch, duplicate project directory, automatic backup or screenshot file. Folder cleanup remains a separate unfinished task.
