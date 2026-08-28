# Unify Folder Physics Patch

Branch goal: make manually-created folder/title nodes behave like normal Memory Graph nodes without changing the mobile layout/gesture implementation.

## Patch checklist

- [x] Preserve current `main` as a recovery point.
- [x] Keep `memory-graph-mobile.js` unchanged.
- [x] Make folder bodies use the normal memory gravity/repulsion/damping constants.
- [x] Remove permanent “drop position becomes target orbit” behaviour.
- [x] Keep grouped member memories out of the hidden normal-memory physics simulation while they are represented as folder satellites.
- [x] Wake/continue folder settling after drag so gravity actually resumes on phone and desktop.
- [x] Restart the normal memory solver after folder drag so nearby normal memories react too.
- [x] Keep neural connector geometry synchronized while folder bodies move.
- [x] Render folder neural connectors with the same full-strength scaffold geometry as normal memories.
- [x] Render folder pulse lights with the same full-strength flow settings as normal memories.
- [x] Verify branch diff contains no storage-schema, bridge/provider, proposal-rule, or mobile-gesture changes.
- [ ] Test on HP desktop and phone before merging to `main`.
- [ ] Merge only after visual/interaction test passes.

## Recovery

Base commit before this patch: `cf5328e5c8cba0bf2cb9f6c25251f4669beaf661`.
Recovery branch: `backup/pre-unified-folder-physics-2026-08-28`.
Draft PR: `#1` — `Unify folder physics with normal memory graph`.
