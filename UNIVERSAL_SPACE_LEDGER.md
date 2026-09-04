# Universal Space Ledger

## Product Push documentation checkpoint - 4 September 2026

- `docs/APP_CLUSTER_MAPPER_PLAN.md` is now the sole active Universal Product Push checklist: cluster/button cleanup, the three-decision Memory -> Office -> Code Space workflow, activity visibility, Orb V1, onboarding, startup/install, friend test, release safety and later selective visual decoration.
- The app-cluster mapper is preserved as completed architecture/history rather than a second active queue. Its adapter registry and canonical graph traversal remain in use.
- `UNIVERSAL_SPACE_HANDOFF.md`, `AGENTS.md` and the conflicting current-direction wording in `UNIVERSAL_SPACE_RULES.txt` now point to that same active plan. This checkpoint changes documentation only; no runtime source, graph, renderer, physics or Bridge code changed.

## Current checkpoint — 2 September 2026

- The user restored the solid local application, saved local commit `0214ede` on `restored-solid-20260902`, and published the forward restoration commit `0027fcf53a577d4126a1be96b30255b29ccf2178` to `molecular-v2`.
- Their final terminal output shows `molecular-v2` tracking `origin/molecular-v2` with no printed dirty/untracked paths. GitHub was independently checked at the same commit.
- This is the current application baseline. Earlier renderer baselines and version/checklist claims do not identify the restored runtime.
- The user changed the next product milestone to app definitions -> reusable adapter/cluster mapper -> existing Universal Space graph. Centre-node/trunk graphics improvement and pulse-design expansion are removed from the active queue.
- Source audit confirms recursive cluster construction already exists for registered app definitions. The remaining first milestone is a reusable definition loader/validator and action-binding factory. Memory/standalone Settings still use established special paths.
- Documentation cleanup updates the agent entry point, rules, handoff, operations record and branch guidance; introduces `docs/APP_CLUSTER_MAPPER_PLAN.md` as the single active checklist; and removes eight obsolete graphics/prototype plans and checklists.
- Removed documents: `NEURAL_UI_WORK.txt`, `docs/research/NEURAL_CONNECTOR_RESEARCH_PLAN.md`, `MOLECULAR_FRONT_SKIN_PLAN.txt`, `REUSABLE_MOLECULAR_ENGINE_PLAN.txt`, `LEDGERPATCH.txt`, `neuralpatchledger.txt`, `patchledger.txt`, `MEMORY_GRAPH_FUTURE_PIN.md`. Previous contents remain in Git history; no archive copies or alternate checklists are created.
- That cleanup change was documentation-only and did not implement the mapper. The subsequent Milestone 1 working-tree implementation is recorded below; no browser result is claimed for it.

## App cluster mapper Milestone 2 - 2 September 2026 (implemented; browser verification outstanding)

