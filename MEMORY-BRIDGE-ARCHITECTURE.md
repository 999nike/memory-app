# WIZZ Apps — architecture, routes, ownership and recovery handoff

**Recorded:** 22 September 2026, UK time. **Purpose:** prevent future chats or coding agents from confusing separate applications, changing the wrong runtime, breaking existing authorisations or inventing missing routes.

> **READ THIS FIRST:** The **new application is Universal Space** at `E:\WIZZ-Server\new-version\universal-space`, normally opened on `http://127.0.0.1:4173`. The **old/conventional Memory Space frontend** is a different interface at `http://127.0.0.1:8001`, served from `E:\WIZZ-Server\workspaces\memory-app`. The **Memory Bridge backend** runs from the *old memory-app workspace's `bridge` subfolder* on `127.0.0.1:8787`. It is a shared live backend, not the old frontend. **The September 22 repair changed the Bridge backend, not either frontend.** The user subsequently reported that their connection went through; record exactly what they observed rather than claiming every frontend and provider is independently tested.

**Classification:** `CONFIRMED 22 SEP` = reported by the final controlled repair and/or user; `SOURCE` = verified in named source files; `HISTORICAL 14 SEP` = earlier read-only running-process inventory; `UNKNOWN` = not established. An observed UI, listening port, GitHub file or HTTP 200 **does not** establish that all higher-level workflows work. Where this document says “route”, it means a source-confirmed or previously recorded route; it is **not** a claim that every endpoint in every repository has been audited. Do not silently turn UNKNOWN into an assertion.

## 1. Which program is which — do not mix them up

| Component | What the user sees/what it does | Actual working location | Normal local address | Ownership/relationship |
|---|---|---|---|---|
| **NEW Universal Space** | Spatial/universe interface, memory graph, app clusters, Orb, Gmail, Code Space and Office navigation | `E:\WIZZ-Server\new-version\universal-space` | `http://127.0.0.1:4173` | The user's active new application. Node `server.mjs`; separate from old frontend. |
| **OLD Memory Space** | Conventional/“boring” standalone Memory UI | `E:\WIZZ-Server\workspaces\memory-app` | `http://127.0.0.1:8001` | Python static frontend. Do not send the user here when they mean Universal Space. |
| **Memory Bridge** | Customer-specific memory API, OAuth, external-AI MCP, approved workspace snapshot, proposed memories and Office job feed | `E:\WIZZ-Server\workspaces\memory-app\bridge` | `http://127.0.0.1:8787` | Shared backend in old workspace. Its file location does **not** make it the old frontend. Public HTTPS Bridge is the external entrypoint. |
| **WIZZ Supervisor** | Stores/provides an authorised, narrowed Memory job-feed source for Office | `E:\WIZZ-Server\new-version\universal-space\supervisor` | `http://127.0.0.1:8790` | Started by Universal Space `server.mjs` with `ensureSupervisor()`; historically same Node process as 4173. **Not** the Memory Bridge watchdog. |
| **Office** | Defines/tracks jobs, worker identity, permissions, dispatch, Memory Jobs and review | `E:\WIZZ-Server\workspaces\office-app` | `http://127.0.0.1:4176` | Different app. Office decides the job; it cannot independently execute it. |
| **Code Space** | Workspace dashboard, dispatch inbox, user-authorised execution, file/project management and editor wrapper | `E:\WIZZ-Server\workspaces\code-space` | `http://127.0.0.1:8090` | Different app; its Node wrapper invokes/embeds WSL code-server. |
| **code-server** | Actual browser VS Code editor/terminal engine | Ubuntu WSL (`/home/wizz`, project mounts `/mnt/e/...`) | `127.0.0.1:8080` via Windows loopback relay | WSL user systemd `code-space-code-server.service`. Not the Code Space :8090 wrapper. |
| **Ollama** | Local inference for Universal Space local Orb and Bridge model target | Installed in Windows; configured model files under `E:\WIZZ-Server\ollama-models` | `127.0.0.1:11434` | Separate local inference runtime; exact active model must be read from current config. |
| **Kokoro FastAPI** | Local Orb speech synthesis | `E:\WIZZ-Server\kokoro-fastapi` | `:8880` | Universal Space forwards speech requests to it. |
| **Cloudflared** | Cloudflare Tunnel transport to approved public hostnames | Windows service `Cloudflared` | Public tunnel; local service listener observed at :20241 (purpose uncertain) | A restart can interrupt multiple public services; not a Bridge-only operation. |
| **Caddy** | Landing site, static media at `/media/*` | `E:\WIZZ-Server\Caddyfile` | `:80` (admin :2019 local) | Separate from :8081 HTTP media server. |
| **WIZZ media http-server** | Additional loopback media HTTP server | `E:\WIZZ-Server\media` | `127.0.0.1:8081` | Separate process; Caddy's `/media/*` independently reads the folder. |
| **AI-world** | Separate civilisation simulation | `E:\wizz-bot\AI-world` | `127.0.0.1:8082` | Not the similarly named older `E:\WIZZ-Server\workspaces\AI-world`. |

