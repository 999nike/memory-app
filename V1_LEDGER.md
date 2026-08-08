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

Known onboarding issue still to fix:

- first manually created memory can be classified as **Critical + Locked** automatically; this default/classification behaviour is not considered finished

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
- Claude reported exactly **1 confirmed memory**
- returned memory matched the plumber/kitchen-fitting/3D-model-work test memory
- Claude used `propose_memory`
- proposal arrived pending for human approval instead of becoming trusted memory automatically

This proves a fresh unrelated customer can perform:

```text
scoped customer connection
  -> OAuth
  -> real Memory Space read
  -> memory proposal
  -> human approval boundary
```

without inheriting the owner's current workspace/provider state.

---

## STILL TO VERIFY LIVE

Do **not** mark these as passed until directly observed:

1. ask plumber-Claude for an owner-only marker and prove it cannot read it
2. ask owner path for a plumber-only marker and prove it cannot read it
3. revoke the plumber connection
4. prove plumber access is dead
5. prove owner connection still works after plumber revoke

Automated regression already covers this class of isolation; this remaining task is the explicit real external-account proof.

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

1. finish explicit live owner-vs-plumber cross-read + revoke proof
2. fix first-memory Critical + Locked default/classification behaviour
3. enforce `memory.read` and `memory.propose` at individual MCP tool boundaries
4. rotate exposed development/master credentials before wider testing
5. keep proposal -> human approval mandatory and add memory-poisoning review/audit hardening
6. improve durable browser storage/recovery toward IndexedDB/versioned migrations/export/import
7. run a genuine stranger test using only the app/customer setup path

Do not mix Code Space, GitHub execution, banking or other future capability layers into the Memory core during V1.

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
