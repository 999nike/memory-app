# Unify Folder Physics Patch

Branch goal: make manually-created folder/title nodes behave like normal Memory Graph nodes without changing the mobile layout/gesture implementation.

## Patch checklist

- [ ] Preserve current `main` as a recovery point.
- [ ] Keep `memory-graph-mobile.js` unchanged.
- [ ] Make folder bodies use the normal memory gravity/repulsion/damping constants.
- [ ] Remove permanent “drop position becomes target orbit” behaviour.
- [ ] Keep grouped member memories out of the hidden normal-memory physics simulation while they are represented as folder satellites.
- [ ] Wake/continue folder settling after drag so gravity actually resumes on phone and desktop.
- [ ] Keep neural connector geometry synchronized while folder bodies move.
- [ ] Render folder neural connectors with the same full-strength scaffold geometry as normal memories.
- [ ] Render folder pulse lights with the same full-strength flow settings as normal memories.
- [ ] Verify no changes to storage schema, bridge/provider code, proposal rules, or mobile gesture code.
- [ ] Test on HP desktop and phone before merging to `main`.

## Recovery

Base commit before this patch: `cf5328e5c8cba0bf2cb9f6c25251f4669beaf661`.