**Process IDs from the 14 September inventory are historical, NOT safe kill targets.** After the September 22 Bridge restart, any earlier Bridge supervisor/Node PIDs are invalid. Confirm current PID, full command line, parent-child ownership and port before even proposing a process action.

## 2. Conceptual dependency and request map

```text
USER — NEW Universal Space browser :4173
  ├─ Canonical graph (Memory + Settings special paths; Gmail/Office/Code Space adapters)
  ├─ Memory/AI Access customer-scoped browser flows ───────┐
  ├─ Embedded WIZZ Supervisor :8790 (same Universal runtime historically)
  │      └─ authorised Office Memory source/capability ─────┤
  ├─ Office navigation/approved iframe :4176                │
  │      └─ Office manual Memory Jobs ──────────────────────┤
  ├─ Code Space overlay :8090 -> WSL code-server :8080      │
  ├─ Local Orb :4173/api/orb/local/* -> Ollama :11434        │
  ├─ Local TTS :4173/api/orb/tts -> Kokoro :8880             │
  ├─ Optional Realtime Orb :4173/api/orb/realtime -> OpenAI  │
  └─ Gmail :4173/api/gmail/* -> Google Gmail API            │
                                                          │
GROK / OTHER AUTHORISED EXTERNAL AI                       │
  -> HTTPS https://bridge.w-i-z-z-lab-studios.com         │
  -> Cloudflare Tunnel -> loopback Memory Bridge :8787 <──┘
       ├─ /c/{connectionId}/... isolated private tenant
       ├─ OAuth discovery / register / authorize / token
       ├─ POST /c/{connectionId}/mcp; scoped read/propose tools
       ├─ RAM-only explicitly published workspace + proposal queue
       ├─ /c/{connectionId}/v1/jobs/* job-feed token for Office
       ├─ encrypted customer connection records on disk
       ├─ encrypted OAuth client/grant files on disk
       └─ optional local model calls -> Ollama :11434

OFFICE :4176 -> authorised WIZZ Supervisor :8790 -> customer job-feed :8787
       -> creates persistent Office job, dispatch package/permissions
       -> Code Space :8090 validates package
       -> USER chooses Authorise & Start / Reject
       -> bounded execution; report/handoff (no automatic push/merge)

OLD conventional Memory frontend :8001 [SEPARATE UI]
       -> may use the same :8787 Bridge; NOT the development UI.
```

The *detailed* Universal Space browser→Bridge HTTP invocation path needs a **read-only live browser-network/source trace** if a future change depends on it. The user's successful connection is evidence of the connection they just attempted, not proof of each internal browser call or an Office collection. Do not invent the trace.

## 3. Repositories, branches and boundaries

| Repo | Branch/role | Important distinction |
|---|---|---|
| `999nike/memory-app` | `main`: frozen conventional Memory interface/reference | Preserve. The production Bridge is housed in a `memory-app` workspace, but do not assume `main` on GitHub equals its patched live files. |
| `999nike/memory-app` | `molecular-v2`: ONE active new Universal Space development/testing branch | Expected working folder `E:\WIZZ-Server\new-version\universal-space`; never switch to `main` because user says “main folder”. |
| `999nike/memory-app` | `memory-office-bridge-snapshot-2026-09-03`: safety snapshot of conventional project | It is a **branch of the same repo**, not a third Memory app. |
| `999nike/office-app` | `universal-space-office-bridge`: new working Office | Conventional `main` historically preserved separately. |
| `999nike/code-space` | `code-space-working-snapshot-2026-09-03`: saved Code Space/Worker App integration | Conventional `main` historically preserved separately. |

A 3 September branch record lists `molecular-v2` at `48a140b`, Office at `46bd8ff`, and Code Space at `9fbf759`; these are **dated snapshot references**, not today's local HEADs. A GitHub branch query during preparation showed remote `molecular-v2` at `8d010d6bc45cc09a00645550ab0b87b2d2578b56` (11 September). Neither establishes the current HP checkout. **The 22 September Bridge repairs were performed on the live local Bridge and were not reported committed or pushed.** A `git pull`, checkout, reset, restore, branch switch, deployment or copy from a frozen reference can overwrite the fix; never do one casually.

Protected locations: `E:\WIZZ-Server\new-version\memory-app-visual-lab\memory-app` is a protected original; `E:\junkz backup` is private and must not be inspected or modified without explicit permission. No new clones, worktrees, automatic backups, root-level audit files or alternative working folders.

## 4. The public customer route is not a local port or legacy root

**Configured public base, confirmed 22 September:**

```text
https://bridge.w-i-z-z-lab-studios.com
```

**Private customer issuer (replace placeholder; do not expose a real ID unnecessarily):**

```text
https://bridge.w-i-z-z-lab-studios.com/c/{connectionId}
```

**External Grok MCP endpoint:**

```text
https://bridge.w-i-z-z-lab-studios.com/c/{connectionId}/mcp
```

**Internal origin on HP:** `http://127.0.0.1:8787` (the HTTPS tunnel terminates externally, then forwards to local HTTP). The active public hostname was proven by HTTPS discovery; verify actual Cloudflare dashboard route configuration before asserting its full tunnel configuration. **Do not paste `127.0.0.1:8787`, `127.0.0.1:8001`, `127.0.0.1:4173`, bare `/mcp` or a root issuer into Grok's private-customer connector.** A customer-specific path is required to maintain tenant isolation.

