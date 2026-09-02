# Universal Space Handoff

## Core rule

- ONE universe
- ONE canonical graph
- ONE solver
- ONE renderer
- MULTIPLE app gravity wells

## Current clusters

- Memory
- Settings
- Email
- Code Space

## Memory

- Titled/group nodes and group inspector working.
- Contained memories are readable.
- Inspector unpin and group delete hand off each released member's visible satellite position to its canonical node; neither path rebuilds/recentres the graph.
- `MemoryGraph.redraw` / manual-gravity `redrawOnly()` provide the non-destructive draw path for those operations.
- Live Memory-root x/y/vx/vy survive legitimate rebuilds. A deliberate blue-root drag saves normalized x/y only; startup restores it before Memory/group layout. Fresh layout fallback is 50% x / 22% y of the graph canvas.
- Root and drag physics are stable.

## Universal App Adapter

- Generic adapter contract implemented.
- Nested expandable nodes implemented.
- Actions dispatch through the owning adapter.
- Graph code contains no Gmail-specific logic.
- Code Space is registered through the same contract with bounded local read-only capabilities.

## Gmail

- OAuth flow now requests `gmail.readonly`; the existing metadata-only token is detected and requires explicit reauthorization for bodies.
- Inbox, Unread and Drafts use live state.
- Inbox headers are readable. A single-message read-only body route and inspector rendering are implemented; body access awaits reauthorization.
- Settings/Gmail account controls are mapped.
- Background polling updates state without page reload.
- Expired-token refresh now retries Gmail requests once and transient summary failures preserve the last known counts/activity.
- Code Space `codex.open` embeds the existing local Code Space wrapper at `http://127.0.0.1:8090/` in the Universal Space detail panel; no Code Space source was modified. Browser visual verification remains pending.
- Corrected the Code Space iframe to use the existing fixed `detail-overlay` mode so it no longer participates in graph grid sizing; browser repeated open/close verification remains pending.
- Manual group gravity no longer injects velocity into ordinary canonical Memory nodes; group-body drag/settling paths remain intact. Browser movement verification is pending.
- Inspector unpin now hands the visible grouped satellite position to its canonical node before detaching, without rebuilding the graph. Browser verification is pending.

## Live activity

- Generic per-node activity state.
- Existing blue neural pulse path is reused.
- Purple means external/unacknowledged activity.
- Purple pulses start across EMAIL outer nodes and converge toward Inbox.
- Inbox acknowledgement clears the activity.
- Incoming Gmail activity can trigger this automatically without browser refresh.

## Latest approved bank

`E:\WIZZ-Server\new-version\backupbranches\universal-space_2026-08-30_live-gmail-purple-activity`

## Protected original

`E:\WIZZ-Server\new-version\memory-app-visual-lab\memory-app`

NEVER MODIFY.

## Gmail secrets

`E:\WIZZ-Server\secrets\universal-space-gmail`

NEVER COPY INTO PROJECT OR BACKUPS.

## Development rules

- LOCAL ONLY.
- NO GitHub unless explicitly requested.
- Make the smallest patch.
- Do not rebuild the engine or casually change physics.
- Visually test before continuing.
- Ask “bank this one?” at important approved milestones.

## Immediate next direction

Continue proving the generic adapter model with real app capabilities. Code Space adapter registration and bounded local routes are implemented; browser visual placement/interaction still needs testing. Do not build the API/OpenAPI/MCP/DOM auto-scanner unless explicitly requested.

## Next-session entry

Read `UNIVERSAL_SPACE_HANDOFF.md` first, then `UNIVERSAL_SPACE_LEDGER.md`. Do not rely on old chat context.
