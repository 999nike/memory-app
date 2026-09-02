> **molecular-v2 — current direction, 2 September 2026:** Start at [AGENTS.md](AGENTS.md), then follow the [current handoff](UNIVERSAL_SPACE_HANDOFF.md) and [app adapter / cluster mapper plan](docs/APP_CLUSTER_MAPPER_PLAN.md). The restored application baseline is `0027fcf`. Centre-node graphics work is retired. The earlier V1/product history below is context, not this branch's next-work queue. Conventional `main` remains frozen.

# Memory App

A private, visible, long-term workspace that a human and AI systems build together.

**Core rule:** the AI can change. The workspace does not.

Memory Space is the user-owned source of truth. Models are replaceable workers that receive controlled access to the same workspace.

```text
Memory App / Memory Space
        |
        v
Memory Bridge
        |
        +-- Grok       VERIFIED FULL LOOP
        +-- Mistral    VERIFIED FULL LOOP
        +-- Claude     VERIFIED FULL LOOP
        +-- Cursor     CONNECTED / READ VERIFIED
        +-- ChatGPT    OAUTH CONNECTED / TOOLS NOT EXPOSED ON PLUS
        +-- Gemini
        +-- local models
        +-- VS Code / IDE agents
        +-- anything that speaks MCP
```

The goal is not a provider-specific memory plugin. It is one user-owned space that can be built over months or years and reused across different AI providers without rebuilding context from scratch.

The bigger architecture is deliberately broader than memory alone: Memory Space can become the trusted context and control layer underneath project workspaces, code sandboxes, files, tasks and multiple AI workers. That expansion is banked for later; the current product priority is to make the core Memory Space boringly easy, private and reliable.

---

# Living project ledger — 8 Aug 2026

This section is the handoff point for the next development chat. Read this before changing code. Keep it factual: build first, update the ledger after meaningful milestones.

## CURRENT PRODUCT GOAL — V1 normal-user loop

Provider interoperability is proven strongly enough. The next milestone is productisation, not adding more providers.

**V1 passes when a completely non-technical person can open Memory Space for the first time and, without developer help:**

1. create a Space
2. add some memory
3. connect one supported AI
4. ask that AI something using the Space
5. receive a memory proposal
6. approve, edit or reject it
7. disconnect/revoke the AI
8. close the app
9. return later and find their workspace intact

The normal user must not need to see or understand MCP URLs, OAuth/PKCE/DCR terminology, pairing tokens, bearer tokens, Node, PowerShell, Cloudflare Tunnel details or raw bridge diagnostics.

Target experience:

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

The detailed V1 checklist is tracked in `V1_PRODUCT_GOAL.md`.

### V1 implementation started — first-run onboarding

The first productisation slice is now defined as:

- a fresh browser must not receive the project's seeded developer memories
- create a blank private first Space instead
- show a plain-language welcome screen
- let the user name the Space and optionally describe its purpose
- explain only the user-facing trust rules: stored on this device, user approves lasting changes, AI can be connected later
- resume incomplete onboarding after refresh
- never show this onboarding over an existing stored workspace
- after setup, land on an empty-state action that says `Add first memory`

This slice deliberately does **not** redesign the provider/OAuth path in the same patch. The next product slice is the normal-user **AI Access** surface.

## MAJOR MILESTONE — clean new-customer setup reaches connected bridge

On **8 Aug 2026**, the normal-user onboarding and simplified Memory Bridge connection were tested from a fresh HP browser as a new customer rather than through the existing phone workspace.

The completed path was:

```text
Create Space
    -> Add first memory
    -> AI Access
    -> Set up external access
    -> Connect your Memory Bridge
    -> paste one Private Access Code
    -> Connected / In use
```

The test proved:

- a fresh browser could create a new private Space without the developer workspace being inserted
- the empty state led clearly to `Add first memory`
- AI Access led to the external connection flow without requiring the user to understand MCP or OAuth
- the original Windows `Memory Bridge Setup` helper copied a packaged `MSB1.` code for the single-owner path
- the bridge URL and original 64-character pairing token remained hidden from the normal-user path
- raw URL/token fields remained available only under `Advanced manual setup`

That earlier test was the clean onboarding proof. The later customer-isolation milestone below supersedes the old assumption that one shared bridge workspace was sufficient for unrelated customers.

One issue found during onboarding remains worth tracking: the first manually created memory (`My name`) was automatically classified as **Critical + Locked**. That default/classification behaviour should be corrected before calling the whole onboarding experience finished.

## MAJOR MILESTONE — customer-scoped bridge isolation implemented; fresh Claude customer full loop proven

On **8 Aug 2026**, the single shared bridge-workspace limitation was replaced on `main` by customer-scoped routing, deployed to the HP runtime, and exercised through a genuinely fresh customer browser plus a fresh Claude account.

Important merged commit:

- `ce5010d` — keep customer isolation regression on main

The bridge now supports customer-scoped routes of the form:

```text
https://bridge.w-i-z-z-lab-studios.com/c/<connectionId>
https://bridge.w-i-z-z-lab-studios.com/c/<connectionId>/mcp
```

Each isolated customer connection receives:

- a random `connectionId`
- a unique derived, revocable customer secret
- an `MSB2.` Private Access Code containing only that customer's scoped connection details
- a customer-specific OAuth issuer/namespace
- customer-specific OAuth state/tokens/clients
- a customer-specific RAM-only published workspace
- a customer-specific RAM-only proposal queue

The original 64-character bridge token remains an administrator/bootstrap secret. It is not handed to normal customers. The legacy root `/mcp` + `MSB1.` path remains for the existing owner/single-owner compatibility flow; new unrelated customers use the scoped `MSB2.` path.

The customer connection registry is encrypted at rest. Memory Space contents themselves remain outside that registry and are not persisted there.

### Automated isolation regression

The committed regression test creates separate NIKE and PLUMBER customer connections and verifies:

- separate workspace markers stay separate
- cross-customer search returns no other-customer data
- a token used against another customer's route is rejected
- revoking one customer connection does not revoke the other

