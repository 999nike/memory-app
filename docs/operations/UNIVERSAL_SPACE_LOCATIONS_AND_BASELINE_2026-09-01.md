# Universal Space — locations and restored baseline

Recorded: 1 September 2026. Policy: see the root [UNIVERSAL_SPACE_RULES.txt](../../UNIVERSAL_SPACE_RULES.txt).

This record distinguishes user/local-Codex reports from GitHub checks. No Windows filesystem or browser access is claimed by this documentation publication.

## Required arrangement

| Item | Required role |
| --- | --- |
| Repository | https://github.com/999nike/memory-app |
| main | Protected conventional interface |
| molecular-v2 | One active spatial development/testing branch |
| E:\WIZZ-Server\new-version\universal-space | Sole working spatial project; intended checkout of molecular-v2 |
| http://127.0.0.1:4173 | HP test address |

“Main folder” means the project directory, not the main branch.

## Current accepted baseline - 1 September 2026

- Exact application rollback commit: `4694b417c989b2ddd89a2c50e7849979a9c471b0` on `molecular-v2`.
- Latest user-provided terminal output confirms the approved working folder now checks out `molecular-v2`, tracks `origin/molecular-v2`, matches that commit and has no printed modified/untracked files.
- The user accepted the local visual result as the starting point toward the neural reference picture. See root `UNIVERSAL_SPACE_LEDGER.md` for the checkpoint.
- Restored pre-update work was preserved in the reported local stash and `restored-before-neural-update` tag. The linked bank worktree was reported detached at `9535bc9`.
- GitHub independently matched `4694b41` before the checkpoint documentation publication. Conventional `main` remains protected.
- This resolves the previously reported checkout/tracking mismatch; it does not retire extra folders or establish measured HP FPS.

## Historical local Codex reports - superseded by the current baseline above

- The user restored their own pre-experiment version and confirmed it works. No new FPS measurement is available.
- The primary worktree is universal-space, with .git inside it and HEAD on main; working files are dirty. This is the unresolved mismatch, not the intended setup.
- The linked bank worktree holds local molecular-v2. Its last audited commit was 9535bc9.
- No remotes were configured at the reconciliation audit. A subsequent local Codex pass restored origin to the repository above and fetched molecular-v2.
- That pass stopped with git cat-file reporting "unknown switch 'n'". No new commit or push was completed in that pass.
- Local snapshot c41c2dbe1bf0b799dc5548836b733ae2de17709a was reported as unreachable, with parent a1012f2c954a479467cb432bb3b788ff417d6d87. Its tree must be compared with the current app before use.
- Source inspection reports restored Scaffold V2 plus Flow, Width and legacy visuals as connector paths. It found no loaders for the later experiment overlays. The browser runtime failed to launch: live canvases, active callbacks and visual trunk ownership remain unverified.
- File availability over HTTP does not itself mean a browser loaded or executed that file.

## Folder map

Paths below are under E:\WIZZ-Server\new-version unless stated otherwise.

| Folder | Reported role / evidence | Disposition |
| --- | --- | --- |
| universal-space | Active server.mjs on port 4173, restored working spatial files | Only working project |
| universal-space-molecular-v2-bank | Linked worktree sharing universal-space/.git; latest user output shows detached HEAD at 9535bc9 | Unique work/retirement not reviewed; do not delete directly |
| molecular-v2-publish | Separate clone on molecular-v2; not serving 4173 | Unique work and retirement still unresolved |
| memory-app-visual-lab/memory-app | Protected original per existing handoff; dirty memory-graph.js | Do not modify |
| backupbranches | Existing named snapshots; no Git metadata reported | No automatic backup creation; contents not blanket-approved for deletion |
| universal-space-prototype | Separate Node project with src/tests/package.json; default port 4173, no active listener attributed | Retain pending use/unique-content evidence |
| E:\WIZZ-Server\workspaces\code-space | Separate server.js on 8090; used by the Code Space embed | Not a duplicate Universal Space server; leave it running |
| E:\junkz backup | User-controlled personal backup | Do not inspect, search, modify or use automatically |

E:\junkz is not the protected path; local Codex reports it does not exist.

## Historical remote state before the earlier documentation publication

Immediately before this documentation change, GitHub molecular-v2 pointed to a1012f2c954a479467cb432bb3b788ff417d6d87. Its application code is the failed connector experiment, not the HP restoration.

GitHub main pointed to 8de6f6fcc713f756ac2985402c4e176acb6279ec. Its reference must remain unchanged by this task.

The documentation commit does not upload the restored app, fix the local branch, clean folders or establish that the HP has received these documents. Any later restored snapshot must retain the new documentation and use the actual current remote head; do not push an older sibling commit or discard these files.

## Document locations

- Root UNIVERSAL_SPACE_RULES.txt: authoritative branch, path and hygiene policy.
- Root AGENTS.md: agent entry point into that policy and the actual handoff.
- Root UNIVERSAL_SPACE_HANDOFF.md and UNIVERSAL_SPACE_LEDGER.md: existing application handoff/history, not relocated in this task.
- Root NEURAL_UI_WORK.txt: failed experiment history; its old patch checklist is not an instruction to restore that stack.
- docs/research/NEURAL_CONNECTOR_RESEARCH_PLAN.md: sourced proposal, not a built connector.
- This file: folder map and dated reported state.

Local Codex did not locate the earlier downloaded research plan in its searches, despite the user reporting it was saved. This publication gives it an explicit repository path without requiring another manual download.

## Cleanup remains pending

Required untracked adapters are not junk. Trace HTML, dynamic loaders, imports, server routes, launchers and external users before classifying candidates. Keep UNKNOWN items as outstanding work, not proof of safe deletion.

The previously proposed documentation moves have not run. Preserve filenames, update links and agent entry paths in the same change, and verify the app afterward. Do not relocate runtime files as housekeeping. No new backups, project copies or worktrees.

The current-baseline section records the subsequently completed branch alignment and user acceptance. Folder cleanup remains pending; successful Git reconciliation does not imply the extra directories have been retired.