A customer MSB2 access code is a **secret**, not a public URL; never print one in documentation, screenshots, logs or chat. Store/handle it only via existing application mechanisms. Never expose admin/owner token, OAuth client tokens, feed tokens, CLIXML contents or other private identifiers.

### 4.1 Customer OAuth discovery and authorisation — source-confirmed routes

Prefix all tenant paths with `https://bridge.w-i-z-z-lab-studios.com` externally (or `http://127.0.0.1:8787` for authorised internal diagnostics):

| Method | Path | Purpose / caution |
|---|---|---|
| GET | `/.well-known/oauth-protected-resource/c/{connectionId}/mcp` | Resource discovery for this private MCP server. |
| GET | `/.well-known/oauth-authorization-server/c/{connectionId}` | Tenant authorization-server metadata. |
| GET | `/c/{connectionId}/.well-known/oauth-protected-resource` | Tenant-scoped protected-resource metadata supported by handler. |
| GET | `/c/{connectionId}/.well-known/oauth-protected-resource/mcp` | Tenant-scoped resource metadata variant. |
| GET | `/c/{connectionId}/.well-known/oauth-authorization-server` | Tenant-scoped authorization metadata variant. |
| POST | `/c/{connectionId}/register` | Dynamic client registration; **creates persistent registration, not a read-only health test**. |
| GET | `/c/{connectionId}/authorize` | User-facing OAuth consent page. |
| POST | `/c/{connectionId}/authorize` | Consumes user approval; grants authorization code. Not a harmless probe. |
| POST | `/c/{connectionId}/token` | Authorization-code or refresh-token exchange; stateful, credential-bearing. |
| POST | `/c/{connectionId}/mcp` | Actual authenticated MCP request (HTTP POST). GET standalone SSE is intentionally rejected with 405. |

Expected metadata must advertise a **matching HTTPS issuer** `.../c/{connectionId}` and its **matching** `/authorize`, `/token` and `/register` routes. OAuth uses PKCE S256 and constrained redirect URI registration; do not loosen redirects or skip consent to “fix” a 500/401. The OAuth scope set is `memory.read` and `memory.propose`.

Legacy/root OAuth discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`) and root `/authorize`, `/token`, `/register` exist for the older owner/legacy flow; `/mcp` is the legacy root MCP endpoint. **These are not substitutes for a private customer's paths.** The backend also has an older root `POST /authorize` compatibility shim that interprets an MSB2 credential and routes it to its tenant; don't use that as justification to wire a new client to the root.

### 4.2 Private connection and Memory API — source-confirmed routes

**Customer prefix:** every path below is `/c/{connectionId}` + listed suffix. These normal customer APIs require a verified customer bearer/access code except the separate OAuth flows and OAuth-authenticated MCP. **Administrator root endpoints use a different credential and are not tenant APIs.**

| Method | Suffix | Function and side effects |
|---|---|---|
| GET | `/v1/info` | Authenticated protocol/capability and workspace-published status. No memory context sent. |
| POST | `/v1/chat` | Sends an explicitly approved context package to configured local model. Not a generic external-AI OAuth path. |
| GET | `/v1/oauth/clients` | Lists **authorised clients with currently active OAuth tokens**, not all persistent DCR registrations. Count 0 does NOT mean all registrations were erased. |
| POST | `/v1/oauth/clients/revoke` | **Destructive:** revokes one client's OAuth credentials. Requires user approval. |
| PUT | `/v1/workspace/snapshot` | Publishes one explicitly shared active Space and allowed memories/jobs **into Bridge RAM**; not persisted workspace storage. This updates ephemeral shared state. |
| POST | `/v1/workspace/proposals/pull` | **Consumes/drains** the pending proposal queue for review; not a read-only GET. |
| POST | `/v1/jobs/access` | Authenticates customer and returns narrow, connection-scoped Office feed URL/token. Credential-bearing; use only by approved application flow. |
| GET | `/v1/jobs/ready` | Requires **derived job-feed token**, lists ready uncollected jobs only. |
| POST | `/v1/jobs/{memoryJobId}/collected` | Requires job-feed token, records accepted Office job ID/acknowledgement; **mutates state**. |

The root legacy/owner flow includes the corresponding unprefixed `/v1/info`, `/v1/chat`, `/v1/oauth/clients`, `/v1/oauth/clients/revoke`, `/v1/workspace/snapshot`, `/v1/workspace/proposals/pull`, `/v1/jobs/access`, `/v1/jobs/ready` and `/v1/jobs/{memoryJobId}/collected`. Do not confuse these routes with customer ones; authorization and isolation differ.

**Root administrator routes:** `GET /v1/connections` lists customers; `POST /v1/connections` **creates a customer**; `POST /v1/connections/revoke` **revokes a customer and deletes their tenant OAuth file/clears RAM**. Never create, revoke or run mutating endpoints simply to test a fix. No duplicate customer creation is authorised by this handoff.

### 4.3 MCP tool contract and permanent-memory boundary

- `memory.read`: `list_spaces`, `search_memory`, `get_current_space_context`, `read_memory`, `get_current_decisions`, `inspect_provenance`.
- `memory.propose`: `propose_memory`, `propose_memory_bundle`.
- **External AI proposes; human approves in Memory Space/Universal Space.** Proposal acknowledgment is not permanent memory creation, and MCP tools cannot directly save/approve memory or run arbitrary jobs.
- The publisher accepts **one explicitly shared active space** per snapshot. Current confirmed memories and ready jobs pass validation; superseded/archived/deleted memories must not be shared. The runtime keeps published space, authorization codes, proposal queues and acknowledgements in RAM. A restart loses RAM-only snapshots/proposals; the authorised frontend must republish. Do not infer destroyed durable memory from an empty shared snapshot after restart.
- The Bridge stores encrypted connection/OAuth records on disk but **does not own the browser's durable Memory workspace**. A customer who has valid OAuth access still needs a currently published shared Space to read its content.

## 5. Office job feed and Code Space execution — explicit sequence

```text
Memory Space / Universal Space (user-approved job in active space)
    -> publishes allowed snapshot to Bridge :8787
    -> explicit Office Memory Jobs collection action (NO background collection)
    -> Office :4176 requests source from WIZZ Supervisor :8790
    -> Supervisor returns only authorised connection-specific feed URL/token
    -> Office GETs Bridge /c/{id}/v1/jobs/ready
    -> Office persists a job and deduplicates by original memory job ID
    -> Office POSTs Bridge /c/{id}/v1/jobs/{memoryJobId}/collected
       with its real Office job ID; Bridge queues acknowledgement for next snapshot sync
    -> Office defines worker, instructions and explicit permissions
    -> frozen, versioned office-dispatch-package v1 is sent to Code Space :8090
    -> Code Space validates package and presents NEW JOB
    -> USER explicitly selects Authorise & Start or Reject
    -> Code Space executes only permitted, sandbox-scoped capabilities
    -> result/handoff persisted; no automatic Git push/merge