That regression passed in CI on the merged `main` isolation build.

### Live fresh-customer Claude proof

A second-customer test was then performed using deliberately separate client state:

- HP Chrome **Incognito** rather than the existing owner browser state
- a new Space named `plummers memory`
- a fresh `MSB2.` customer connection
- a fresh Claude account using a separate email/account

Before Claude OAuth, the plumber Memory App showed no inherited external-AI authorisations. Claude was then configured against the plumber customer's scoped MCP URL and authorised using the same plumber `MSB2.` pairing credential.

Claude successfully invoked the real Memory Space integration and read exactly the plumber Space state:

- Space: `plummers memory`
- confirmed memory count: **1**
- memory content matched the plumber/kitchen-fitting/3D-model-work test memory

Claude then used `propose_memory`. The write did **not** become trusted memory automatically; it arrived as a pending external-AI proposal requiring explicit human approval.

**What this live test proves:** a fresh unrelated customer can now complete the scoped customer connection -> OAuth -> Memory Space read -> proposal path without inheriting the owner's existing browser/provider authorisations or reading the owner's current Space as the active customer workspace.

**Do not overclaim the final live regression yet:** the automated cross-customer/revocation regression is passing, but the final live external-account checks are still worth doing explicitly: ask plumber-Claude for an owner-only marker, ask the owner path for a plumber-only marker, then revoke the plumber connection and prove the owner remains operational. Record those as live-passed only after they are actually observed.

## MAJOR MILESTONE — Claude reauthorisation after autostart exposes future-provider callback rule

On **8 Aug 2026**, Claude was reauthorised successfully after the new Windows autostart/runtime setup exposed a configuration gap that could also affect future AI providers.

The visible symptom was that Claude still appeared as a previously connected AI, but clicking **Reconnect** failed before Claude's authorization screen opened. The bridge log proved the complete chain:

```text
old Claude refresh token attempted
    -> refresh rejected as invalid or expired
    -> Claude correctly attempted fresh Dynamic Client Registration
    -> registration rejected: One or more OAuth redirect_uris are not allowed
```

The bridge itself, the packaged customer connection, workspace publication and OAuth-state file were all present and working. The blocker was narrower: the installed runtime's `oauthRedirectHosts` allowed:

```text
grok.com,x.ai,chatgpt.com,openai.com
```

but omitted `claude.ai`. Existing grants and restored state had hidden that omission until Claude needed a completely fresh registration. This is why an AI can look connected after a restart yet fail later during reauthorisation.

The running HP configuration and the Windows autostart installer fallback were updated to include `claude.ai`.

Important commit:

- `e53ff7` — preserve Claude callback support in Windows autostart configuration

After restarting only the scheduled **Memory Space Bridge** task:

- Claude reached the bridge authorization screen
- the saved bridge pairing credential was accepted
- Claude connected again successfully
- Memory Space showed ChatGPT, Claude and Grok authorised
- the same restored state was visible from both the phone and PC views
- Mistral remained the only previously proven provider still awaiting reauthorisation in this specific post-autostart check

**Rule for every future AI integration:** do not treat a successful first connection or a restored-looking grant as sufficient. Record the provider's exact OAuth redirect URI/hostname during DCR testing, preserve it in both the installer default and the installed runtime configuration, then test all of:

1. first authorization
2. access-token use
3. refresh-token rotation/use
4. bridge restart
5. expired/invalid refresh-token fallback to fresh DCR
6. visible reconnection from each supported app/device view

When a future provider reports `One or more OAuth redirect_uris are not allowed`, inspect the bridge's DCR log and the provider's exact registered callback before patching. Add only the required HTTPS hostname or exact callback URI; do not disable redirect validation or use a wildcard.

Security distinction:

- `MSB1.` — legacy owner/single-owner packaged connection code
- `MSB2.` — customer-scoped connection package containing that customer's route/id/derived secret
- 64-character master bridge token — administrator/bootstrap secret; do not distribute to normal customers
- OAuth redirect-host allow-list — server policy controlling which external AI callbacks may dynamically register

These values have separate jobs and must not be substituted for one another.

## MAJOR MILESTONE — ChatGPT completes OAuth/DCR connection; Plus account does not expose MCP actions

On **8 Aug 2026**, ChatGPT was added as a custom Memory Space connector using the same public MCP endpoint as the other external clients:

`https://bridge.w-i-z-z-lab-studios.com/mcp`

The first ChatGPT Dynamic Client Registration attempt failed with:

`One or more OAuth redirect_uris are not allowed`

For the live compatibility test, bridge redirect-host configuration was expanded to accept `chatgpt.com` and `openai.com`. ChatGPT then completed the actual OAuth path successfully:

- protected-resource discovery succeeded
- authorization-server discovery succeeded
- a `memory-space-dcr-*` client was dynamically registered with a `chatgpt.com` redirect
- consent was approved
- the authorization-code token exchange completed with PKCE
- an access token and refresh token were issued
- Memory Space AI Access visibly showed `ChatGPT` as `CONNECTED` with `Read ✓ · Propose ✓`
- automatic authorised sharing published `space_memory_app` with **11 confirmed memories** into bridge RAM

This proves that ChatGPT can register and become authorised against the generic Memory Bridge. It does **not** yet prove a ChatGPT MCP tool read/propose loop.

On the ChatGPT Plus account used for this test, the connector detail page still showed:

`No app actions available yet`

and refresh returned:

`Couldn't refresh connector`

When asked to read Memory Space, ChatGPT did not call the live MCP tools and instead fell back to previously stored Personal Context. The ChatGPT product note shown during the test stated that full MCP support was rolling out in beta to Business, Enterprise and Edu plans.

Therefore the exact status is:

**ChatGPT — OAuth/DCR CONNECTED; live grant + 11-memory publication VERIFIED; MCP tool execution NOT VERIFIED on the current Plus account.**

Do not treat this as a bridge OAuth failure, and do not count ChatGPT as a full-loop provider until ChatGPT actually exposes and calls the tools. Retest on an eligible ChatGPT plan or when the product surface changes.

