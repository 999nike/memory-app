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
- ChatGPT — OAuth/DCR connection and live grant verified; Memory Space automatically published the current 11-memory Space, but direct MCP tool execution is not verified on this Plus account because ChatGPT exposed no connector actions after authorization
- cross-provider portability — one AI's human-approved memory was read by another provider
- **8 Aug 2026 automatic V1 loop proof** — Grok received the current Space without manual Share, proposed `V1 automatic inbox test`, Memory Space surfaced it without manual Check/Pull, the human approved it, automatic sync republished the confirmed state, and Grok read the approved memory back as `status: confirmed`
- **8 Aug 2026 restart recovery proof** — the encrypted OAuth state file was created locally, the bridge was stopped and started again, startup restored `access=1 refresh=1`, Grok remained connected without Reauth, and Memory Space automatically republished the active Space with 11 confirmed memories into bridge RAM

Cursor's final proposal/read-back proof remains a useful regression test, but is not a blocker for beginning productisation; its read session ended because the Cursor account hit its Agent usage limit, not because Memory Space failed.

### ChatGPT compatibility proof — 8 Aug 2026

ChatGPT was added as a custom Memory Space connector using the same public MCP endpoint:

`https://bridge.w-i-z-z-lab-studios.com/mcp`

The first Dynamic Client Registration attempt failed with:

`One or more OAuth redirect_uris are not allowed`

For the live compatibility test, the bridge redirect-host configuration was expanded to include `chatgpt.com` and `openai.com`. ChatGPT then completed the real OAuth path:

- protected-resource and authorization-server discovery succeeded
- a `memory-space-dcr-*` client was dynamically registered with a `chatgpt.com` redirect
- consent was approved
- authorization-code token exchange succeeded with PKCE
- an access token and refresh token were issued
- after restart, bridge state reported one dynamic client and two live access/refresh grants across the authorised clients
- Memory Space AI Access visibly showed `ChatGPT` as `CONNECTED` with `Read ✓ · Propose ✓`
- automatic authorised sharing published `space_memory_app` with **11 confirmed memories** into bridge RAM

This is a real ChatGPT OAuth connection to Memory Space. It is **not** yet a verified ChatGPT MCP read/propose loop.

In the ChatGPT connector UI used for this test, the connector details still showed `No app actions available yet`, refresh returned `Couldn't refresh connector`, and asking ChatGPT to read the Space did not produce an MCP tool call; ChatGPT instead fell back to previously stored Personal Context. The ChatGPT product note shown during the test stated that full MCP support was rolling out in beta to Business, Enterprise and Edu plans. The account used for this test is Plus.

Therefore the factual status is:

**ChatGPT — OAuth/DCR CONNECTED; live Memory Space grant + 11-memory publication VERIFIED; ChatGPT MCP tool read/propose NOT VERIFIED on the current Plus account.**

Do not treat this as a Memory Bridge OAuth failure, and do not count ChatGPT as a full-loop provider until ChatGPT actually exposes and calls the MCP tools. Retest on an eligible ChatGPT plan or when the product surface changes.

The `chatgpt.com` / `openai.com` redirect-host allowance used for this test was process configuration, not yet a durable product configuration. Bank that cleanup for supported ChatGPT productisation rather than hard-coding provider-specific behaviour prematurely.

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

Status: **implemented and end-to-end verified with Grok.**

The product no longer needs the user to understand `Share` or manually press `Check proposals` in the normal flow:

- the browser checks whether an external AI really has a live OAuth grant
- only while an external AI is authorised, the active Space's current confirmed memories are refreshed into bridge RAM automatically
- workspace edits are detected and republished without a manual Share step
- returning to the app forces a refresh, which also removes the small stale AI Access state seen after external authorization
- the External AI inbox checks the bridge automatically and surfaces new proposals for human review
- proposal approval remains a human action; automatic sync does not auto-approve durable memory
- verified round trip: external proposal -> automatic inbox -> human Approve -> automatic republish -> same external AI reads the memory back as confirmed

The old Share/Pull controls may remain under Advanced as diagnostics/fallback while V1 stabilises, but they are no longer intended as customer workflow.

Remaining work in this area:

- express re-authentication as `Reconnect`, not as OAuth/provider diagnostics
- reduce the remaining provider-side setup instructions further where provider UX permits

### 5. Revoke correctly

Status: **implemented and verified with a live Grok OAuth grant.**

Disconnect invalidates the provider's actual OAuth access instead of merely hiding a UI card.

Permissions remain per Space as a product goal and individual MCP tool scope enforcement remains to be completed. Current OAuth grants expose `memory.read` and `memory.propose` scope state to AI Access.

### 6. Persistence and recovery

Status: **bridge OAuth restart recovery implemented and verified. Browser workspace remains the durable source of truth.**

Verified now:

- browser-held Memory Space remains the source of truth; Memory Space contents are not persisted in the bridge OAuth file
- OAuth client/access/refresh recovery state is encrypted locally at rest
- a bridge restart restored a live Grok access token and refresh token without Reauth
- after restart, the browser automatically republished the active 11-memory Space back into bridge RAM
- current published Space snapshots and pending external proposals remain intentionally RAM-only

Remaining V1 work:

- make the bridge start/recover automatically so a normal user never needs PowerShell
- keep versioned export/import reliable and regression-tested
- move production browser persistence toward IndexedDB + versioned migrations before users trust it with years of data

## Current V1 position — 8 Aug 2026

The core product loop is now working rather than merely prototyped:

```text
Open / install Memory Space
    -> use durable local Space
    -> connect external AI
    -> AI reads current confirmed memory
    -> AI proposes durable memory
    -> proposal appears automatically
    -> human Approve / Edit / Reject
    -> approved state republishes automatically
    -> external AI reads the new confirmed truth
    -> bridge can restart without losing the authorised AI grant
```

The next productisation focus is no longer MCP interoperability. It is removing the remaining technical setup around the companion runtime and making the first-use/install path simple enough for a non-technical user.

Near-term priorities:

1. bridge auto-start / no PowerShell in normal use
2. in-app `Install Memory Space` experience where the browser supports it
3. simplify Private Access Code / companion setup language
4. persistence hardening and recovery UX
5. stranger test

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