```

**Do not convert the manual collector to a background worker.** The product plan explicitly keeps it user-click-driven. Office data is stored in browser localStorage per its V3 product ledger; do not equate a Bridge RAM snapshot with Office durable storage or with GitHub. Job source metadata is not blanket filesystem authority. Denied or omitted permissions remain unavailable. No dispatch arrival or Ready status may auto-start execution. Production write privileges are not implied by sandbox proofs.

### 5.1 Office :4176 HTTP routes verified in its inspected server source

| Method | Route | Upstream/behaviour |
|---|---|---|
| GET | `/api/memory-bridge/status` | Calls WIZZ Supervisor `GET /v1/health`, returns bounded status (running, authorised/not, feedAvailable). Does not itself prove job collection. |
| GET | `/api/memory-jobs` | Fetches the capability-authorised active source from Supervisor `GET /v1/office-source`; then calls its Bridge feed `/ready` with job-only bearer. |
| POST | `/api/memory-jobs/{memoryJobId}/collected` | Same authorised source, then relays job acknowledgement to Bridge feed `/{memoryJobId}/collected`. Mutating. |
| GET | `/` and app static assets | Serves Office frontend; an Office-owned hidden iframe bridge allows only the Universal Space origin `http://127.0.0.1:4173` and bounded display fields. Exact iframe page path should be traced in currently loaded Office frontend before editing. |

Office must obtain the authorized source through WIZZ Supervisor. **Do not launch Office with an arbitrary direct `node server.mjs` command** as a repair: the Worker App launcher normally obtains the derived feed credential first, and a bare launch can bypass the intended setup.

### 5.2 WIZZ Supervisor :8790 — not Bridge watchdog

| Method | Route | Requirement |
|---|---|---|
| GET | `/v1/health` | Bounded health/source status; no secret returned. |
| GET | `/v1/office-source` | Supervisor capability bearer required; returns authorised source internally. |
| POST | `/v1/office-source` | Supervisor capability required; **authorises/changes source and persists it**; must only occur after user's explicit approved app action. |

This HTTP service is implemented in Universal Space's `supervisor/server.mjs`, started with `ensureSupervisor()` from Universal Space's `server.mjs`; it is **not** independently safe to restart. Its capability file is in `%LOCALAPPDATA%\WIZZ\supervisor\service-capability`; never print or copy its contents. Office's `WIZZ_SUPERVISOR_URL` defaults to `http://127.0.0.1:8790`.

### 5.3 Code Space :8090 and WSL :8080

Code Space is a separate Windows Node service; its wrapper sends the user to Ubuntu WSL's code-server editor when needed. It exposes an approved narrow project-name catalog to Office, the package receipt/validation/execution boundary, and its own UI. Universal Space's `codex.open` opens the existing Code Space service at `http://127.0.0.1:8090/` in a detail overlay; this is **not** an instruction to run Code Space inside Universal Space's process. Some Universal Space Jobs/Git/Terminal nodes are status-only or unconnected in dated handoff; don't advertise them as executable without confirming current code.