The `chatgpt.com` / `openai.com` redirect-host allowance used in this live test was process configuration, not yet a permanent product configuration. Bank that cleanup for supported ChatGPT productisation rather than introducing a provider-specific bridge fork.

## MAJOR MILESTONE — Cursor connects through the generic MCP bridge

On **8 Aug 2026**, Cursor became the first IDE/coding-agent client verified against the same Memory Space MCP bridge used by the hosted chat providers.

Initial Cursor DCR failed with:

`One or more OAuth redirect_uris are not allowed`

Cursor registered multiple callback forms. The bridge was updated to accept only Cursor's exact known callback URIs for dynamic clients while leaving the fixed Grok redirect policy unchanged.

Important commit:

- `39dd50b6` — allow Cursor OAuth callbacks for MCP DCR

After OAuth completed, Cursor connected but repeatedly treated the transport as dead because it opened `GET /mcp` and the bridge returned the generic 404. The bridge's existing MCP implementation is POST-based Streamable HTTP and does not provide a standalone SSE stream. The unsupported GET was corrected to return `405 Method Not Allowed` with `Allow: POST` instead of 404.

Important commit:

- `b9bde9b0` — return 405 for unsupported MCP SSE GET

After that transport fix, Cursor showed:

- green `Connected` state
- **7 tools enabled**
- successful OAuth token exchange
- successful Streamable HTTP connection

Cursor then used Memory Space directly and returned the real current shared workspace:

- active Space: `Memory App`
- exact memory count: **10**
- all 10 current confirmed memory titles were read successfully

This proves an IDE/coding-agent environment can consume the same user-owned Memory Space without rebuilding project context manually.

Cursor did **not** complete the final proposal -> human approval -> read-back test in that session because the Cursor account hit its Agent usage limit immediately after the successful read. That remaining read-back is a useful regression test later, but it is no longer a blocker for productisation because the connection, OAuth, tool discovery and real Memory Space read are verified.

**Current provider status:**

- Grok — full loop verified
- Mistral — full loop verified
- Claude — full loop verified
- Cursor — OAuth/DCR + 7 tools + real Memory Space read verified
- ChatGPT — OAuth/DCR connected + live grant + automatic 11-memory publication verified; MCP tool execution not exposed/verified on current Plus account
- Cross-provider portability — human-approved memory proposed through one provider and read by another verified

## MAJOR MILESTONE — Claude becomes third full-loop provider

On **8 Aug 2026**, Claude was connected to the same public Memory Bridge and completed the full human-controlled Memory Space loop.

The verified Claude path was:

```text
Claude
   |
   | OAuth discovery + DCR
   | read Memory Space
   v
Memory Bridge
   |
   | list_spaces -> memoryCount 9
   | get_current_space_context
   v
Claude reads the same 9 confirmed memories
   |
   | propose_memory
   v
Bridge proposal queue
   |
   v
Phone Memory App
   |
   | Pull / visible review
   | human Approve
   v
Confirmed Memory Space
   |
   | explicit Share again
   v
Claude reads its approved memory back
   |
   v
memoryCount 10
```

Claude's first DCR attempt exposed a generic OAuth compatibility gap rather than a Memory Space problem. Claude registered with both `authorization_code` and `refresh_token`, while the bridge initially accepted only `authorization_code`.

The bridge was extended with standards-compatible refresh-token support rather than a Claude-specific fork.

Important commit:

- `f68165eb` — support OAuth refresh tokens for MCP clients

That patch added:

- DCR support for `authorization_code` + `refresh_token`
- authorization-server metadata advertising both grant types
- refresh-token issuance for clients that register for it
- refresh-token rotation on use
- refresh-token expiry/cleanup in RAM
- scope preservation/restriction during refresh
- continued compatibility with the existing fixed Grok client and DCR clients that only need authorization code

After the patch, Claude connected successfully and discovered all **7 MCP tools**. Claude's own UI classified **6 tools as read-only** and `propose_memory` as the single state-changing tool, with Claude-side `Needs approval` controls available on top of the bridge's own human-review boundary.

Claude then:

1. Called `list_spaces` and reported the exact `memoryCount: 9`.
2. Read all 9 current confirmed memory titles, including the Mistral-created/human-approved `Purpose of Memory Space` memory.
3. Called `propose_memory` for `First full loop with Claude`.
4. The proposal appeared visibly on the phone under `Memory proposals` as `External AI via MCP · requires your approval`.
5. The user approved it locally.
6. The updated workspace was explicitly shared again.
7. Claude called the connector again and reported `memoryCount: 10`.
8. Claude confirmed `First full loop with Claude` was now present as a confirmed `[NORMAL] [NOTE]` with source `AI proposal approved by user`.

The confirmed Claude test memory is:

`First full loop with Claude`

> Claude successfully connected to the same user-owned Memory Space and completed the external read → proposal → human approval → read-back test.

This proves a third independent hosted AI can use the same generic Memory Space contract end to end without a provider-specific memory database.

**Verified full-loop providers now: Grok, Mistral and Claude.**

## MAJOR MILESTONE — cross-provider Memory Space portability proven

On **8 Aug 2026**, the defining multi-provider test was completed with **Mistral** and **Grok** using the same user-owned Memory Space and the same generic MCP contract.

The verified chain was:

```text
Mistral
   |
   | read the existing shared Memory Space
   | propose_memory
   v
Memory Bridge proposal queue
   |
   v
Phone Memory App
   |
   | Pull / visible review
   | human Approve
   | archive an old duplicate memory
   v
Durable local Memory Space
   |
   | explicit Share again
   v
Mistral reads the changed state back
   |
   v
Grok re-authenticates after bridge restart
   |
   v
Grok reads the Mistral-created, human-approved memory
```

The live second-provider proof established all of the following:

