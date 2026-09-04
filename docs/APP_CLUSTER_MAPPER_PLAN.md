# Universal Product Push

Updated: 4 September 2026.
Status: the sole active implementation checklist for `molecular-v2`.

Universal Space itself is the product. The existing connector organism, canonical graph builder, Bridge/Supervisor integration, and app adapters remain the foundation for this phase.

## Active order

- [ ] 1. Cluster/button cleanup
- [ ] 2. Three-decision Memory -> Office -> Code Space workflow
- [ ] 3. Pulses/activity visibility
- [ ] 4. Orb V1
- [ ] 5. Connect-device/onboarding cleanup
- [ ] 6. Startup/install cleanup
- [ ] 7. Friend test
- [ ] 8. Release safety check
- [ ] 9. Later visual decoration: node glow/scale + Orb glow

## Product boundaries

- Keep the current connector organism, canonical graph builder, renderer and physics. Do not create a second graph generator or restart neural connector work.
- Memory and standalone Settings retain their established construction and interaction paths. Gmail and Code Space remain registered adapters.
- Generated app/control nodes remain outside durable Memory records, exports, counts, AI context, Bridge payloads and proposals.
- Office records are inspector data, not graph topology. Office decides the job; Code Space enforces the job.
- Manual Office Memory collection remains manual. Do not restore background collection.

## Orb V1

Orb lives in Universal Space. It may travel/focus along existing neural paths, inspect visible cluster/node state, answer short navigation questions such as “where is X?”, open or expand the relevant panel, highlight the exact node or button, explain briefly, and follow visible activity.

Orb must not execute jobs, approve actions, modify files, send messages, bypass permissions, or run arbitrary shell/terminal commands.

## Later visual decoration

After the first-user workflow is proven, decorate the existing system selectively: soft blurred/glowing backlight behind important nodes, selectively larger important nodes, Orb-specific coloured glow/backlight, and selection/activity polish. Do not introduce trunk, tissue or spine redesign unless an existing component is actually broken.

## Completed history: app-cluster mapper

The structured app/site definition -> validation -> explicit adapter binding -> existing canonical graph-builder work was the previous active queue. It is retained as completed architecture/history, not an active competing checklist.

- [x] Reused `UniversalAppAdapters` and the existing canonical graph traversal for registered definitions.
- [x] Added the bounded schema-v1 loader/factory with explicit handlers, validation and duplicate protection.
- [x] Proved a second loader-backed OFFICE definition with fixed topology, bounded Office inspector data and an explicit-click Memory collection route.
- [x] Kept Memory/Settings special paths and Gmail/Code Space adapter ownership intact.

The completed implementation includes strict bounded definition validation, duplicate protection and fixed OFFICE topology; outstanding normal-reload, interaction and browser-console evidence remains useful regression context for this Product Push. It is not a reason to resume mapper expansion or runtime app discovery.
