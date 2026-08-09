# V1 Ledger

**Started:** 9 Aug 2026

This is the active handoff file for V1 development from now on.

**Do not use `README.md` as the normal development handoff anymore.** It is the large historical/reference document and should be left alone unless there is a genuine reason to change long-term product documentation.

Keep this ledger short, factual and current. Update it only after meaningful tested milestones.

---

## CURRENT V1 GOAL

Make Memory Space usable by a normal non-technical customer without developer help.

Target path:

```text
Open Memory Space
  -> Create Space
  -> Add first memory
  -> AI Access
  -> Connect external AI
  -> Authorize
  -> Connected
  -> AI reads Space
  -> AI proposes memory
  -> user Approve / Edit / Reject
  -> Revoke when wanted
  -> return later with workspace intact
```

The normal path must hide MCP URLs, OAuth/DCR/PKCE terminology, raw pairing tokens, bearer tokens, Node, PowerShell and Cloudflare details.

Detailed V1 checklist remains in `V1_PRODUCT_GOAL.md`.

---

## CURRENT VERIFIED STATE

### New-customer onboarding

Verified from a fresh browser/customer state:

- blank private Space is created instead of inserting the developer workspace
- customer can name the Space
- `Add first memory` empty state works
- AI Access leads into external connection setup
- normal setup uses one packaged Private Access Code rather than raw bridge URL/token fields

Earlier `Critical + Locked` first-memory report is **closed / not a bug**. The test memory had been manually set Critical + Locked by the developer; no current first-memory defect was reproduced.

### Customer isolation

Customer-scoped bridge routing is implemented on `main`.

New unrelated customers use:

```text
/c/<connectionId>
/c/<connectionId>/mcp
```

Each customer receives:

- random `connectionId`
- unique revocable customer secret
- scoped `MSB2.` Private Access Code
- separate OAuth namespace/state
- separate RAM-only published workspace
- separate RAM-only proposal queue

Customer secrets are stored as stable per-connection secrets inside the encrypted customer registry instead of remaining permanently derived from the bridge administrator token. Existing customer credentials migrate to the same value they already used, so their `MSB2.` codes do not change during administrator rotation.

The HP owner workspace has now been moved away from the stored development-era `MSB1` owner credential and onto the same scoped `MSB2` connection model used by unrelated customers. The server still contains dormant legacy-root compatibility code, but the Windows supervisor no longer persists the retired owner credential after the retirement flag is set.

Customer connection registry is encrypted at rest. Memory Space contents are not stored in that registry.

### Automated isolation regression

Passing regression verifies separate NIKE and PLUMBER customers:

- workspace markers remain separate
- cross-customer search returns no other-customer data
- wrong-customer token/route use is rejected
- revoking one customer does not revoke the other

Important merged commit:

- `ce5010d` — customer isolation regression retained on `main`

### MCP tool permission enforcement — PASSED 9 Aug 2026

MCP permissions are enforced at the individual tool-call boundary rather than only at the higher-level OAuth connection boundary.

Current rules:

- `list_spaces`, `search_memory`, `get_current_space_context`, `read_memory`, `get_current_decisions`, `inspect_provenance` require `memory.read`
- `propose_memory` requires `memory.propose`
- any future/unknown MCP tool without a declared scope fails closed
- privileged compatibility paths remain privileged only where explicitly intended

Automated regression verifies:

- read-only token can read but cannot call `propose_memory`
- propose-only token can propose but cannot read
- an undeclared future tool is rejected
- customer isolation and scoped revoke tests still pass

Relevant commits include `e6a7bc9`, `c3d0096`, and `ee96622`.

The HP bridge was pulled/restarted onto the scope-enforcement build and the normal app connections remained connected. The restricted-scope negative cases are CI-proven; they were not repeated as another manual live provider test.

### Rotation-safe administrator credential split — LIVE PASSED 9 Aug 2026