1. Mistral connected to the same public `/mcp` endpoint as Grok.
2. Mistral completed OAuth 2.1 discovery using Dynamic Client Registration.
3. Mistral discovered the Memory Space tools without a provider-specific bridge fork.
4. Mistral read the existing `Memory App` space and the memories previously created/approved during the Grok tests.
5. Mistral called `propose_memory` for a new memory titled `Purpose of Memory Space`.
6. The proposal appeared in the phone app as a pending external-AI proposal.
7. The user approved it locally; Mistral never gained direct trusted-write authority.
8. The user archived one duplicate `First full loop with Grok` memory.
9. The workspace was explicitly shared again.
10. Mistral called `list_spaces` and reported the exact `memoryCount` as **9**.
11. Mistral read the new confirmed `Purpose of Memory Space` memory and correctly saw only one remaining `First full loop with Grok` entry.
12. Grok's old OAuth grant had been cleared by the bridge restart, so Grok correctly required re-authentication.
13. After user re-authentication, Grok also reported `memoryCount: 9` and read `Purpose of Memory Space` successfully.

The new confirmed memory used for the cross-provider test is:

`Purpose of Memory Space`

> Memory Space exists to give the user one private, visible, user-controlled source of long-term context that can be shared across different AI models without the memory belonging to any single model.

This proves more than two connectors working independently.

**Context proposed through one external AI can become durable only after human approval, then be read by another independent AI provider from the same user-owned source of truth.**

No provider-specific memory database was created.

## Earlier milestone — independent Grok MCP loop proven end to end

On **7 Aug 2026**, Grok was connected as the first genuine independent third-party MCP client to the public Memory Bridge and completed the full human-controlled memory round trip.

```text
Phone Memory App
      |
      | explicit Share
      v
HP Memory Bridge
      |
      | OAuth 2.0 + PKCE
      | public MCP /mcp
      v
Grok
      |
      | read confirmed Memory Space
      | propose_memory
      v
Bridge proposal queue
      |
      v
Phone Memory App
      |
      | Pull / review
      | human Approve
      v
Confirmed Memory Space
      |
      | explicit Share again
      v
Grok reads the newly confirmed memory back
```

The first live Grok proposal ID was:

`external_b34d408b-77b0-42e4-918e-81ca95b14c9c`

The first approved/read-back memory was:

- title: `First full loop with Grok`
- type: `note`
- importance: `normal`
- status: `confirmed`
- source: `AI proposal approved by user · Chat: External MCP client proposal`

A later Grok proposal created the critical milestone memory:

`Major Milestone: Independent Grok MCP Loop Proven`

That first Grok loop established the product contract; the later Mistral → human approval → Grok read-back established provider portability.

## OAuth Dynamic Client Registration — implemented and live-proven

The bridge originally supported the fixed Grok OAuth client. To support independent providers without adding provider-specific client configuration, OAuth Dynamic Client Registration was added.

Important commits:

- `8d46c3c` — add OAuth dynamic client registration for MCP
- `f68165eb` — support OAuth refresh tokens for MCP clients
- `39dd50b6` — allow Cursor OAuth callbacks for MCP DCR
- `b9bde9b0` — return 405 for unsupported MCP SSE GET

Current DCR/OAuth behaviour:

- in-memory dynamic client registry
- generated `memory-space-dcr-*` client IDs
- `registration_endpoint` advertised in authorization-server metadata
- `POST /register`
- authorization-code + PKCE public-client flow
- optional `refresh_token` grant for clients that register for it
- `token_endpoint_auth_method=none`
- registered redirect URI must match exactly at authorization time
- normal HTTPS redirect hosts remain allow-listed by bridge configuration
- exact Cursor DCR callback URIs are accepted for dynamic clients
- ChatGPT DCR can register when its redirect hosts are explicitly allowed in bridge configuration
- access tokens, refresh tokens and dynamic registrations are RAM-only in the earlier proof configuration; current V1 restart recovery is tracked separately in `V1_PRODUCT_GOAL.md`
- refresh tokens rotate on use
- legacy fixed Grok client remains supported
- unsupported standalone `GET /mcp` returns 405 rather than being misclassified as a missing route

Mistral successfully validated the original DCR path. Claude then exposed and validated the refresh-token extension in a second independent DCR implementation. Cursor then exposed and validated callback-set and Streamable HTTP GET compatibility. ChatGPT then validated DCR registration, PKCE authorization and token issuance, but its Plus product surface did not expose the MCP tool actions for a live read/propose test.

## Current state

The core product is now beyond a single-provider proof of concept and has also crossed the first live customer-isolation boundary: a fresh customer browser + fresh Claude account completed a scoped `MSB2.` read/propose path without inheriting the owner browser's external-AI authorisations.

**Verified external providers:**

- Grok — read, propose, human approve, re-share, read-back verified
- Mistral — OAuth/DCR connection, read, propose, human approve, changed-state read-back verified
- Claude — OAuth/DCR + refresh-token compatibility, read, propose, human approve, re-share, read-back verified
- Cursor — OAuth/DCR connection, 7 MCP tools discovered, exact 10-memory current Space read verified
- ChatGPT — OAuth/DCR connection, live Read/Propose grant visible in Memory Space, automatic 11-memory publication verified; MCP tool read/propose not verified on current Plus account
- Cross-provider portability — Mistral-created/human-approved memory read back by Grok verified
- Customer isolation — scoped `MSB2.` architecture merged and automated NIKE/PLUMBER regression passing; fresh plumber Claude read/propose path live-proven

The existing owner `Memory App` source-of-truth state remains separate from the fresh plumber browser test. Browser storage is still the durable workspace boundary for the current V1 client; customer-scoped bridge runtime state is routed by authenticated connection identity.

The current production web app is hosted on Vercel while trusted workspace data remains in browser storage. The HP Windows PC runs Memory Bridge and Ollama. Cloudflare Tunnel exposes the bridge securely over HTTPS.

The phone has successfully:

- paired with `WIZZ HP Bridge`
- chatted through the public bridge to Ollama `gemma3:1b`
- sent selected confirmed Memory Space context to the remote-local model
- explicitly shared the active Memory App space to the bridge in the original proof flow
- automatically republished current confirmed memories into bridge RAM for authorised external AI clients in the V1 flow
- verified the public MCP endpoint through the in-app MCP self-test
- pulled real external AI proposals from Grok, Mistral and Claude through the same bridge contract
- visibly reviewed and approved external proposals locally
- archived an obsolete/duplicate memory locally
- proved that independent providers see the same changed state
- reached **11 confirmed memories** after the automatic V1 loop proof
- visibly shown ChatGPT as a live authorised external AI client after successful OAuth/DCR

