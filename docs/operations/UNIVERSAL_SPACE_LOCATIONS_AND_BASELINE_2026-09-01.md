# Universal Space — locations and restored baseline

Recorded: 1 September 2026. Updated: 2 September 2026.
Policy: [UNIVERSAL_SPACE_RULES.txt](../../UNIVERSAL_SPACE_RULES.txt).

## Current accepted application baseline — 2 September 2026

- The user restored their solid local version and published application commit `0027fcf53a577d4126a1be96b30255b29ccf2178` on `molecular-v2`.
- User terminal evidence: working folder `E:\WIZZ-Server\new-version\universal-space`; final status `## molecular-v2...origin/molecular-v2` with no dirty/untracked entries.
- The initial local snapshot was committed as `0214ede` on `restored-solid-20260902`. The first upload attempt stopped on an invalid/missing `origin`; the resumed attempt successfully pushed `7cf1e9c..0027fcf`.
- GitHub was independently checked at the restored commit. The upload targeted only `molecular-v2`.
- Earlier `4694b41` visual acceptance and renderer-version notes are superseded as the active baseline. Prior reconciliation details remain in Git history.
- The active milestone is the [app adapter / cluster mapper](../APP_CLUSTER_MAPPER_PLAN.md). The user has stopped centre-node graphics refinement.
- A documentation push does not prove the HP has pulled it, that files were cleaned on Windows, or that the mapper is implemented. No fresh HP/browser/FPS check is claimed here.

## Required arrangement

| Item | Role |
| --- | --- |
| Repository | https://github.com/999nike/memory-app |
| main | Frozen conventional interface; do not modify |
| molecular-v2 | Active spatial development branch |
| E:\WIZZ-Server\new-version\universal-space | Sole working spatial project |
| http://127.0.0.1:4173 | HP Universal Space test address |
| http://127.0.0.1:8090/ | Separate Code Space service used by the embed |

“Main folder” means the project directory, not the Git branch.

## Historical folder map — not a fresh filesystem audit

Paths below are under `E:\WIZZ-Server\new-version` unless stated otherwise.

| Folder | Last reported role | Disposition |
| --- | --- | --- |
| universal-space | Restored spatial application, server.mjs on 4173 | Only working project |
| universal-space-molecular-v2-bank | Linked worktree; previously reported detached at 9535bc9 | Unique work/retirement not reviewed |
| molecular-v2-publish | Separate clone, not serving 4173 | Unique work/retirement not reviewed |
| memory-app-visual-lab/memory-app | Protected original | Do not modify |
| backupbranches | Existing named snapshots | No automatic backups or blanket deletion |
| universal-space-prototype | Separate prototype | Retain pending use/unique-content evidence |
| E:\WIZZ-Server\workspaces\code-space | Separate service on 8090 | Used by the Code Space embed |
| E:\junkz backup | User's private backup | Do not inspect or modify without their instruction |

No folders, local branches, worktrees or runtime files are retired by this documentation cleanup.

## Maintained document locations

- Root `AGENTS.md`: entry point and reading order.
- Root `UNIVERSAL_SPACE_RULES.txt`: authoritative project policy.
- Root `UNIVERSAL_SPACE_HANDOFF.md`: current behavior and immediate task.
- `docs/APP_CLUSTER_MAPPER_PLAN.md`: sole active implementation checklist.
- Root `UNIVERSAL_SPACE_LEDGER.md`: current checkpoint and factual history.
- This file: dated restoration evidence and historical folder map.

The superseded graphics/prototype documents are removed, not moved into another work queue. Runtime renderer modules and the original image remain in place; file presence does not mean a module is loaded or that visual work is active.
