# Universal Space — app adapter and cluster mapper

Updated: 2 September 2026.
Status: active plan; Milestone 1 is implemented and Milestone 2 is implemented in the working trees, with browser interaction/regression verification still outstanding because the local browser-control runtime is unavailable.
Application baseline: `0027fcf53a577d4126a1be96b30255b29ccf2178`.

## Product outcome

Give Universal Space a structured description of an app, its settings or a site's supported navigation/actions. It creates that app's cluster in the existing universe. Adding another supported map should require a definition and capability bindings, not new graph or renderer code.

The full direction is: source description/discovery -> validated app definition -> adapter/action bindings -> existing graph builder -> app cluster. First prove the structured-definition part. Automatically discovering arbitrary websites or desktop settings requires source-specific access and is a later stage, not a claimed current capability.

The restored visuals are the accepted baseline. Centre nodes, connecting trunks, spine/tissue/fibres, glow and pulse redesign are out of scope. Keep the existing graph, solver, interaction model and rendering path.

## What the restored source already does

| Area | Present implementation | Remaining work |
| --- | --- | --- |
| Definition contract | `universal-app-adapters.js` accepts id/name/nodes, recursively normalizes children and namespaces node IDs | Supported versioned input and strict validation |
| Cluster construction | `memory-graph.js` builds app roots, parent-child nodes and edges from registered definitions | Reuse this traversal; do not duplicate it |
| Actions and views | Action/view keys pass through nodes; dispatch calls the owning adapter's `handleAction` | Reusable factory with explicit supported bindings |
| State and hierarchy | Existing update and child-replacement events | Preserve app ownership and existing behavior |
| Lifecycle | Definitions are consumed during graph construction; registration alone emits no whole-app insertion event | Register before initial graph construction in the first milestone |
| Existing apps | Gmail and Code Space register adapters; Memory/standalone Settings use established special paths | Keep all four working; do not force a Memory/Settings migration |

Do not claim the entire graph file is free of app-specific logic. Do not use “85–90% complete” or a fixed patch count as implementation evidence.

## Definition contract for the first milestone

Use JSON-compatible data with a schema version, stable app ID, display name and nested nodes. Reuse existing node fields: id, label, children, expandable, action, view, state, stateKey, stateLabel and stateInLabel.

Proposed shape, to finalize against the existing normalizer:

```json
{
  "schemaVersion": 1,
  "id": "example-settings",
  "name": "Example Settings",
  "nodes": [
    {
      "id": "system",
      "label": "System",
      "children": [
        {
          "id": "system:display",
          "label": "Display",
          "action": "display.open",
          "view": "settings"
        },
        {
          "id": "system:sound",
          "label": "Sound",
          "action": "sound.open",
          "view": "settings"
        }
      ]
    },
    {
      "id": "network",
      "label": "Network",
      "children": [
        {
          "id": "network:wifi",
          "label": "WiFi",
          "action": "wifi.open",
          "view": "settings"
        }
      ]
    }
  ]
}
```

This is a structural example, not a Windows integration. Bind every action to a real supported handler or explicitly show an unavailable capability. Do not imply that generating a node gives access to OS settings, an authenticated site or a service API.

Important contract details:

- Require stable IDs; do not derive identity only from labels or sibling positions. Reject duplicate normalized IDs and collisions with existing app roots/nodes, including Memory and Settings.
- Validate the complete definition before registering anything. Reject unsupported versions, invalid node/children types, missing IDs and excessive size/depth. Start with explicit bounds such as 200 nodes and 8 levels; revisit only after measured need.
- `normalizeNode` currently keeps only known fields. URLs, parameters and source metadata must live in an explicitly validated binding table or supported state, or receive a deliberate contract extension. Do not silently drop them.
- Definitions contain data, not JavaScript, eval strings, shell commands, arbitrary HTML or arbitrary endpoint execution.
- Action IDs resolve through an explicit handler map owned by the generated adapter. A view name alone does not create an inspector.
- Render labels/content as text or escaped content. For navigation bindings, validate supported URL schemes/targets and activate only on the user's click.
- Keep missing/unsupported capabilities honest. Do not fabricate login, account access or successful actions.

## Milestone 1 — definition loader and adapter factory