The complete Code Space HTTP endpoint inventory has **not** been audited for this document. Before editing a specific dispatch/terminal route, inspect the current `E:\WIZZ-Server\workspaces\code-space\server.js`, `worker-app-supervisor.js`, `dispatch-*` modules and matching tests **read-only**, documenting each exact method, path, authorization and side effect. Never guess those route names from a button caption.

## 6. Universal Space :4173 — verified server route families

The 11 September `molecular-v2` source `server.mjs` imports the embedded WIZZ Supervisor and three Orb route modules. The new app is the **canonical graph/solver/renderer**, not a reimplementation of each Office/Code Space program. `universal-app-adapters.js` registers app definitions/actions, namespaced node IDs and refresh; `memory-graph.js` traverses definitions into the **one** canonical graph. Memory and standalone Settings have existing special paths; Gmail and Code Space are registered adapters; the fixed OFFICE map uses ten first-level spokes, with actual jobs/ledger in the right inspector instead of adding each record as a graph node. Do not rebuild organism connectors, trunks, tissues, spine, fibres, renderer or physics. Generated app/control nodes must never become durable Memory records, exports, AI context, proposal storage or memory counts.

| Method | Route | Purpose / limits |
|---|---|---|
| GET, HEAD | `/`, frontend assets | Serves new Universal Space web UI. Static response by itself does not prove the loaded JS runs. |
| GET | `/api/code-space/projects` | Bounded local list of direct project folders, read-only. |
| GET | `/api/code-space/files?project={project}` | Bounded, validated local file catalogue, read-only. |
| GET | `/auth/gmail/start` | Begins Gmail OAuth; starts an authorisation flow, not a passive status probe. |
| GET | `/auth/gmail/callback` | OAuth callback; writes protected Gmail token only after successful exchange. |
| GET | `/api/gmail/status` | Gmail configuration/connection/readonly scope status. |
| GET | `/api/gmail/summary` | Gmail inbox/unread/draft counts, last-known stale summary on transient failure. |
| GET | `/api/gmail/messages?label={label}&limit={n}` | Fixed allowed labels and at most 10 message headers for right inspector. |
| GET | `/api/gmail/message?id={messageId}` | One selected message detail; full body requires Gmail `gmail.readonly` grant. |
| GET | `/api/orb/local/status` | Local Ollama availability/model; same-origin/private only. |
| POST | `/api/orb/local/chat` | Limited local navigation/chat response via Ollama :11434. |
| POST | `/api/orb/local/proposal` | Structured local proposal request; **not** direct execution or permanent save. |
| POST | `/api/orb/tts` | Same-origin PCM speech proxy to Kokoro `http://127.0.0.1:8880/v1/audio/speech`. |
| POST | `/api/orb/realtime` | Local-only SDP/WebRTC exchange via server-side OpenAI Realtime API; no permanent API key exposed to browser. |

**Gmail:** API read-only scope; protected secrets/token path `E:\WIZZ-Server\secrets\universal-space-gmail`. Never print or copy credentials into repo/docs/backups. Inbox/Unread/Sent/Drafts remain fixed navigation nodes; message bodies belong only in inspector, not graph topology. Google OAuth callback URI from inspected source: `http://localhost:4173/auth/gmail/callback`. Existing metadata-only grants need explicit reauthorization for full message bodies.

**Orb:** local Orb generally consults Ollama :11434 (`GET /api/tags`, model chat calls); speech uses Kokoro :8880. Optional realtime voice goes to OpenAI's Realtime API via server-side key and is a **separate path** from local Ollama. Orb's permissions are navigation/help/highlight and, where explicitly supported, proposing a job for human approval. Orb may **not** approve actions, execute jobs, edit/delete files, send messages, bypass permissions or launch arbitrary terminal/Codex commands. A “Ready” Orb indicator does not certify Memory Bridge OAuth/Grok.

**Graph-level UI entry nodes (dated 3 September branch map):** Memory: Memories, New Memory, Groups, Search, Settings, Open Memory App. Office: Memory Jobs (first level), Dashboard, Jobs, New Job, Workers, Dispatch, Projects, Important, Settings, Open Office. Code Space: Jobs, Projects, Files, Codex, Terminal, Git, Settings, Open Code Space. These are navigation labels, **not automatically HTTP URLs or fully implemented controls**. Verify current UI before changing any one.

## 7. Additional service and public routes

| Route/address | Known use | Evidence boundary |
|---|---|---|
| `http://127.0.0.1:11434/api/tags` | Orb detects installed Ollama models. | Inspected Orb local source. |
| `http://127.0.0.1:11434/api/chat` | Orb structured local proposal. | Inspected source. |
| `http://127.0.0.1:11434/v1/chat/completions` | Orb chat and default Bridge model target. | Source default; actual target/model may be environment-overridden. |
| `http://127.0.0.1:8880/v1/audio/speech` | Kokoro TTS upstream. | Inspected source. |
| `https://api.openai.com/v1/realtime/calls` | Optional Orb realtime signalling. | Inspected source; does not imply configured API key or successful session. |
| `http://127.0.0.1:8090/` | Code Space UI/Universal overlay. | Dated handoff/source. |
| `http://127.0.0.1:8080/` | WSL code-server engine. | 14 Sep inventory. |
| `http://127.0.0.1:8081/` | Independent media server. | 14 Sep inventory. |
| `http://127.0.0.1:8082/` | AI-world simulation. | 14 Sep inventory. |
| `http://<HP-host>/media/*` on Caddy :80 | Static file serving from `E:\WIZZ-Server\media`. | Historical Caddy inventory/config role; don't assume identical to :8081. |
| `https://media.w-i-z-z-lab-studios.com/space-junkz/...` | Separately recorded public Space Junkz media route. | Earlier project notes; NOT a Memory Bridge, Office or Universal UI route. Recheck before making deployment changes. |

