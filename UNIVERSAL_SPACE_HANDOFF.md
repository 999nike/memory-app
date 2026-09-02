# Universal Space Handoff

Updated: 2 September 2026. Read `UNIVERSAL_SPACE_RULES.txt` first.

## Current baseline and task

Application baseline: `0027fcf53a577d4126a1be96b30255b29ccf2178` on `molecular-v2`, restored and uploaded by the user. Their terminal reports a clean local checkout tracking `origin/molecular-v2`.

The active work is the app-adapter / cluster mapper in [docs/APP_CLUSTER_MAPPER_PLAN.md](docs/APP_CLUSTER_MAPPER_PLAN.md). Start with its definition-loader milestone. The earlier percentage estimates and “1–2 patches” were conversational estimates, not a verified completion guarantee.

The user accepts the restored presentation. Middle-node graphics, trunks, tissue, internal spines, fibres and reference matching are removed from the queue. Existing runtime graphics files and the saved image are retained; their presence is not an instruction to resume visual work.

## Architecture actually present

- One shared canonical graph and solver, using the existing rendering path.
- Memory, standalone Settings, EMAIL and Code Space appear in that universe.
- `universal-app-adapters.js` registers definitions, normalizes nested children and namespaces node IDs. It dispatches actions to the owning adapter and supports state, hierarchy, activity and refresh.
- `memory-graph.js` already traverses registered definitions into app roots, nodes and edges during graph construction. The mapper must reuse that path.
- Gmail and Code Space define their app structures and handlers in their own adapter files.
- Memory and standalone Settings retain special construction/interaction paths; they are not both registered through the same generic contract.
- Missing: a supported reusable definition input/loader, strict validation and action binding, and proof that another app/site can be mapped without custom graph code.
- Runtime addition/removal of whole apps is not established by the registry's current registration method. Plan bootstrap registration first and inspect lifecycle before promising hot import.

## Working behavior to preserve

Memory titled groups and inspectors work. Inspector unpin and group deletion pass the visible satellite position to the canonical memory node before detach, using the draw-only path. They must not recenter the graph or wake unrelated physics.

Memory root x/y/vx/vy survive legitimate rebuilds. Deliberate root drag saves normalized x/y in the graph-layout store; fresh launch fallback is 50% canvas width / 22% height. These invariants were visually verified in the 31 August ledger; no new browser verification is claimed for this docs update.

Gmail has mapped account/settings controls, live counts and bounded mailbox children. Background refresh preserves last-known state across transient failures. The source requests `gmail.readonly` and supports read-only bodies, but existing metadata-only tokens need explicit reauthorization. Current token state has not been rechecked here.

Generic activity uses the existing blue/purple pulse path. EMAIL activity converges on Inbox and acknowledgement clears it. Keep that behavior; pulse expansion is not part of the mapper milestone.

Code Space is a registered adapter. Projects/files use bounded local read-only routes. `codex.open` embeds the existing Code Space service at `http://127.0.0.1:8090/` in the fixed detail overlay. Jobs/Git/Terminal include status-only or unconnected capabilities; do not describe them as executable controls.

## Verification still outstanding

The previous ledger leaves Code Space placement, repeated overlay open/close, drag/expand/collapse and cluster isolation for browser verification. Some Gmail body/activity checks also depend on the user's local service/account. Use these as regression checks during a functional patch, not as reasons to restart graphics design.

## Locations and protected state

- Working project: `E:\WIZZ-Server\new-version\universal-space`; test URL: `http://127.0.0.1:4173`.
- Protected original: `E:\WIZZ-Server\new-version\memory-app-visual-lab\memory-app`. Do not modify.
- Gmail secrets: `E:\WIZZ-Server\secrets\universal-space-gmail`. Never print or copy into source/backups.
- See [the operations record](docs/operations/UNIVERSAL_SPACE_LOCATIONS_AND_BASELINE_2026-09-01.md) for historical folder locations. Existing backups are not automatic backup destinations.

## Next-session entry

Read `AGENTS.md`, follow its reading order, and continue the unchecked milestone in `docs/APP_CLUSTER_MAPPER_PLAN.md`. Record actual implementation and test results in `UNIVERSAL_SPACE_LEDGER.md`. Do not infer completion from old checkmarks or chat memory.
