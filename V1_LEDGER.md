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

Known onboarding issue still to verify/fix:

- an earlier fresh-customer test showed the first manually created memory (`My name`) as **Critical + Locked**
- current `app.js` explicitly defaults a new manual memory to **Normal + Unlocked**, so reproduce the issue on the current build before patching rather than guessing at an old/stale state

### Customer isolation

Customer-scoped bridge routing is implemented on `main`.

New unrelated customers use:

```text
/c/<connectionId>
/c/<connectionId>/mcp
```

Each customer receives:

- random `connectionId`
- unique derived/revocable customer secret
- scoped `MSB2.` Private Access Code
- separate OAuth namespace/state
- separate RAM-only published workspace
- separate RAM-only proposal queue

The original 64-character bridge token is administrator/bootstrap-only and must not be handed to customers.

Legacy `MSB1.` + root `/mcp` remains only for owner/single-owner compatibility.

Customer connection registry is encrypted at rest. Memory Space contents are not stored in that registry.

### Automated isolation regression

Passing regression verifies separate NIKE and PLUMBER customers:

- workspace markers remain separate
- cross-customer search returns no other-customer data
- wrong-customer token/route use is rejected
- revoking one customer does not revoke the other

Important merged commit:

- `ce5010d` — customer isolation regression retained on `main`

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

1. reproduce the first-memory Critical + Locked report on the current build; patch only if it still occurs
2. enforce `memory.read` and `memory.propose` at individual MCP tool boundaries
3. rotate exposed development/master credentials before wider testing
4. keep proposal -> human approval mandatory and add memory-poisoning review/audit hardening
5. improve durable browser storage/recovery toward IndexedDB/versioned migrations/export/import; keep the storage schema ready for the derived shelving/index layer below
6. run a genuine stranger test using only the app/customer setup path

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