A direct administrator-token rotation was found to be unsafe because the old implementation also used that token to encrypt the customer registry and derive customer credentials. Rotating it blindly would have invalidated private customer routes.

The repository therefore split owner/root compatibility from administrator/customer-management access and made customer credentials stable across administrator rotation:

- customer connection secrets survive administrator rotation
- existing derived customer credentials migrate without changing their `MSB2.` Private Access Codes
- owner/root compatibility and administrator/customer-management use separate credentials
- the owner credential is rejected from `/v1/connections` administrator operations
- Windows supervisor loads separate DPAPI-protected administrator state
- Memory Bridge Setup uses the administrator credential when creating new private connections
- `bridge/windows/rotate-master-token.ps1` rotates administrator credential + customer-registry encryption while preserving MSB2 customer credentials and tenant OAuth state

Automated CI verifies:

- owner credential cannot create customer connections
- separate administrator credential can manage customers
- administrator rotation preserves the same `MSB2.` customer access code
- tenant OAuth state survives administrator rotation
- owner OAuth state could remain usable while the old owner credential was temporarily retained
- Node and Windows PowerShell security scripts parse successfully
- full customer-isolation + MCP-scope regression still passes

Live HP result on 9 Aug 2026:

```text
Memory Bridge administrator credential rotated successfully.
Rotation state: {"rotated":true,"customerConnections":1,"customerRegistryRotated":true,...}
```

Observed immediately afterward:

- owner side remained available
- plumber/private side remained available
- no connection/UI bug was observed after the administrator rotation

This closes the live administrator/master credential rotation milestone.

### Legacy owner development credential retirement — LIVE COMPLETED 9 Aug 2026

The stored development-era owner `MSB1` credential was then retired instead of replacing it with another permanent privileged legacy secret.

Before retirement:

- a fresh `MSB2` Private Access Code was generated through Memory Bridge Setup
- the normal owner `Memory App` browser was connected to a new Private/MSB2 bridge entry
- the browser showed the old Owner entry and the new Private entry concurrently, preserving a fallback during migration

Repository hardening for retirement includes:

- `bridge/windows/disable-legacy-owner.ps1`
- `bridge/windows/start-bridge.ps1` retirement mode
- `bridge/legacy-owner-retirement-test.mjs`
- CI coverage preventing the legacy stored owner credential from being silently recreated by reinstall/autostart setup

Latest retirement CI passed on `main` after commit `fc18fdf`.

Live HP retirement command completed successfully and reported:

```text
Legacy owner credential retired.
The stored owner MSB1 credential and legacy root OAuth recovery state were removed.
The administrator credential, private MSB2 customer credentials, and tenant OAuth state were left untouched.
The supervisor will now use a non-persisted random owner token only for dormant legacy-root compatibility.
```

Meaning:

- the old stored development owner credential is no longer retained on the HP
- administrator credential remains separate
- private `MSB2` customer credentials remain the intended normal connection model
- dormant legacy-root compatibility receives only a non-persisted random owner token on supervisor start

**Do not overclaim this step:** after the retirement command, another full external-provider read/propose cycle was deliberately not repeated. The retirement script completed and the migration code is CI-covered; provider reconnection on the new owner MSB2 route can be done only when actually needed.

### Multi-bridge browser isolation fix — PASSED 9 Aug 2026

A real edge-case test exposed a browser-side isolation bug: the HP browser could show the plumber Space while still using the saved owner bridge identity. This made owner external-AI grants appear in the plumber UI and could cause a revoke from the plumber screen to hit the owner OAuth namespace.

The fix now:

- binds a Space to an explicit saved bridge identity instead of using browser/array order
- fails closed when multiple bridges exist and no Space binding is known
- labels saved bridge identities as Owner vs Private in AI Access
- forces an `MSB2.` connection with `connectionId` onto `/c/<connectionId>` at the low-level bridge request path
- refuses a scoped bridge test if the returned customer identity does not match