- Replaced the retired `WORKSPACE PORTAL` definition completely with `OFFICE` through the unchanged `AppDefinitionLoader.loadDefinition()` factory. OFFICE has exactly ten first-level spokes: Dashboard, Jobs, Important, New Job, Workers, Dispatch, Projects, Memory Jobs, Ledger and Open Office. Its 15 fixed stable-filter children produce 25 fixed OFFICE nodes; actual records never add graph nodes or edges.
- Added the Office-owned `src/connectors/universal-space-bridge.js` in `E:\WIZZ-Server\workspaces\office-app`. It is available only in a hidden iframe on `http://127.0.0.1:4176`, accepts only messages from `http://127.0.0.1:4173` whose source is its expected parent, and exposes fixed bounded reads for dashboard, jobs, important, workers, dispatch, projects, Memory jobs and ledger. It reads only `office-v0.jobs`, `office-v0.workers` and `office-v0.dispatch-packages` through their existing stores; Projects are derived from stored job project names and Memory Jobs filter stored jobs where `source === "memory-space"`. No collector, acknowledgement, Code Space catalog refresh, arbitrary key, URL, command or write path is available in bridge mode.
- All list responses validate fixed filters, have `limit <= 10`, include only display fields and report truncation. A right-panel row requests only its selected record. The Universal inspector inserts those fields as DOM text, not HTML. `Open Office` explicitly opens/reuses the fixed Office origin; `New Job` explicitly opens the real Office `#/jobs/new` route, which renders the existing Jobs page and opens its existing job dialog.
- Focused checks passed: Office `npm.cmd run check`; Office `npm.cmd test` (42 passing, including bounded reads, rejected arbitrary resources/filters/oversized limits, Memory-source filtering, singular record detail, and exact-origin/expected-parent enforcement); Universal `node --check` for loader, registry and Gmail adapter; and an isolated loader check confirming SETTINGS DEMO retained, OFFICE has 10 first-level spokes / 25 fixed nodes, and WORKSPACE PORTAL is absent.
- Changed files: Universal Space `app-definition-loader.js`, `docs/APP_CLUSTER_MAPPER_PLAN.md`, `UNIVERSAL_SPACE_HANDOFF.md` and this ledger; Office `src/connectors/universal-space-bridge.js`, `src/app.js`, `package.json` and `test/universal-space-bridge.test.js`. No Universal graph, renderer, solver, physics, graphics, CSS, Gmail, Code Space or server-route file changed. The accepted Gmail invariant remains: Gmail mailbox contents are inspector data, not Universal Space graph topology.
- Browser verification remains blocked: the browser-control process exited before creating a session (`trusted Node process exited unexpectedly; kernel reset, rerun your request`). Therefore the hidden-frame handshake, right-panel lists/detail selection, repeated open/close node/edge counts, normal-reload topology proof, root-drag/expand/collapse, EMAIL acknowledgement/Code Space overlay regression, surrounding-cluster isolation and browser-console cleanliness remain unchecked. Do not start later runtime-import/discovery stages while these checks are outstanding.

## OFFICE explicit Memory Jobs collection - 2 September 2026

- The product invariant is: **Universal Space controls each connected app through its existing app logic; the cluster replaces routine app UI controls rather than duplicating the app implementation.**
- `office.memory-jobs.open` now sends the one fixed `memoryJobs.collect` command only after an explicit graph click. The Office-owned bridge calls `collectMemoryJobsForUniversalSpaceBridge()`, which refreshes the existing Code Space project catalog and invokes the existing `collectMemoryJobs()` / `memoryJobCollector.collect()` path unchanged. Existing Memory-feed fetch, Office job construction, fail-closed project validation, duplicate detection and acknowledgement behavior remain in Office's existing collector.
- The bridge returns only `completed` counts (`discovered`, `imported`, `acknowledged`, `failed`) or a clean `already-running`, `project-catalog-unavailable` or bounded `collector-failed` status. Universal Space then requests at most ten existing stored jobs whose `source === "memory-space"` and renders them in the right inspector. No background collection, graph record or topology change is introduced.
- Reproduced-panel follow-up: port 4176 serves the guarded Office source, so bridge mode already suppresses startup collection and its 12-hour interval; the generic panel was collapsing a genuine collector failure. The startup lifecycle is now focused-testable: normal Office refreshes the catalog, collects and schedules the interval; bridge mode does none of those automatically. Explicit `memoryJobs.collect` is unchanged as the only bridge trigger. A failed collection now returns a bounded `collector-failed` reason to the inspector rather than only a generic completion message.

## Gmail mailbox inspector topology invariant - 2 September 2026