**Unknown:** entire Cloudflare Tunnel hostname→local-port map beyond proven Bridge endpoint, live AI-world internals, full Code Space HTTP router, exact browser frontend→Bridge request sequence, which provider tokens/renewals were exercised by the user's successful attempt, complete realtime/Gmail feature readiness, and current PID/HEADs. Future chats should mark those UNKNOWN and verify read-only rather than guess.

## 8. September 22, 2026 Bridge incident — exact fault and correction

**Initial symptoms:** External Grok OAuth dynamic client registration produced HTTP 500 “Failed to register client.” Public OAuth discovery showed localhost HTTP URLs despite a public HTTPS endpoint. Separately, an earlier UI session saw 401 on the client listing and proposal-pull routes; the precise credential responsible for those particular 401s was *not* conclusively established, so do not claim they were individually proven fixed.

**Root cause 1 — environment startup mismatch:** `bridge/.state/windows-runtime.json` on the HP had `publicUrl` set to `http://127.0.0.1:8787`. The PowerShell `bridge/windows/start-bridge.ps1` launcher reads this JSON and sets `MEMORY_BRIDGE_PUBLIC_URL` **once when the supervisor starts**; its long-running watchdog then launches/relaunches Node children without rereading configuration. Updating JSON + restarting only Node leaves the child's inherited public URL as HTTP. This actually happened during the repair. The corrective restart had to include the identity-verified dedicated **Memory Bridge PowerShell watchdog and its Node child**, not the unrelated Universal WIZZ Supervisor :8790 or Worker App group.

**Root cause 2 — changing public URL affects credential-derived encrypted identity:** Connections generate MSB2 credentials with encoded base URL, connection ID and secret. The existing **job-feed credential and HMAC token** depended on the historical HTTP-derived MSB2 value; encrypted OAuth tenant files had instead been created with **HTTPS-derived customer credentials**. Blindly flipping a URL, rotating a pairing secret or using a single derived credential for both uses would either change job-feed fingerprints or prevent decryption of those existing OAuth files.

**Authorised local repair (do not reapply blindly):**

1. `bridge/connection-state.mjs` preserves/pins the previously issued customer credential in encrypted connection state and supports the preserved credential for verification/job feed while accepting the new HTTPS representation. The original job-feed fingerprint stays stable.
2. `bridge/oauth-state.mjs` adds a narrowly guarded legacy HTTP→HTTPS issuer migration only for the matching customer if needed. The **actual** three production encrypted OAuth records already had HTTPS issuers; no broad token reset was required.
3. In the **LIVE** `bridge/server-v2.mjs`, `getTenantOauth()` obtains the OAuth encryption credential with `connections.accessCodeFor(connectionId)`, **not** `connections.credentialFor(connectionId)`. `jobFeedCredential()` deliberately continues to use pinned `connections.credentialFor(connectionId)` for customer feed stability. **Do not merge these two key roles.** A GitHub `main` source reference examined during documentation still showed the older `credentialFor()` call in `getTenantOauth()`; that remote source is not proof of the live patched state.
4. The LIVE `.state/windows-runtime.json` now configures `publicUrl` as `https://bridge.w-i-z-z-lab-studios.com`. Exactly one additional explicitly authorised, identity-checked supervisor+Node restart reloaded HTTPS in process environment. A child-only restart had been insufficient. No other services were authorised for restart.

**Protected verified repair backup:**

```text
E:\WIZZ-Server\workspaces\memory-app\bridge\.state\repair-backups\bridge-https-20260922-155952
```

Seven relevant files were backed up with SHA-256 integrity/ACL verification before the final correction, including source/config/encrypted connection and tenant OAuth state. This is an incident recovery reference, **not** a new automatic backup destination, not permission to copy it over live data and not a licence to expose secrets.

**Codex's final post-restart preservation and readiness report:**

| Check | Reported result |
|---|---|
| Backup integrity; encrypted customer records; three tenant OAuth files unchanged | PASS |
| Exact dedicated supervisor/child ownership; exactly one authorised restart | PASS |
| New supervisor loaded HTTPS runtime configuration | PASS |
| Previously issued customer credentials | 12/12 locally and publicly PASS |
| Current HTTPS customer credentials | 12/12 PASS |
| Tenant OAuth files decrypt | 3/3 PASS |
| Encrypted OAuth dynamic registrations restored | 7 total PASS |
| Active OAuth refresh tokens preserved | 2 PASS |
| Office job-feed fingerprint | Unchanged PASS |
| Public OAuth metadata | 3/3 tenant scopes correctly advertise HTTPS issuer, authorisation, token and registration endpoints |
| OAuth restoration errors after restart | None detected in checked log |