Live HP verification showed `WIZZ HP Bridge · Owner` separately **READY** while `WIZZ HP Bridge · Private` was **IN USE** for the plumber Space. The plumber AI Access list then showed only the plumber tenant's own authorisation.

Relevant production hardening includes commits `977a678` and `fbaa27c`.

### Fresh real customer proof

A genuinely separate plumber customer was tested using:

- HP Chrome Incognito
- new Space: `plummers memory`
- fresh `MSB2.` customer connection
- fresh Claude account on a separate account/email

Verified live:

- plumber browser inherited no owner external-AI authorisations
- Claude authorised against the plumber scoped customer route
- Claude read the correct plumber Space
- initial read reported exactly **1 confirmed memory**
- returned memory matched the plumber/kitchen-fitting/3D-model-work test memory
- Claude used `propose_memory`
- proposal arrived pending for human approval instead of becoming trusted memory automatically
- after approval the plumber Space showed **2 confirmed memories**

This proves a fresh unrelated customer can perform:

```text
scoped customer connection
  -> OAuth
  -> real Memory Space read
  -> memory proposal
  -> human approval boundary
```

without inheriting the owner's current workspace/provider state.

### Live plumber -> owner negative-read proof — PASSED 9 Aug 2026

Using the real plumber Claude MCP connection, Claude deliberately attempted to retrieve an owner-only marker from the separate owner `Memory App` Space.

Observed live:

- `search_memory` for the owner-only `Purpose of Memory Space` marker returned **0 results**
- `get_current_space_context` returned only `plummers memory`
- the plumber connection still saw only its own two confirmed memories
- no owner `Memory App` memories were returned

This is a real tool-level negative read, not merely an absent UI listing. The live plumber customer connection cannot retrieve the tested owner-only memory.

### Live owner -> plumber negative-read proof — PASSED 9 Aug 2026

Using the real owner Grok MCP connection from the normal owner phone path, Grok deliberately searched for plumber-only markers.

Observed live:

- current Space reported as `Memory App`
- current confirmed memory count reported as **11**
- `search_memory` for `copper pipe` returned **0 results**
- `search_memory` for `plummers memory` returned **0 results**
- `search_memory` for `plumber` returned **0 results**
- no plumber customer memories were returned

Together with the plumber -> owner test, this gives a live bidirectional cross-customer negative-read proof: each real external AI connection can read its own customer workspace while the tested other-customer markers remain inaccessible.

### Live scoped revoke + reverse authorisation proof — PASSED 9 Aug 2026

The real plumber/customer route was then tested through revoke and re-authorisation from both sides.

Observed live:

- plumber Space used `WIZZ HP Bridge · Private`; the owner bridge remained a separate `WIZZ HP Bridge · Owner`
- before revoke, plumber AI Access showed only **Claude** authorised
- disconnecting Claude from the plumber Space removed the plumber external-AI grant; plumber AI Access then showed **0 external AI apps authorised**
- the revoked plumber Claude chat reported that no live Memory Space MCP/tool connection was available
- owner phone remained on `Memory App` with **ChatGPT + Grok** still connected after the plumber revoke
- Claude was then authorised again on the owner phone, producing **ChatGPT + Claude + Grok** on the owner side
- after that owner-side Claude authorisation, the plumber HP still showed **0 external AI apps authorised**

The owner product loop also remained independently functional while plumber had no external AI connected:

- an external-AI proposal appeared in the owner `Memory App`
- the proposal required explicit human approval
- after approval the owner memory count moved from **11 -> 12**
- the saved decision was `Customer Isolation Proven End-to-End (Live Test)`

This closes the live customer-isolation/scoped-revoke test set: revoke on one customer does not affect the other, and authorising an AI on one customer does not appear on the other.

---

## PROVIDER STATUS — ENOUGH FOR V1