- Gmail mailbox contents are inspector data, not Universal Space graph topology.
- Inbox, Unread, Sent and Drafts remain the fixed EMAIL navigation controls but are no longer expandable. `loadMailbox()` opens the existing right-hand detail inspector, requests at most 10 headers from the existing allowlisted mailbox endpoint and renders only those bounded rows. It no longer calls `replaceAppNodeChildren()` and creates no loading, disconnected, empty, error or message graph nodes.
- Header rows escape sender, subject and date before HTML insertion. Delegated handling on the existing `detailContent` click listener passes the selected message ID and known header state to `openMessage()`. No body request occurs until that row is selected; the returned message replaces the same inspector contents through the existing viewer.
- Inbox acknowledgement remains before the mailbox request in the normal `mailbox.open` action. Gmail routes/scopes, server code, graph lifecycle, renderer, physics, neural graphics, CSS, Code Space, Memory, Settings and the Milestone 1 mapper were not changed.
- Files changed for this narrow patch: `gmail-adapter.js`, the Gmail asset version in `index.html`, this ledger and `UNIVERSAL_SPACE_HANDOFF.md`. The other dirty files remain the pre-existing uncommitted Milestone 1 work.
- Focused adapter verification passed: the EMAIL definition stayed at 16 nodes / 15 parent edges through 13 mailbox opens; each panel was capped at 10 escaped rows; Inbox, Unread, Sent and Drafts used their correct labels; no hierarchy event fired; no message-body request occurred before selection; one delegated row click made one body request and replaced the same panel; and Inbox activity cleared.
- Live local verification passed without printing message contents: app and `gmail-adapter.js?v=9` HTTP 200; Gmail connected with Inbox 13 / Unread 12 / Drafts 0; INBOX and UNREAD returned 10 bounded headers each; SENT and DRAFT returned zero. JavaScript syntax and static absence of the mailbox graph-child path passed.
- Browser acceptance was attempted three times, but the browser-control process exited before creating a session (`trusted Node process exited unexpectedly; kernel reset, rerun your request`). Therefore whole-graph node/edge counts, pointer-driven open/message/close repetition, unchanged surrounding clusters and browser-console cleanliness are not claimed.

## App cluster mapper Milestone 1 - 2 September 2026

- Added `app-definition-loader.js`, a pre-graph schema-v1 definition loader, validator and generated-adapter factory. It accepts JSON-compatible definitions plus an explicit action-handler map, validates the complete definition before registration, and uses the existing registry and recursive graph builder rather than adding another generator.
- Validation rejects unknown fields, unsupported versions, missing/invalid IDs and types, definitions above 200 nodes or 8 hierarchy levels, duplicate normalized IDs, collisions with registered nodes, the standalone Settings root and active Memory graph IDs, unbound views/actions, and non-JSON state. Errors carry a code and field path.
- `registerAppAdapter` now rejects duplicate app IDs instead of replacing a working adapter. Registered normalized definitions retain `schemaVersion` when supplied. `MemoryApp.graphNodeIds()` exposes only the active canonical graph IDs for collision checks; it does not alter Memory records or construction.
- Added a clearly labelled `SETTINGS DEMO` bootstrap definition between Code Space and `memory-graph.js`. Its System/Display/Sound and Network/Wi-Fi hierarchy uses normal app roots, edges and expand/collapse. All three actions are bound to the existing detail inspector and explicitly say that operating-system/network access is not connected.
- Changed files: `app-definition-loader.js`, `universal-app-adapters.js`, `app.js`, `index.html`, `docs/APP_CLUSTER_MAPPER_PLAN.md` and this ledger. No renderer, physics, connector, graphics, CSS, Gmail, Code Space or server file changed.
- Verification passed: JavaScript syntax for the loader, registry, app and canonical graph; focused nested mapping/namespacing and owning-adapter dispatch; malformed/version/duplicate/size/depth/collision rejection with no registry mutation; direct duplicate protection; registry -> Gmail -> Code Space -> loader -> graph ordering; retained Gmail and Code Space adapter objects; HTTP 200 for the app and loader asset; and `git diff --check` with only existing line-ending warnings.
- Browser pointer/console verification was attempted twice but the browser-control runtime could not start because the Windows sandbox helper returned `helper_unknown_error: setup refresh had errors`. No browser visual result is claimed. Demo expand/collapse/click and the existing Memory, Settings, EMAIL and Code Space regression interactions remain for browser verification when that runtime is available.

The milestones below are historical evidence. Earlier “next” tasks, old permission-state reports and unverified checks are not the current queue; follow the mapper plan and current handoff. Branch/path/authorization policy is maintained in `UNIVERSAL_SPACE_RULES.txt`.

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
- Historical local-only scope applied to those earlier patches. Current scope and authorization are governed by the user and `UNIVERSAL_SPACE_RULES.txt`.

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

## Historical next-step note — 30 August 2026, superseded

- At this point the queued task was an Inbox activity visual test under `gmail.metadata`. Later entries added read-only body support. The 2 September app-mapper plan is now the active queue; this note is not a restriction on it.

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