**Logging caveat:** explicit success lines for OAuth restoration were not found in the parsed log slice; direct authenticated decryption and public discovery passed. **Follow-up:** user subsequently reported “it went through,” apparently after trying the connection. Do not upgrade that statement to a fully instrumented verification of every Grok tool, original conventional UI, new Universal UI and Office flow without testing those individually. It is meaningful positive user evidence of their attempted connection.

**Freeze the whole live state, not just a Git branch:** the working JS patch; `.state/windows-runtime.json`; encrypted connection records; three tenant OAuth files; CLIXML protected credentials; the launcher and its inherited environment; public hostname/customer issuer; existing MSB2 credentials; Office job-feed fingerprint. All are parts of the working identity. Changing any one can make the others appear broken. **Do not recreate customers, revoke OAuth grants, rotate tokens, delete `.state`, overwrite live code with GitHub `main`, clear storage, perform a blanket restart or create “fresh” credentials as a diagnostic.**

### 8.1 Safe diagnosis before any future repair proposal

- Confirm whether the user is in **NEW Universal Space :4173**, **OLD frontend :8001**, **Bridge :8787**, **Office :4176**, **Code Space :8090** or **WIZZ Supervisor :8790**. Ask only if genuinely unknown; do not silently substitute one for another.
- Read the current installed routing, protected state metadata **without printing secrets**, current runtime config, and current process identity in a read-only manner. Confirm what `:8787` actually runs and what HTTPS discovery advertises.
- Separate failures by layer: interface load, browser customer-bearer auth, OAuth metadata/registration/consent/token, encrypted state restore, published RAM snapshot, MCP read/propose, job-feed credential, Office collection, Code Space dispatch, local Ollama model or tunnel reachability.
- A 401 on `/v1/oauth/clients` can be a *customer access-code problem*. An empty client list can merely mean no active access/refresh tokens and is **not** equivalent to missing seven DCR registrations. A freshly started Bridge may have valid OAuth files but no shared RAM snapshot. Distinguish these cases.
- Do not send destructive POSTs in a “read-only health check”: customer creation/revocation, client revocation, OAuth register/consent/token, snapshot publish, proposal pull, collection acknowledgement and source authorisation have side effects. Even `POST /v1/jobs/access` returns a sensitive credential; use only when genuinely necessary and authorised.
- If a restart is ever separately approved, confirm the **exact** dedicated Bridge PowerShell supervisor and child ownership and Task Scheduler state first. Historical inventory recorded task status `Ready` despite a live launcher; blindly Stop-ScheduledTask/Start-ScheduledTask risks a duplicate. Stop the supervisor **before** its child to avoid watchdog respawn, verify port vacated and then launch only one exact instance. If owner cannot be proved, **STOP**. This paragraph is a constraint, **not restart authorisation**.
- Never use `worker-app-supervisor.js --stop-all` to restart a single component; it also stops Office, Code Space, Memory Space, Bridge and code-server. Never restart `Cloudflared` for a single customer issue without explicit separately scoped approval; its reach is wider. Never terminate `:8790` as if it were the dedicated Bridge watchdog.

## 9. Service ownership and start/stop evidence — historical, no commands authorised here

| Service | Recorded management/launch | Important limitation |
|---|---|---|
| Bridge :8787 | Dedicated scheduled task **`Memory Space Bridge`** launches `bridge\windows\start-bridge.ps1`, which runs `bridge\server.mjs` in loop. | The exact task/process ownership was verified for the final 22 Sep restart. Task `Ready` alone is not process proof. Config read once at PowerShell startup. |
| Universal :4173 **and WIZZ Supervisor :8790** | Historical direct `node server.mjs` from the Universal working directory. `ensureSupervisor()` starts :8790. | No safe independent supervisor stop recorded. Duplicate Universal process can collide on both ports. |
| Office :4176 | Desktop `Code Space.lnk` -> `Start Worker App.vbs` -> `worker-app-supervisor.js` starts Office with derived source configuration. | Do not bypass launcher or use group stop for Office-only action. |
| Code Space :8090 | Same Worker App launch chain; recorded service-specific `Start Worker App.cmd --restart-code-space` exists. | Broad `--stop-all` affects five services. No restarts authorised now. |
| code-server :8080 | Ubuntu WSL user systemd `code-space-code-server.service`; Windows relay. | Stopping editor backend need not stop :8090 wrapper. |
| Cloudflared | Automatic Windows service `Cloudflared` using protected token file. | Global public tunnel availability risk on restart. |
| Ollama | User Startup shortcut `Ollama.lnk`; model endpoint :11434. | Restart method not verified; outage affects Orb and Bridge local model calls. |
| Kokoro :8880 | `start-cpu.ps1` or `start-gpu.ps1`, exact active launcher unknown. | Scripts include install/model-download steps: not harmless quick restarts. |
| Caddy :80 and media :8081 | `Start-Game-Servers.bat` launches both, but serving paths are independent. | No verified safe service-specific controls in 14 Sep inventory. |

These are documentation of previous observation, **not instructions to execute now**. Never change BIOS, PC identity, Windows owner/partition/execution policy, firewall/router exposure or machines outside `E:\WIZZ-Server` as a side effect of this task.