The fresh plumber customer test has successfully:

- created independent incognito browser storage
- created `plummers memory`
- paired a fresh scoped `MSB2.` connection
- shown no inherited external-AI authorisations before OAuth
- connected a fresh Claude account against the scoped customer MCP route
- read exactly the plumber Space's one confirmed memory
- submitted a Memory Space proposal that remained pending until human approval

Cursor has successfully:

- completed OAuth/DCR against the public bridge
- discovered all 7 MCP tools
- connected over Streamable HTTP
- called the real Memory Space tools
- reported the exact active Space and `memoryCount: 10` during its test session
- read the exact current confirmed memory titles

ChatGPT has successfully:

- completed protected-resource and authorization-server discovery
- dynamically registered a ChatGPT OAuth client
- completed user consent and PKCE token exchange
- received access + refresh tokens
- appeared as `CONNECTED` in Memory Space AI Access
- caused the current 11-memory Space to be automatically published into bridge RAM

ChatGPT has **not yet** successfully:

- discovered/exposed the 7 MCP actions in the tested Plus product UI
- called `list_spaces`, `get_current_space_context` or another live Memory Space MCP tool
- completed proposal -> human approval -> read-back

The bridge self-test reports:

`MCP verified · 7 tools · shared workspace readable · 2026-07-28`

## Architecture now proven

```text
                    USER
             final authority / approval
                       |
                       v
             Phone / Browser Memory App
             durable local source of truth
                       |
                       | automatic authorised publish in V1
                       v
             Cloudflare HTTPS route
                       |
                       v
              HP Memory Bridge :8787
                       |
          +------------+------------------+
          |                               |
          | tenant/customer runtime       | OAuth / DCR / MCP
          | workspace + proposals in RAM  | scoped auth state
          |                               |
          +------------+------------------+
                       |
             authenticated connection
                       |
       +---------------+-----------------------+
       |                                       |
       v                                       v
 legacy owner `/mcp`                 customer `/c/<id>/mcp`
  existing owner flow                  isolated MSB2 flow
       |                                       |
       +--------- providers / MCP clients -----+
```

Important distinction:

- Browser storage is the durable workspace.
- The bridge does **not** persist Memory Space contents into the customer connection registry.
- Customer registry state is encrypted at rest; published customer workspace snapshots and proposal queues remain RAM-only.
- V1 automatic authorised sharing hides the old manual Share infrastructure chore from the normal flow while preserving the authorisation boundary.
- Only current confirmed memories are published as trusted current memory.
- Archived/superseded history does not silently re-enter current context.
- External AI changes are proposals only; approval remains human-controlled.
- Legacy root `/mcp` exists for the owner compatibility flow; unrelated customers use scoped `/c/<connectionId>/mcp` routes.

## MCP interface currently implemented

Legacy owner route:

`https://bridge.w-i-z-z-lab-studios.com/mcp`

Customer-scoped route:

`https://bridge.w-i-z-z-lab-studios.com/c/<connectionId>/mcp`

The bridge supports OAuth authorization-code + PKCE, Dynamic Client Registration and refresh tokens for compatible external MCP clients. Normal customers should use their scoped `MSB2.` connection credential; the master bridge token is administrator/bootstrap-only and must never be committed or pasted into public documentation.

Current MCP tools:

1. `list_spaces`
2. `search_memory`
3. `get_current_space_context`
4. `read_memory`
5. `get_current_decisions`
6. `inspect_provenance`
7. `propose_memory`

`propose_memory` queues a proposal for the user. It does not create trusted memory automatically.

A generic smoke-test client also exists at:

`bridge/mcp-smoke.mjs`

The browser MCP self-test uses the stateless MCP discovery path and passes against the live HP bridge.

## External AI proposal loop — VERIFIED ACROSS PROVIDERS

```text
External MCP AI
      |
      v
read/search explicitly shared context
      |
      v
propose_memory
      |
      v
HP bridge proposal queue
      |
      v
Memory App -> Pull
      |
      v
Reject / Edit / Approve
      |
      v
Confirmed Memory Space only after user approval
      |
      | explicit Share / automatic authorised republish
      v
Same AI or another authorised AI can read the approved state
```

The Shared Chat screen contains an **External AI inbox** with visible proposal controls.

Real external proposals from **Grok, Mistral and Claude** have now passed through the same human approval boundary. The fresh plumber Claude customer test also proved that a scoped customer proposal lands as pending rather than silently becoming trusted memory.

The verified rule remains:

**External AIs can suggest durable state. They cannot silently make themselves the source of truth.**

## Provider-expansion phase is closed for V1

The interoperability proof is now sufficient:

- three independent hosted AIs have completed full human-controlled loops
- cross-provider read-back is proven
- Cursor proves an IDE/coding-agent can consume the same user-owned Memory Space through the same contract
- ChatGPT proves the same bridge can complete DCR/OAuth against ChatGPT without a provider-specific memory database, even though the tested Plus account does not expose the MCP actions needed for a live tool-read proof
- customer-scoped `MSB2.` routing is now implemented and live-exercised with a separate plumber Claude account

Do not spend V1 time chasing provider count. New provider tests are compatibility/regression work only when they materially help the normal-user product.

ChatGPT remains one compatibility target, not the architecture. The current test is banked as `OAuth connected / actions unavailable on Plus`; retest only when an eligible plan or changed ChatGPT product surface makes a real MCP tool call possible.

## Context selection now implemented

The app no longer assumes the entire workspace should be dumped into every model request.

A focused local selector:

- stays inside the active space
- uses confirmed memory only
- prioritises locked and critical memories
- scores memories against the current request/recent chat
- defaults to a maximum focused set rather than sending everything as the workspace grows

Shared Chat shows a **Context budget** trace so the user can see how many memories were selected.