- Grok — full loop verified
- Mistral — full loop verified
- Claude — full loop verified
- Cursor — OAuth/DCR + 7 tools + real Memory Space read verified
- ChatGPT — OAuth/DCR connected and workspace publication verified; MCP tool actions not exposed/verified on current Plus account

**Provider-expansion work is closed for V1.**

Do not burn V1 time adding more providers unless a provider test exposes a generic compatibility problem relevant to the product.

---

## IMPORTANT OAUTH/RUNTIME RULE

A provider looking connected after restart is not enough.

For each supported external AI, eventually verify:

1. first authorization
2. access-token use
3. refresh-token use/rotation
4. bridge restart
5. invalid/expired refresh fallback to fresh DCR
6. visible reconnection

Redirect validation stays exact. Do not use wildcard OAuth callbacks as a shortcut.

Current known callback support includes Claude after commit:

- `e53ff7` — preserve Claude callback support in Windows autostart configuration

---

## V1 NEXT WORK

Priority order:

1. keep proposal -> human approval mandatory and add memory-poisoning review/audit hardening
2. improve durable browser storage/recovery toward IndexedDB/versioned migrations/export/import; keep the storage schema ready for the derived shelving/index layer below
3. run a genuine stranger test using only the app/customer setup path

The administrator rotation and stored legacy-owner credential retirement are now completed live; do not reopen them unless a real regression appears.

Do not mix Code Space, GitHub execution, banking or other future capability layers into the Memory core during V1.

---

## BANKED FUTURE PLAN — MANAGED AI ACCESS / MCP CONTROL PLANE

**Not V1 work. Stay on the current V1 security, permission, scope and storage track first.**

Longer term, remove another infrastructure layer from the normal customer experience. The customer should not have to understand or manually manage bridge selection, MCP URLs, tunnel addresses, pairing codes or provider-specific connection plumbing.

Target customer experience:

```text
Open Space
  -> AI Access
  -> choose Claude / Grok / ChatGPT / Mistral / other supported AI
  -> Authorize
  -> Connected
```

Memory Space can operate a managed AI-access control plane/gateway over the same generic MCP contract:

```text
                 MEMORY SPACE CONTROL PLANE
                           |
                 managed public gateway
                           |
          +----------------+----------------+
          |                |                |
      Customer A       Customer B       Customer C
          |                |                |
       Space A1         Space B1         Space C1
          |                |                |
   scoped AI grants  scoped AI grants  scoped AI grants
```

The service may automate:

- creation of isolated customer/Space routes
- MCP endpoint handoff
- OAuth/DCR/PKCE plumbing
- token refresh and reconnection
- provider connection status
- explicit revoke
- capability/scopes per AI
- audit/provenance
- abuse/rate monitoring
- detection of wrong-tenant route/token attempts
- security monitoring without needing to inspect private memory content

### Trust model

Do **not** implement this as one universal credential that can read every customer's memory.

Operate the routing/control plane without creating a skeleton key to all customer data. Each customer/Space connection keeps its own identity, secret, OAuth namespace, grant state, workspace runtime and revocation boundary.

Example future routing shape:

```text
bridge.memoryspace.example
  -> /c/customer-A/space-1/mcp
  -> /c/customer-B/space-7/mcp
  -> /c/customer-C/space-2/mcp
```

Exact product URL/naming is undecided; the isolation principle is the important part.

### Design lesson banked from the multi-bridge UI bug

A client path must never infer customer identity from array order, browser ordering or "first available bridge" behaviour.

Required resolution chain for every privileged operation:

```text
user identity
  -> customer identity
  -> Space identity
  -> connection identity
  -> AI grant
  -> requested capability
  -> operation
```

If identity is ambiguous, fail closed and ask for/resolve the intended connection. Never silently fall back to another saved customer connection.

This rule applies to status, publish, read, search, proposal pull, proposal write, revoke and future execution/artifact permissions.

