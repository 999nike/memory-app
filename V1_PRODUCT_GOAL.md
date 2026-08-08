# V1 Product Goal

This file defines the current productisation target for Memory Space. It is deliberately narrower than the long-term roadmap.

## Acceptance test

A completely non-technical person should be able to open Memory Space for the first time and, without developer help:

1. create a Space
2. add a memory
3. connect one supported AI
4. ask that AI something using the Space
5. receive a memory proposal
6. approve, edit or reject it
7. disconnect/revoke the AI
8. close the app
9. return later and find their workspace intact

They should not need to see or understand:

- MCP URLs
- OAuth / PKCE / DCR terminology
- pairing tokens
- bearer tokens
- Node / PowerShell
- Cloudflare Tunnel details
- raw bridge diagnostics

The intended normal-user path is:

```text
Open Memory Space
    -> Create Space
    -> Add first memory
    -> Connect AI
    -> Authorize
    -> Connected
    -> Use AI
    -> Review proposal
    -> Approve / Edit / Reject
    -> Disconnect when wanted
```

## Current proof behind V1

The interoperability layer is already proven strongly enough to stop chasing provider count:

- Grok — full read -> propose -> human approval -> read-back loop verified
- Mistral — full loop verified
- Claude — full loop verified
- Cursor — OAuth/DCR connected, 7 tools discovered, real 10-memory Space read verified
- cross-provider portability — one AI's human-approved memory was read by another provider

Cursor's final proposal/read-back proof remains a useful regression test, but is not a blocker for beginning productisation; its read session ended because the Cursor account hit its Agent usage limit, not because Memory Space failed.

## V1 work order

### 1. First-run experience

Status: **implemented for the current browser build.**

- fresh browser must not receive developer/sample project memories
- show a plain-language welcome screen
- create a blank first Space
- explain the three trust rules in normal language
- incomplete onboarding must resume after refresh
- existing workspaces must not be modified

### 2. Add memory

- make the first memory obvious
- keep title + content as the primary action
- move classification/provenance controls out of the way unless needed
- confirmation should be immediate and visible

### 3. AI Access

Status: **product surface implemented; live OAuth grant visibility/revoke implemented and verified with Grok.**

The normal-user control surface now replaces the old provider-first controls with `AI Access`. It shows the current Space, in-app AI choices, compatible external AI apps and keeps raw connection setup under Advanced.

For a bridge running the current code, External AI Access reads the bridge's real OAuth grant state instead of inventing provider badges. Each live client can show:

```text
Claude    Connected    Read ✓   Propose ✓   Disconnect
Cursor    Connected    Read ✓   Propose ✓   Disconnect
```

`Disconnect` revokes that client's outstanding OAuth authorization codes, access tokens and refresh tokens. Dynamic registration is retained so the same client can request authorization again later instead of being permanently broken.

Normal user language remains:

```text
Connect AI -> Authorize -> Connected
```

Developer details remain available only under Advanced / Developer.

### 4. Remove manual bridge chores from the core loop

Status: **automatic authorised-space sync and automatic external proposal inbox are now wired in the browser build.**

The product no longer needs the user to understand `Share` or manually press `Check proposals` in the normal flow:

- the browser checks whether an external AI really has a live OAuth grant
- only while an external AI is authorised, the active Space's current confirmed memories are refreshed into bridge RAM automatically
- workspace edits are detected and republished without a manual Share step
- returning to the app forces a refresh, which also removes the small stale AI Access state seen after external authorization
- the External AI inbox checks the bridge automatically and surfaces new proposals for human review
- proposal approval remains a human action; automatic sync does not auto-approve durable memory

The old Share/Pull controls may remain under Advanced as diagnostics/fallback while V1 stabilises, but they are no longer intended as customer workflow.

Remaining work in this area:

- express re-authentication as `Reconnect`, not as OAuth/provider diagnostics
- reduce the remaining provider-side setup instructions further where provider UX permits

### 5. Revoke correctly

Status: **implemented and verified with a live Grok OAuth grant.**

Disconnect invalidates the provider's actual OAuth access instead of merely hiding a UI card.

Permissions remain per Space as a product goal and individual MCP tool scope enforcement remains to be completed. Current OAuth grants expose `memory.read` and `memory.propose` scope state to AI Access.

### 6. Persistence and recovery

A normal user must be able to leave and come back.

Required:

- browser workspace survives normal close/reopen
- versioned export/import remains reliable
- bridge runtime becomes persistent/recoverable without PowerShell
- production path moves toward IndexedDB/versioned migrations before users trust it with years of data

### 7. Stranger test

Give a new person only the app URL and this instruction:

> Make yourself an AI memory and connect your AI to it.

Do not explain the interface. Every question they need to ask exposes a remaining product problem.

## Explicitly postponed

Do not distract V1 with:

- more providers for provider-count's sake
- Code Space / repo access
- banking integrations
- autonomous memory rewriting
- vector search unless current retrieval demonstrates a real limitation
- large-scale AI memory housekeeping

Those remain future bolt-ons or V2+ work.

## Future large-memory direction

When Spaces reach hundreds or thousands of memories, organisation should not become a manual filing job. A future Memory Librarian may suggest:

- duplicates to merge
- older decisions superseded by newer decisions
- contradictions needing review
- inactive material to archive
- related memories to group

The AI may prepare housekeeping, but the human remains the approval boundary. It must not silently rewrite durable truth.