Current small-workspace behaviour may still select the full current set when all items are relevant.

### Banked context-inspector idea

Later, Context Budget can become a proper inspector with:

- estimated token count
- context package size
- selected-memory explanations
- `why selected` information
- package preview
- live rebuild after memory changes

Do not let this distract from productisation and permission hardening.

## UI state

### Mobile

Mobile is the primary tested layout.

Current stacked order remains approximately:

```text
Purpose / Stats
Search / filters
AI Workspace
  Bridge selector
  External AI inbox
  Context budget
  Memory proposals when pending
  Chat
Shared Memory
```

On 7 Aug 2026 the mobile AI panel was patched so pending external proposals are no longer hidden under the chat. Proposal cards take natural space, chat remains scrollable, and confirmed memory cards were compacted to reduce vertical waste.

Real external Grok, Mistral and Claude proposals have now been reviewed through the same human-controlled mobile loop.

### Desktop

Desktop gives Memory and AI proper side-by-side workspace weight.

```text
Purpose / Stats
Search

+-----------------------------+-------------------------+
| Shared Memory               | AI Workspace            |
|                             |                         |
| Memory cards                | Bridge selector         |
| Memory cards                | External AI inbox       |
| Memory cards                | Context budget          |
|                             | Chat                    |
|                             | Message box / Send      |
+-----------------------------+-------------------------+
```

Desktop target is roughly **65% Memory / 35% AI**, with the AI pane sticky while scrolling.

## Recent important commits

- `f498c59c` — external AI proposal inbox logic
- `9641674d` — external proposal inbox styling
- `df3aa087` — load external proposal phase
- `5edae3e8` — initial MCP self-test UI
- `38006f56` — focused context selector
- `a38ecf52` — context trace logic
- `ff773b5f` — fix context-trace mutation/render loop regression
- `71d48539` — modern stateless MCP self-test
- `ba63e476` — generic MCP smoke-test client
- `14bf5b35` — desktop 65/35 workspace layout
- `8bf7e64` — bridge/MCP/OAuth groundwork
- `302f09c` — MCP protected-resource metadata compatibility + OAuth diagnostics
- `61591e80` — fix Grok OAuth callback redirect
- `132c53dd` — fix mobile proposal visibility and compact memory cards
- `79cecf1e` — final mobile CSS cache bump while preserving existing app wiring
- `ffc8b082` — record Grok full MCP round-trip milestone
- `8d46c3c` — add OAuth dynamic client registration for MCP
- `57e5a95f` — record multi-provider portability and workspace vision
- `f68165eb` — support OAuth refresh tokens for MCP clients
- `39dd50b6` — allow Cursor OAuth callbacks for MCP DCR
- `b9bde9b0` — return 405 for unsupported MCP SSE GET
- `f1f9db00` — record ChatGPT OAuth connection and Plus MCP limitation in V1 goal
- `ce5010d` — customer-scoped bridge isolation + regression retained on main

## Regression / debugging notes

A context-trace patch temporarily caused the Shared Chat UI to disappear because a `MutationObserver` repeatedly triggered its own render changes. This was fixed in `ff773b5f` by stopping the render loop and only observing until the panel exists.

During Grok OAuth testing, repeated `consent approved` logs with no `/token request` exposed a callback-navigation compatibility bug. The OAuth consent page redirect/CSP path was corrected and Grok then completed token exchange successfully.

If Shared Chat ever disappears again, inspect startup JavaScript before assuming Vercel or the phone is still loading.

If OAuth reaches `consent approved` but never logs `token request`, inspect the browser callback/redirect boundary rather than the pairing token first.

Current V1 OAuth restart recovery is documented in `V1_PRODUCT_GOAL.md`. Historical tests before that persistence work did require re-authentication after bridge restart; do not use those older observations as the current product-state rule.

Claude initially failed at DCR with:

`[oauth] registration rejected Only authorization_code grant type is supported`

That failure identified that Claude registered for `refresh_token` in addition to `authorization_code`. The generic bridge OAuth implementation was then extended in `f68165eb`, after which Claude registered and connected successfully. If another client fails at `/register`, inspect the exact DCR metadata before introducing provider-specific code.

Cursor initially failed at DCR with:

`One or more OAuth redirect_uris are not allowed`

After exact Cursor callback compatibility was added, OAuth succeeded. Cursor then exposed a second transport issue where repeated `GET /mcp` 404 responses caused Cursor to tombstone the Streamable HTTP transport. Returning 405 for unsupported standalone SSE GET fixed that compatibility boundary. Future Streamable HTTP clients that initialize successfully and then fail on session/stream handling should be checked against the precise HTTP method/status requirements before adding a new transport implementation.

ChatGPT initially failed DCR with the same redirect allow-list class of error:

`One or more OAuth redirect_uris are not allowed`

Allowing the ChatGPT redirect hosts in process configuration let DCR, consent and token exchange complete successfully. After that point, Memory Space itself showed the ChatGPT grant as live and automatically published 11 memories, while ChatGPT's Plus connector UI still reported no app actions. If this is retested, distinguish **OAuth connected** from **MCP tools actually exposed/called**; do not patch the bridge merely because the current ChatGPT account tier withholds the actions.

## HP / Cloudflare runtime

Current first bridge machine is the HP Windows server.

- Repo: `E:\WIZZ-Server\workspaces\memory-app`
- Ollama: `E:\WIZZ-Server\ollama`
- Ollama model storage: `E:\WIZZ-Server\ollama\models`
- Ollama runtime: `127.0.0.1:11434`
- Memory Bridge: `127.0.0.1:8787`
- Public bridge: `bridge.w-i-z-z-lab-studios.com -> 127.0.0.1:8787`
- Media route remains separate: `media.w-i-z-z-lab-studios.com -> 127.0.0.1:8081`
- Model currently used: `gemma3:1b`

The bridge is installed under the Windows scheduled-task/supervisor path and has recovered after the isolation build restart. After bridge server code changes on GitHub, the HP clone still needs `git pull` and the bridge process/task must be restarted so the live runtime is actually using the new commit.