## 10. Future-chat entry procedure and authority order

Read, **from the installed HP working copy**, in this order:

1. `E:\WIZZ-Server\new-version\universal-space\UNIVERSAL_SPACE_RULES.txt` — authoritative branch/folder/freeze and Git rules.
2. `...\UNIVERSAL_SPACE_HANDOFF.md` — current product behavior and immediate work.
3. `...\docs\APP_CLUSTER_MAPPER_PLAN.md` — **sole active implementation checklist**. Do not create a second plan.
4. `...\UNIVERSAL_SPACE_LEDGER.md` — latest actual checkpoint and test evidence.
5. `...\docs\operations\UNIVERSAL_SPACE_LOCATIONS_AND_BASELINE_2026-09-01.md` — dated paths and protected reference copies.
6. **This architecture/routes document** — multi-service wiring, September 22 repair and special security preservation invariants. It supplements the authoritative rules, not a replacement.

First establish exact `pwd`, `git branch --show-current`, local HEAD, status and actual running process paths **read-only**. GitHub publication does not mean the HP installed/pulled it. If the files disagree, show the mismatch; don't silently reconcile. If a Git command errors, report exact error and stop rather than reset/merge/rebase/force push.

For a narrow bug: trace **UI button → imported module → frontend fetch → server route → target service → auth → state side effect**; read relevant files and tests before editing. Record confirmed/unknown separately. Present minimal proposed diff and risk; no patch, restart, push, merge, secret handling, customer creation or state mutation without scoped user instruction. Test locally only within scope; report whether tests were actually run. If asked to document only, **do not alter runtime files, service state, existing backups, credentials or active checklist.** Never mistake a renamed path or port for a new application.

### Sources inspected for this record

Installed-user-supplied, dated files: `bracnhes for all new working v3.txt` (3 Sep branch snapshot) and `Untitled.txt` (14 Sep read-only service inventory). These are observations at their stated dates, not new HP audits.

Repository reference documentation and code as read during preparation (not necessarily deployed versions):

- [Universal Space AGENTS.md](https://github.com/999nike/memory-app/blob/molecular-v2/AGENTS.md)
- [Universal Space authoritative rules](https://github.com/999nike/memory-app/blob/molecular-v2/UNIVERSAL_SPACE_RULES.txt)
- [Universal Space handoff](https://github.com/999nike/memory-app/blob/molecular-v2/UNIVERSAL_SPACE_HANDOFF.md)
- [Sole active product plan](https://github.com/999nike/memory-app/blob/molecular-v2/docs/APP_CLUSTER_MAPPER_PLAN.md)
- [Dated location/baseline record](https://github.com/999nike/memory-app/blob/molecular-v2/docs/operations/UNIVERSAL_SPACE_LOCATIONS_AND_BASELINE_2026-09-01.md)
- [Universal Space main server](https://github.com/999nike/memory-app/blob/molecular-v2/server.mjs), [Orb local](https://github.com/999nike/memory-app/blob/molecular-v2/orb-local-server.mjs), [Orb TTS](https://github.com/999nike/memory-app/blob/molecular-v2/orb-tts-server.mjs), [Orb realtime](https://github.com/999nike/memory-app/blob/molecular-v2/orb-realtime-server.mjs)
- [WIZZ Supervisor server](https://github.com/999nike/memory-app/blob/molecular-v2/supervisor/server.mjs)
- [Bridge architecture/README](https://github.com/999nike/memory-app/blob/main/bridge/README.md), [Bridge server-v2 route reference](https://github.com/999nike/memory-app/blob/main/bridge/server-v2.mjs), [OAuth](https://github.com/999nike/memory-app/blob/main/bridge/oauth.mjs), [workspace/MCP tools](https://github.com/999nike/memory-app/blob/main/bridge/workspace-runtime.mjs), [Windows watchdog](https://github.com/999nike/memory-app/blob/main/bridge/windows/start-bridge.ps1)
- [Office server/job-source routes](https://github.com/999nike/office-app/blob/universal-space-office-bridge/server.mjs), [Office V3 product/dispatch ledger](https://github.com/999nike/office-app/blob/universal-space-office-bridge/V3_PRODUCT_LEDGER.md)
- [Code Space architecture README](https://github.com/999nike/code-space/blob/code-space-working-snapshot-2026-09-03/README.md) — older architectural reference, not full current route proof.

**Source age/conflict rule:** The old `Office README.md` and `Code Space README.md` describe initial versions and may say Memory integration does not exist; these are older than the observed Office Memory Bridge source and 3 Sep integration. The frozen remote Bridge `main` may not contain 22 Sep local fixes. Treat production observations and current local installed files as primary for current runtime behavior, and label dated documentation as historical. Never “correct” a functioning live system solely to match an older README or branch.

---

**End state:** No working application is being replaced. New Universal Space remains the product; conventional Memory frontend remains separate; the repaired customer-scoped Bridge is the shared backend. The next operator should **preserve the proven 12-customer/3-OAuth/7-registration/2-refresh-token state and existing Office feed**, identify precisely which layer a new symptom belongs to, and refrain from touching the other services without permission.