### Preserve local/private mode

The managed control plane should be an easier product layer over the existing protocol, not a replacement for local/private ownership. A customer must still be able to run a private/local Memory Bridge and use the same permission model without a mandatory cloud-memory fallback.

Bank this architecture for after V1. Do not derail the present permission-hardening work to build it now.

---

## SCALING TRACK — MEMORY SHELVING / RETRIEVAL INDEX

Memory Space must remain useful after years of use when one customer may have thousands or tens of thousands of approved memories.

**The AI must never need to read the whole library to find the few memories relevant to the current task.**

Design rule:

```text
trusted original memories
        -> derived index / shelves / memory map
        -> scoped search
        -> exact original memory IDs
        -> small context packet for the AI
```

### Source-of-truth rule

- approved memory records remain the canonical source of truth
- automatic organisation must **not rewrite, merge away or silently alter original memories**
- shelves, summaries, clusters, tags, embeddings and indexes are derived data and must be rebuildable
- the organiser may reorganise the catalogue; it does not rewrite the books

### Retrieval model

The future retrieval layer should combine:

- exact/keyword search for names, filenames, IDs, commits and literal terms
- semantic search for conceptually related memories
- metadata filters for customer, Space, project, type, importance, status, date and source
- lifecycle awareness so current confirmed memories rank above superseded/archived history unless history is explicitly requested
- recency/relevance ranking

Expected route:

```text
AI asks a question
  -> resolve authorised customer + Space
  -> find relevant shelf/topic
  -> search only the relevant scope
  -> fetch a small set of exact source memories
  -> return an answer-sized context packet
```

### Shelf / Memory Map concept

A Space may expose derived catalogue entries such as:

```text
SPACE JUNKZ
- Weapon system       -> memory IDs...
- Boss architecture   -> memory IDs...
- Mobile performance  -> memory IDs...
- Audio               -> memory IDs...
- Deployment          -> memory IDs...
```

A shelf/card can contain pointers, counts, topic labels, last-changed time and a short derived description, but it is **not itself trusted memory** and cannot replace the originals.

### Candidate AI tools

Keep the API/tool design capable of supporting calls such as:

- `list_shelves`
- `search_memory`
- `search_space`
- `get_memory`
- `get_related_memories`
- `get_recent_changes`

The goal is for ChatGPT, Grok, Claude, local/free models and future workers to navigate the same long-term library efficiently without consuming their context window on irrelevant history.

### Security requirement

Every index/search/shelf operation must preserve the same customer and Space isolation as direct memory reads. A derived index must never become a side channel that reveals another customer's titles, topics, counts, embeddings or memory contents.

### Build timing

Do not derail the remaining V1 security/permission/storage work for this. However, storage and memory-ID decisions made now must not block it. After the core V1 safety path is closed, prototype the smallest useful shelf/index layer against a larger synthetic memory set and measure retrieval quality/context reduction before adding automatic summarisation or complex clustering.

---

## PRODUCT RULES — KEEP THESE

- Memory Space owns long-term truth.
- User is final authority.
- Models are replaceable workers.
- External AI reads only authorised customer/Space context.
- External AI durable changes are proposals only.
- AI cannot approve its own proposal.
- Trusted memory changes require human approval/edit/reject.
- Customer identity must resolve before publish/read/search/propose operations.
- Access to one customer/Space must never imply access to another.
- No silent cloud fallback.
- Local/private operation remains first-class.
- Knowledge, artifacts and execution remain separate permission layers.

---

## DEVELOPMENT HANDOFF RULE

For new development chats:

1. read `V1_LEDGER.md`
2. read only the actual code/files needed for the task
3. do not read the giant `README.md` unless historical context is genuinely required
4. make the smallest safe change
5. test the meaningful boundary
6. update this ledger only with the new verified state and immediate next work

**Do not let the ledger become the project. Keep building the app.**