Current OAuth restart recovery is implemented and verified as described in `V1_PRODUCT_GOAL.md`. Customer connection registry/OAuth state is scoped and persisted as designed; published workspace snapshots and pending external proposal queues remain RAM-only and are republished/recovered through the browser-side V1 flow.

## Security / permission housekeeping

The original development bridge pairing/master token appeared during live development setup/screenshots and should be rotated before wider deployment. Do not place the replacement token in this README, Git history, screenshots or chat logs.

Implemented security boundaries now include:

- customer-scoped `connectionId` + derived revocable customer secret for `MSB2.` connections
- encrypted customer connection registry at rest
- separate tenant OAuth namespaces/state
- customer-scoped workspace and proposal runtime state
- exact OAuth redirect validation rather than wildcard callback acceptance
- external AI durable writes limited to `propose_memory`; trusted memory still requires human review

Current OAuth scopes include `memory.read` and `memory.propose`. These scopes should become hard tool-level authorization boundaries rather than merely being issued/recorded.

Target permission model:

- access is granted **per Space/customer connection**
- read/search confirmed memory can be granted independently from proposal rights
- external AI may propose only when `memory.propose` is granted
- external AI never receives direct approve/delete/archive/lock authority over trusted memory
- user can revoke an AI's grant clearly and immediately
- every external action keeps provider/client provenance
- future grants may be time-limited or task-scoped

### Future security hardening — banked

A shared long-term memory layer creates a specific security risk: **memory poisoning / prompt injection through durable shared context**. A malicious, compromised or simply careless connected model could propose instructions or false facts that another AI later reads as trusted context.

The current human approval boundary is therefore not just UX; it is a security control. Keep this rule mandatory for normal external-AI writes:

```text
external AI output
    -> untrusted proposal
    -> visible human review
    -> Approve / Edit / Reject
    -> trusted confirmed memory only after approval
```

Future hardening should include:

- keep proposal provenance visible: provider, client, time and source action
- flag or quarantine proposals that look like hidden instructions, privilege escalation, credential requests or attempts to override user/system policy
- never let an AI approve its own proposal
- enforce `memory.read` / `memory.propose` scopes at every MCP tool boundary
- resolve tenant/customer identity before every publish, read, search and proposal operation
- add rate/size limits so one client cannot flood a Space or proposal queue
- maintain clear revocation and audit history for external clients
- test cross-tenant route/token misuse continuously in CI
- rotate development/admin secrets before public beta and keep them out of logs/screenshots
- preserve exact redirect URI/host validation for OAuth clients; no wildcards as a convenience fix
- if durable server-side Memory Space storage is added later, add explicit at-rest encryption, migration integrity and backup/recovery controls rather than silently expanding the current bridge trust boundary

The app/phone remains the human control surface and root authority.

## Product rules — do not break these

- Memory Space owns the long-term truth.
- The user is the final authority.
- Models are replaceable workers.
- The user chooses what becomes trusted memory.
- External AIs may read/search only explicitly shared/authorised memory.
- External AIs may propose changes only when granted that capability.
- External AIs must not silently approve/write/delete/archive trusted memory.
- External AI proposal content is untrusted until the human approves or edits it.
- Only current confirmed memories enter active trusted context.
- Superseded/archived history remains history, not current context.
- Pairing/connection tests should not leak workspace data.
- Customer-scoped bridge runtime state must resolve authenticated customer identity before memory operations.
- Shared/customer bridge workspace snapshots remain ephemeral RAM-only unless the product deliberately changes later.
- No silent cloud fallback.
- Local-only/private operation remains a first-class mode, not a degraded fallback.
- No provider-specific fork of the user's memory database.
- Access to one Space/customer connection must not imply access to another.
- **Knowledge, artifacts and execution are separate permission layers.** Knowing project context does not automatically grant authority to modify code/files or execute tools.
- Keep the bridge generic: Grok, Mistral, Claude, ChatGPT, Gemini, Cursor, VS Code, local models and future MCP clients should use the same contract.

## Development working rule

Do not turn the ledger into the project.

1. Read this section when context is uncertain.
2. Read the actual files before patching.
3. Make the smallest safe patch.
4. Test meaningful boundaries.
5. Update this ledger only after real milestones.
6. Keep building the app.

---

# Product model

Memory App is not ordinary hidden chatbot memory and it is not a dump of every conversation. It gives the user a dedicated virtual space where important facts, decisions, goals, project state, sources and history can be deliberately preserved, inspected, corrected and removed.

The experience should feel like every authorised AI is entering the **same room**, rather than forcing the user to rebuild that room for each model provider.

The current Grok + Mistral + Claude + Cursor proof demonstrates that this room persists while the AI changes; the ChatGPT OAuth test additionally proves the same bridge can authorise ChatGPT even when the current account tier does not expose live MCP actions. The scoped plumber-Claude test additionally proves that unrelated customer rooms can now use separate bridge identities instead of sharing one global workspace slot.

## Memory layers

### Confirmed memory

User-approved information that belongs to a space and may be supplied as trusted current context.

### Locked memory

Critical confirmed information that must not be silently changed or replaced.

### Proposed memory

Information an AI believes may be worth keeping. It remains pending until the user approves, edits or rejects it.

### Working memory

Recent/temporary context useful for the current task but not automatically permanent.

### Raw archive

Conversation/source material that remains evidence and searchable history rather than being inserted into every model request.

## Context assembly principle

Do not send the whole database to a model by default.

A context package should be assembled from the active space, locked memory, relevant confirmed memory, current goals/decisions, recent conversation context and the user's current request.

The user should be able to inspect what was selected and why.

## Privacy principles

- local storage by default
- explicit sharing only
- per-space/customer authorization
- clear provenance
- clear deletion/export controls
- no private memory in analytics
- no unrestricted external database access
- human approval for trusted long-term changes
- local/private mode remains available even if cloud conveniences are added later

---

# Banked expansion — Memory Space as an AI workspace control layer

This is **not the current build priority**, but it is a natural extension of the architecture now proven.

The same rules can govern more than long-term memory. A Space can become a project room in which the user controls what each AI may know and what each AI may do.

