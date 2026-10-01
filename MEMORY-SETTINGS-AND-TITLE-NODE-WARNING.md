# Memory Settings and Title Node Warning

These two graph systems are easy to confuse. They are separate code paths.

## Memory Settings

- Definition / hierarchy: `molecular-view.js` → `SETTINGS_CONTROLS`
- Root node: `id: 'settings'` / label `Memory Settings`
- Runtime graph / physics / home-return handling: `memory-graph.js`
- Key areas: `presentationControlNodes`, `registerPresentationControls()`, `buildPresentationControlNodes()`, `captureHomeTargets()`

## Titled manual group node

- Group creation / title data / title interaction: `memory-graph-manual-groups.js`
- Canonical titled graph node, members, gravity and home-return handling: `memory-graph-manual-gravity.js`
- Canonical marker: `__manualGroupCanonical`

## Warning

Do not treat Memory Settings and titled manual groups as the same node system.

When changing the shared graph motion, both must still follow the same intended phase:

**free gravity → 10 s idle → 5 s smooth return to the original neat home layout.**

Do not overwrite their original home targets with positions reached during the gravity phase.