- [x] Inspect the restored registry and recursive graph construction; identify existing integration points.
- [x] Audit initial loading order and action dispatch context before editing. The current HTML loads registry -> Gmail -> Code Space -> graph; preserve readiness when adding definition input.
- [x] Add the smallest reusable loader/validator and factory around the existing registry. Prefer one small module and a bounded definition source.
- [x] Accept the versioned definition plus an explicit capability/handler map. Produce the adapter object expected by `registerAppAdapter`.
- [x] Validate before mutation and report useful errors. Reject duplicate app registration instead of silently replacing an existing working adapter.
- [x] Load one real or clearly labelled demonstration definition before initial graph construction. Use the existing roots/edges/expand-collapse/inspector paths.
- [x] Keep registration/bootstrap reliable if loading fails; the existing four clusters must still initialize.
- [x] Check nested mapping, stable namespaced IDs, malformed/duplicate input and owning-adapter action dispatch. Use focused checks; do not build a general test platform.

Done when: a definition loaded through the new entry point generates the correct nested cluster and invokes its bound actions, while invalid input adds no partial cluster and leaves working apps intact.

Implementation evidence, 2 September 2026: `app-definition-loader.js` loads a schema-v1 `SETTINGS DEMO` definition after Gmail and Code Space and before the unchanged canonical graph builder. Focused isolated checks passed for recursive namespacing, handler dispatch, size/depth/type/version validation, Memory/Settings and registered-node collisions, atomic rejection and duplicate registration. A bootstrap-order check retained Gmail and Code Space registrations, and the page/new asset returned HTTP 200. Pointer-driven/browser-console verification was attempted but not completed because the local browser-control runtime could not start (`windows sandbox failed: helper_unknown_error: setup refresh had errors`); no browser result is claimed.

## Milestone 2 — prove reuse with another app/site map

- [x] Add a second definition through the same loader/factory without custom graph, solver or renderer changes.
- [x] Use real supported app/site navigation or existing local read-only capabilities. The second map is OFFICE: a strict-origin, hidden-iframe bridge reads only bounded local Office data; `Open Office` and `New Job` remain explicit user-click actions.
- [ ] Demonstrate changing a category/action in data changes the generated cluster after a normal reload. No per-app graph code should be necessary.
- [ ] Verify root dragging, nested expand/collapse and repeated inspector open/close. Confirm no duplicate nodes/edges on reload.
- [ ] Verify Memory group unpin/delete and saved Memory-root position, standalone Settings interaction, EMAIL acknowledgement and Code Space overlay behavior remain intact.
- [x] Record which checks ran locally and which need the user's HP/account. Record failures and unsupported capabilities without marking them complete.

Done when: two different maps use the same factory and existing engine, their supported actions work, and existing app behavior survives the regression check.

## Later stages after that proof

These remain the product direction, not prerequisites for the first working mapper:

1. A user-facing import/preview flow and saved app definitions, in a separate store from durable Memory data.
2. Add/update/remove app clusters at runtime with a deliberate lifecycle. Repeated changes must clean up owned listeners/activity/refresh state and preserve unaffected node positions. Do not hide a full graph rebuild behind import.
3. Map a specific supplied API/OpenAPI/MCP catalogue or site/settings structure into the same definition format. Use only capabilities actually available and authorized.
4. Review discovered categories/actions before enabling them. Dynamic or authenticated sites and desktop controls need their own access mechanism; a URL or screenshot alone is not an executable adapter.
5. Expand the library of supported app definitions and bindings.

## Working boundaries and evidence

Read `../UNIVERSAL_SPACE_RULES.txt` and `../UNIVERSAL_SPACE_HANDOFF.md`. Keep implementation on the intended spatial branch and working folder; preserve conventional main and protected originals.

New app/control nodes must not enter durable Memory records, counts, exports, AI context, Bridge payloads or proposals. Use existing permission boundaries and action dispatch. Do not add OAuth scopes, command execution or remote writes merely to populate a map.

Keep this as the only active checklist. After a functional patch, record changed files, focused checks, browser results and remaining limits in `../UNIVERSAL_SPACE_LEDGER.md`. The number of patches depends on the implementation evidence; no graphics acceptance gate is required.