```text
                         USER
                  root authority / approval
                           |
                           v
                     PROJECT SPACE
                           |
          +----------------+----------------+
          |                |                |
          v                v                v
       MEMORY           ARTIFACTS        EXECUTION
   trusted context     code / files      tools / sandbox
          |                |                |
          +----------------+----------------+
                           |
                     scoped AI worker
```

The separation is deliberate:

- **Memory / knowledge** — what trusted project context the AI may read.
- **Artifacts** — which files, repositories, documents, images or outputs it may access.
- **Execution** — which tools/actions it may actually run.

Permission in one layer must not silently imply permission in another.

## Code Space concept

A future `Code Space` can attach a repository or code-server/IDE sandbox to a Memory Space.

A coding AI could receive a task-scoped context package such as:

```text
PROJECT
Space Junkz

GOAL
Integrate reusable BossBrain into selected bosses

TRUSTED PROJECT MEMORY
- architecture decisions
- current milestone
- known regressions
- coding rules
- previous decisions relevant to this task

CAPABILITIES
+ read/search project memory
+ read repository
+ modify isolated branch/sandbox
+ run approved tests
- merge to main
- approve its own memory proposals
- read unrelated/private Spaces
```

The coding model can change over time — Cursor, Claude Code, Codex, a local model or another IDE agent — while the project knowledge remains in the same user-owned Space.

When work finishes, the agent can return artifacts plus proposed project-state memories for human review rather than silently rewriting the project's trusted history.

```text
Memory Space provides project brain
          |
          v
Coding AI works in sandbox
          |
          v
code / tests / artifacts
          |
          v
proposed project-state update
          |
          v
human review
          |
          +--> merge code if approved
          +--> confirm memory if approved
```

## Nested spaces / user-designed AI network

Longer term, users could design their own trust network with isolated spaces and explicit capability grants.

```text
User / Company
|
+-- Personal
|   +-- private memory
|
+-- Project A
|   +-- Memory
|   +-- Code Space
|   +-- Files
|   +-- AI workers
|
+-- Project B
|   +-- Research
|   +-- Artifacts
|   +-- AI workers
|
+-- Private
    +-- undiscoverable to workers without permission
```

Potential permission patterns include:

- read-only researcher
- read + propose memory worker
- coding worker with one sandbox branch
- reviewer with read access but no execution
- temporary two-hour access
- one-task capability grants

This can support several future product surfaces without changing the core trust model:

- **Memory Space Personal** — portable long-term personal/project context across AI providers
- **Memory Space Dev** — project memory + code sandbox + IDE/coding agents
- **Memory Space Teams** — company/project rooms with human and AI workers
- **Memory Space Studio** — creative files, briefs, images/video/3D and AI workers
- **Memory Space Research** — sources, conclusions, provenance and research agents
- **Memory Space Agent Office** — multiple scoped AI workers collaborating through shared user-controlled state

The stable layer is the workspace, not any individual model.

---

# V1 roadmap — normal-user productisation

1. **First-run onboarding** — fresh browser creates a blank user Space instead of loading developer seed data; plain-language onboarding; existing workspaces untouched.
2. **First memory** — reduce the main add-memory action to the fields a normal person actually needs; keep classification/provenance available without making them mandatory concepts.
3. **AI Access** — one user-facing view showing provider, Space, Read, Propose and Revoke.
4. **Three-click connection** — `Connect AI -> Authorize -> Connected` with URLs/tokens/MCP/OAuth details hidden from normal users.
5. **Automatic authorised sharing** — remove the manual `Share` infrastructure chore from the normal flow while preserving explicit permission boundaries.
6. **Proposal notification/review** — remove manual `Pull`; surface new AI proposals automatically and keep Approve / Edit / Reject human-controlled.
7. **Real revoke** — disconnect invalidates access, not just UI state.
8. **Runtime persistence** — make HP Ollama + Memory Bridge survive reboot/restart without PowerShell intervention and express failures as simple reconnect/status states.
9. **Customer isolation** — scoped `MSB2.` routing is implemented and automated isolation regression is passing; finish the explicit live owner-vs-plumber cross-read + scoped revoke check.
10. **Secret hardening** — rotate exposed development/master credentials and remove operational secrets from screenshots/setup paths.
11. **Scope enforcement** — enforce `memory.read` and `memory.propose` at individual MCP tool boundaries.
12. **Memory-poisoning hardening** — keep propose -> human approval mandatory; add review cues/quarantine/audit controls for hostile or misleading durable-context proposals.
13. **Durable storage hardening** — move toward IndexedDB/versioned migrations plus trustworthy export/import/recovery before people rely on years of memory.
14. **Stranger test** — give a non-technical person only the app URL and ask them to make an AI memory and connect their AI; fix every place they need developer help.
15. **Only after V1 works**, return to contradiction detection, explicit supersede proposals, richer timeline/archive UX and large-memory housekeeping.
16. Keep Code Space, GitHub/repo access, banking and other capability integrations as bolt-ons rather than mixing them into the Memory core.

## Productisation target

The normal-user path should be approximately:

```text
Open
  -> Create Space
  -> Add memory
  -> Connect AI
  -> Authorize
  -> Connected
  -> Review AI proposals
```

A non-technical user should not need to understand MCP, OAuth, Cloudflare, Node, PowerShell or long bearer tokens to get the core benefit.

## Future large-memory housekeeping — banked, not V1

At hundreds or thousands of memories, the user should not become a manual database administrator.

A future AI memory librarian can **propose** housekeeping such as:

- duplicate memories to merge
- old decisions that appear superseded
- contradictions that need human resolution
- stale material to archive
- related memories to group

The AI prepares the tidy-up. The human approves, edits or rejects it. Durable truth must not be silently rewritten.

---

# Guiding principle

The memory is not generated about the user behind the scenes.

It is created **with** the user in a space they can see, understand and control.

The user owns the room. AI gets a key, not the building.

The AI is a worker. The provider is replaceable. The bridge is infrastructure.

**The shared Memory Space is the product.**
