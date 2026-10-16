# Ordinary Node.js Backend

The server runs the existing business handlers as a Node.js application.
Production does not use Workers, Durable Objects, R2, Wrangler or Miniflare.
SQLite replaces namespaced state and alarms; private files replace R2.
The TypeScript classes in `packages/worker` are shared business code, bundled
locally with esbuild. No dependency installation is needed on the server.

## Task Recovery And Diagnostics (2026-10-16)

Release `node-20261016T021014718Z` is deployed. On graceful shutdown the runtime
aborts active model calls, persists received text with `TASK_INTERRUPTED`, settles
usage conservatively, closes SSE observers and drains work before closing SQLite.
Restarting or replaying the same idempotency key does not repeat a claimed call.
This stops the local request; it cannot guarantee that a provider cancels billing.

Every Node HTTP response includes a server-generated `X-Request-ID`. Access logs
join that ID with status, duration and a normalized task route; query strings,
cookies and bodies are excluded. Frontend API errors display validated request IDs.
This describes HTTP boundary logging, not all provider or application logs.

Validation: frontend 307, Worker 434 and Node 81 tests passed (3 Worker and
2 platform-dependent Node tests skipped). Browser checks used the release frontend,
real local Node/SQLite and a mock model. Public smoke verified login, upload/delete,
private storage and matching assets; no paid production model call was made.
Public terminal SSE replay was skipped because the smoke owner has no terminal task.
Backup: `/opt/ai-tool-chat/backups/engineering-20261016`; previous release:
`node-20261013T095242627Z`. Deployment configuration and other services are unchanged.

## Agent Deployment (2026-10-13, Asia/Shanghai)

Release `node-20261013T095242627Z` went live at 17:55:48 +08:00; the coordinated
service stop began at 17:55:46. Public real-model acceptance finished at 17:56:59.
Text, file RAG, two-file research Agent and joint image/file answers passed with
the configured `deepseek-flash`. Each check verified SSE disconnect/reconnect,
exact streamed/persisted answer agreement, idempotent submission and terminal
cursor replay. The Agent used three model calls and cited both original files.

Real acceptance exposed reasoning deltas being displayed as answer content;
the parser now keeps them separate while retaining usage accounting.
`AGENT_DISABLE_THINKING=true` is the only production configuration change,
after verifying this provider supports it. Ordinary text and vision settings
are unchanged. The new frontend exposes research after a file attachment.

Backup: `/opt/ai-tool-chat/backups/agent-node-20261013T095242627Z`.
The backup passed SQLite integrity, serialized-value reads and private-file
permission checks. Previous release: `node-20261013T063931669Z`.
Rollback stops only this app, restores `server.env` from that backup, switches
`current` to the previous release, starts and verifies the service. State is
preserved. Caddy configuration/process and the existing relay container
identities/restart counts were unchanged. Application automatic restarts: zero.

Public HTML and nine referenced resources match the release bytes. Final local
validation: frontend 306 passed, Worker 434 passed/3 skipped, Node 78 passed/
2 skipped; lint, types, builds and Worker dry-run passed.
Evidence: `generated/agent-deployment/` and
`docs/reference/2026-10-13-agent-production.md`. Earlier sections below are
historical records, not the current release or model availability.

## SSE Deployment (2026-10-13, Asia/Shanghai)

Release `node-20261013T063931669Z` went live at 14:42:47 +08:00.
The browser now requests `text/event-stream` on the existing task events route,
reconnects using its last validated event cursor, and batches content callbacks
with `requestAnimationFrame`. Each nonempty provider delta is committed and
notified immediately; the former 200ms backend content buffer is removed.
JSON event pages remain available for older clients. Stopping observation
flushes pending content before invalidating the session observer; cancellation
snapshots stay authoritative.

Streams send 15-second heartbeat comments and clean up on disconnect. The
shared task boundary allows eight observers per task, and Node allows 32 SSE
connections separately from the 16 regular in-flight requests. Idle namespace
eviction excludes tasks with active subscribers. The event-count budget now
allows one content event per bounded output character plus 512 control events;
the existing 24,000-character output limit is unchanged.

Public HTML and nine referenced assets matched the release bytes; loopback
and public HTTPS smoke passed. Backup integrity and permissions passed at
`/opt/ai-tool-chat/backups/sse-node-20261013T063931669Z`.
The previous release is `node-20261013T053946414Z`. Rollback is a code-only
service stop, current-link switch, start and health verification. Configuration,
Caddy and existing container identities/restart counts were unchanged.

Local verification: frontend suite 300 passed, followed by 84 focused tests
including two new session-buffer regressions; worker suite 398 passed/3 skipped,
followed by 25 task tests including the new observer-limit regression; Node
suite 77 passed/2 Windows skips. Type checks, lint and release packaging passed.
Isolated Chromium used the final release frontend and actual Node/SQLite/SSE
with a synthetic local provider emitting 24 characters every 15ms. Desktop and
390px runs each used one SSE request, preserved the result after reload, and
had approximately 33.4ms P95 visible-update gaps. Desktop had one 50.1ms rAF
interval; neither run reported long tasks. These are callback measurements,
not physical display FPS or real-provider performance. A 320px run verified
reload during generation, no duplicated sections, and cancellation with partial
output. Screenshots were inspected. No paid production model request was made;
public SSE replay could not run because the smoke owner had no terminal task.
Evidence: `generated/sse-20261013/`.

## Model Deployment Status (2026-10-13, Asia/Shanghai)

Release `node-20261012T163818432Z` is live at `https://chat.i-tool-chat.store/`.
Text, extracted documents and images use TokenRhythm `deepseek-flash`; vision
is explicitly enabled with `MULTIMODAL_USE_TEXT_PROVIDER=true`.
This supersedes the missing-model notes in the historical October 2 record.

Public HTTPS guest workflows passed for text, a synthetic PNG whose code was
not supplied in the prompt, and a two-chunk DOCX upload with source citation.
All three completed with the configured model and matching persisted stream
content. Synthetic uploaded files were deleted after verification.
Evidence: `generated/node-server-deployment/feature-check-public-20261013.json`.
The checks ran from the target server through the public HTTPS origin because
local outbound TLS connections reset. Browser click-through was not repeated.

Validation: 248 frontend tests, 50 provider/routing tests, 74 server tests,
2 server skips, and frontend/worker type checks passed. Release contents were
scanned for the actual model key with no match. Protected configuration is
root-owned 0600; coordinated pre-switch config/data backup is root-only at
`/opt/ai-tool-chat/backups/model-node-20261012T163818432Z`.
The prior release remains `node-20261002T122858639Z`. Rollback requires stopping
only this application, restoring the backed-up environment file, switching
`current` to that prior release, then starting and verifying the service.
Caddy configuration/process and Sub2API container identities/restart counts
were unchanged. The new application has zero automatic restarts.

These checks cover the tested workflows, not every possible document or image.
Scan-only PDFs still require OCR; model interpretation is not guaranteed.
Existing per-account quotas and the guest-creation cap remain in place; there
is no shared monetary spending cap.

## Deployment Status (2026-10-02)

- US service is active/enabled on `154.37.208.170`, loopback `127.0.0.1:3200`.
- Installed release: `node-20261002T122858639Z`, Node 24.21.0.
- Release archive SHA-256:
  `4011fcbe841c311c204fe060a65f320eede89ac29213abcd79adcfa21563b006`.
- Verified under Node 24.21.0 locally: backend 51 passed/2 Windows-only skips;
  frontend 151 passed, type check and independent release build passed.
- Target-server smoke passed: login, upload/delete, private Linux storage,
  public registration disabled, missing-model guard, and coordinated initial
  backup restore (SQLite integrity plus persisted owner).
- Initial backup:
  `/opt/ai-tool-chat/backups/first-install-node-20261001T093807659Z/`.
- PUBLIC WEB ENTRY LAUNCHED on 2026-10-02:
  `https://chat.i-tool-chat.store/`, A record `154.37.208.170`, DNS-only,
  automatic TTL. Both authoritative Cloudflare nameservers returned the target.
- A separate Caddy route proxies `127.0.0.1:3200`; HTTP redirects to HTTPS.
  The Let's Encrypt certificate covers this hostname and is valid from
  2026-10-02 to 2026-12-31 (UTC). TLS verification passed without bypass flags.
- Caddy was gracefully reloaded, not restarted. All pre-existing live route
  objects (including their expanded secret-dependent gates) were unchanged.
  Sub2API/PostgreSQL/Redis container IDs and zero restart counts were unchanged;
  Caddy and this application's process start times were unchanged.
- Caddy backup:
  `/opt/ai-tool-chat/backups/public-20261002T114227925149218Z/`.
  Caddyfile SHA-256 after adding only the new site:
  `7c48fab2fca1aee5cde8502e060170a08b059cdc7eac454897c7e5f969b1da1a`.
- REAL MODEL FUNCTIONALITY REMAINS UNCONFIGURED: `QWEN_API_KEY` is empty.
  Task creation rejects with 503 `MODEL_NOT_CONFIGURED`; no mock answer or
  paid model request was used.
- Owner username is `owner`; generated password remains only in the protected
  server file `/var/lib/ai-tool-chat-credentials/owner.txt`.
- Login-free guest access launched on 2026-10-02 with public registration still
  disabled. Independent visitor cookies preserve task/file ownership and never
  expose the owner account. Backend 55 passed/2 Windows skips, frontend 155
  passed, account regression 68 passed, and both type checks passed.
- Coordinated pre-guest backup:
  `/opt/ai-tool-chat/backups/guest-node-20261002T122858639Z/` (0700; data/config
  files 0600). Previous release retained for rollback.
- Public guest smoke passed: separate sessions, secure cookies, origin guard,
  synthetic upload/delete and cross-session file denial. Owner smoke also passed.
  Public desktop/390px/320px workbench checks passed with no overflow, console
  errors or failed requests; refresh, draft/new-chat and usage panel passed.
- Guest publication did not write Caddy or restart any relay container. The
  Caddy checksum captured immediately before this publication and after it was
  `c338458053cd78c5b391e74f938bc3a9ee768379aa837f576674eef51907dc20`.
  A separate earlier Caddy change occurred at 20:18:50 +0800; it was preserved,
  not restored to this document's original public-launch checksum.
- Public HTTPS smoke passed: owner login/logout, secure account cookie,
  upload/complete/status/delete, private Linux storage, disabled registration,
  and the missing-model guard.
- Chrome MCP verified the live login page and eight successful resource/API
  loads. Playwright checked 1707px, 390px and 320px anonymous login views,
  required-field validation, no horizontal overflow, no console/page errors
  and no failed requests. Served HTML SHA-256 matched the installed release:
  `9cf36e4cdb6a7621568e1fe8bb9fe6eec34cb421708018cfbedbcb0d7546c7bd`.
- Real model workflows remain untested and unconfigured. Guest workbench UI was
  browser-tested; password-authenticated owner workbench UI was not.
  The current SSH identity rejects TCP forwarding; its security policy was
  not changed.
- On 2026-10-02, the approved local Chrome MCP reconnect repair passed five
  tests and a fresh MCP process connected to the existing dedicated Chrome.
  An earlier chat transport remained closed; after reopening Codex, MCP access
  recovered and the authorized DNS/public launch was completed. Before this
  launch, authoritative DNS returned NXDOMAIN and Caddyfile SHA-256 was
  `f38ae6ee64974a061860aa291f0f2a03c39c89f371cd071732c1296f5b82109b`.
- Public verification artifacts are in
  `generated/node-server-deployment/public-20261002/` (UI report, screenshots,
  proxy publication script and release record). No credentials are included.

## Build And Verify

### PDF, Word And Excel Analysis

The Node runtime extracts text from `.pdf`, `.doc`, `.docx`, `.xls` and `.xlsx`
after the existing chunk upload and ownership/version checks. Plain text, code
and CSV keep their original reading path. Upload and task API shapes are unchanged.
PDF pages and worksheet names are included in extracted text; evidence offsets
and line numbers refer to that text. Spreadsheet formulas use saved results;
formulas without results are shown as text, never evaluated.

Parsing uses one isolated worker thread at a time, with a 15-second parsing
timeout, a bounded queue, task cancellation and a bounded V8 heap. Limits are
200 PDF pages, 32 worksheets, 30,000 rows/256 columns per sheet, 200,000 table
cells in total, 1,000,000 extracted characters, and 64 MiB of expanded Office
archive data. Oversized input fails explicitly instead of silently truncating.
The existing `MAX_FILE_BYTES` upload limit still applies (8 MiB by default in
the Node runtime).

Image-only/scanned documents need OCR before analysis; OCR is not included.
Encrypted, corrupt, empty and mismatched documents fail with actionable task
errors before any model call. Font/CMap assets are read only from the bundled
local asset directory; the parsing worker has no network fetch capability or
inherited environment variables. This is resource isolation, not an OS sandbox.

The build and release package include `document-worker.mjs`,
`document-extractor.mjs` and `document-assets/` alongside the existing backend
files. A frontend-only publication cannot enable document analysis. No runtime
dependency installation or remote parsing service is required. This adapter is
for the Node server; Worker-only deployments must provide an equivalent
`EXTRACT_DOCUMENT_TEXT` adapter or return `DOCUMENT_PARSER_UNAVAILABLE`.

### Compatible Text And File Models

File research (`enableTools: true`) requires streaming function calling.
For a provider verified to support `thinking: { type: "disabled" }`, set
`AGENT_DISABLE_THINKING=true` to keep research decisions within their bounded
output budget. This opt-in applies only to file-agent decisions and its final
answer, not ordinary text or vision requests. The stream parser never displays
`reasoning_content` as answer content, but still accounts for its usage.

Set `TEXT_API_BASE_URL`, `TEXT_API_KEY`, `DEFAULT_MODEL` and
`DEFAULT_FILE_MODEL` in a protected backend environment file to use an
independent OpenAI-compatible endpoint. For TokenRhythm, the base URL is
`https://tokenrhythm.studio/v1` and the configured model is `deepseek-flash`.
The server appends `/chat/completions`. Explicit compatible configuration
takes precedence over Bailian and does not silently fall back to another
provider. It applies to text and extracted document text. To explicitly reuse
this endpoint for images, set `MULTIMODAL_USE_TEXT_PROVIDER=true` and
`DEFAULT_MULTIMODAL_MODEL` to a verified vision-capable model. TokenRhythm's
model listing reports vision support for `deepseek-flash`. Without this opt-in,
images continue to use the separate Bailian configuration.

Credentials are never bundled into the frontend. The legacy health field
`features.bailianText` now reports whether the active text provider has
credentials; its existing response shape remains unchanged.

The ordinary local preview still defaults to mocks. A protected local
environment file can opt into real requests with `PREVIEW_USE_REAL_MODEL=true`;
launch it with `node --env-file=.env.local-model scripts/preview.mjs`.
`PREVIEW_DATA_DIRECTORY` can retain an existing local preview's data.
Real requests consume the configured provider's quota.

### Cost Estimates

`MODEL_PRICES_JSON` supplies per-million token rates, keyed by the configured
model ID. The user supplied these CNY rates for `deepseek-flash` on 2026-10-13:

```dotenv
MODEL_PRICES_JSON='{"deepseek-flash":{"inputPerMillion":1,"outputPerMillion":4,"cachedInputPerMillion":0.02,"currency":"CNY"}}'
```

Cache hits are a subset of input tokens, not additional tokens. The compatible
stream reader accepts `prompt_tokens_details.cached_tokens` and
`prompt_cache_hit_tokens`. Contradictory or invalid cache counts make the cost
unknown. Without reported cache counts, the estimate applies the regular input
price and does not claim a cache discount. Without a configured cache rate, the
existing input price applies.

The UI continues to label costs as estimates, not invoices. Provider usage is
preferred; the existing explicitly labeled token estimate remains available for
completed streams without usage. Unknown/interrupted usage is never priced as
zero. Historical task costs are snapshots and are not retroactively repriced.
Changing production prices requires updating the protected server environment
and restarting the application. These rates do not alter account token quotas
or context/output limits.

### Login-Free Guest Access

Set `ALLOW_GUEST_ACCESS=true` in the protected Node environment file to open the
workbench without asking for a username or password. The frontend automatically
creates a private session for each browser; visitors never share the owner
account or each other's tasks/files. Public account registration stays disabled.
Guest and logged-in session cookies are separate; valid logged-in sessions take
priority. Account changes reload the application to discard account-owned stores.

Guest creation is limited to 10/IP and 100 globally per 15-minute window. Rejected
IP attempts do not consume the global creation allowance. `MAX_GUEST_SESSIONS`
defaults to 1000 total creations (not concurrent sessions); the persisted cap
bounds abandoned session/data growth and needs an intentional operator increase
when reached. Sessions last 30 days; clearing cookies loses access to that
guest's server history/files. There is no automatic cleanup or cross-device
recovery. Disabling guest access also disables existing guest cookies.

Model calls remain disabled without a configured key. Before enabling a paid
model for anonymous access, add a shared spending budget: per-account budgets
alone can be bypassed by creating new visitor sessions.

Initial local validation used Node 24.13.0. The deployment pin is Node 24.21.0,
published 2026-09-07, confirmed from the official release index on 2026-10-01.
Changing runtime versions requires adapter and restart tests; do not auto-upgrade
production. The deployment run must record validation under the new runtime.

```powershell
pnpm install
pnpm run build:server
pnpm run test:server
$env:VITE_API_URL='/api'
pnpm run build:frontend
pnpm run preview:server
```

By default, preview is bound to `http://127.0.0.1:3201` with a fresh temporary
data directory, registration and synthetic model replies. This default mode
does not send requests to a paid model. Explicit real-model preview requires
the protected configuration described above. Do not expose the preview port.
The ordinary production entry point is `dist/server.mjs`, not `preview.mjs`.

For a custom local production installation, configure the protected environment
file using `.env.example`, then run:

```sh
node --env-file=/protected/path/server.env packages/server/dist/server.mjs
```

Use an HTTPS `PUBLIC_ORIGIN` in production. The API prefix is `/api`.
The backend listens on loopback only; Caddy terminates public TLS.
Frontend and backend must use the same origin for account cookies.
`/healthz` is process liveness; `/api/health` reports model feature availability.
HTTP 200 on the home page does not prove the model/upload workflows work.

## US Deployment Plan

- Target: `ubuntu@154.37.208.170:22` (US), not Tokyo.
- Approved hostname: `chat.i-tool-chat.store`.
- Backend: `127.0.0.1:3200`.
- Runtime: `/opt/ai-tool-chat/node/bin/node`.
- Releases: `/opt/ai-tool-chat/releases/<release>/`.
- Current release link: `/opt/ai-tool-chat/current`.
- Independent state: `/var/lib/ai-tool-chat`.
- Protected configuration: `/etc/ai-tool-chat/server.env`, root-owned mode 0600.
- Dedicated Linux account: `ai-tool-chat`, no interactive shell.
- Service: `ai-tool-chat.service`, at most 50% of one CPU and 512 MiB RAM.
- Separate credential output directory: `/var/lib/ai-tool-chat-credentials`,
  service-owned mode 0700; credential files mode 0600.

Production installation was explicitly authorized on 2026-10-01 after the
independent service, 512 MiB memory/half-core limit and unchanged Sub2API scope
were explained. Authorized public DNS/HTTPS launch completed on 2026-10-02.
The protected model key remains a separate prerequisite for real AI use.

After local type checks/tests, `pnpm run package:server` rebuilds the backend and
the same-origin frontend in an independent release directory, then produces an archive
and checksum under `generated/node-server-deployment`. It includes ONLY built
backend/frontend and deployment templates, not credentials, data, dependencies
or Worker configuration. Upload the archive and the separately verified
`node-v24.21.0-linux-x64.tar.xz`; do not build/download dependencies on production.

The pinned Linux runtime archive SHA-256 is:
`fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6`.

Before changes, capture Sub2API container IDs/restart counts, health and Caddy
configuration checksum. Verify headroom and absence of the new paths/port.
Install artifacts into dedicated versioned directories without touching
`/opt/sub2api`, its containers, PostgreSQL, Redis, credentials or Caddy blocks.
Create the protected environment file, explicitly disabling public registration
and mocks. Install `deploy/ai-tool-chat.service`, provision the owner while this
new service is stopped, then start only this service and check local liveness.

Owner bootstrap example (run as the dedicated account while the service is stopped):

```sh
DATA_DIRECTORY=/var/lib/ai-tool-chat \
  /opt/ai-tool-chat/node/bin/node /opt/ai-tool-chat/current/backend/admin.mjs \
  owner /var/lib/ai-tool-chat-credentials/owner.txt
```

Never print/copy that password into logs, frontend code or chat.
The CLI cannot share an open data directory with the service.

Configure the real `QWEN_API_KEY` via a protected file, not in chat/Git.
Without it the page/accounts/uploads can run, but creating a model task returns
503 `MODEL_NOT_CONFIGURED`; no mock answer or paid call is used.

DNS must be configured in an authorized account:

```text
Type: A
Name: chat
Value: 154.37.208.170
Proxy: DNS only initially
```

Check authoritative DNS before adding the separate `deploy/Caddyfile` block.
Back up the existing Caddyfile, append only this block (or an explicit import),
validate with Caddy, then gracefully reload Caddy, never restart it. Verify TLS,
the public home page, `/healthz`, `/api/health`, and unchanged Sub2API health.
Model smoke tests require separate spending authorization; HTTP success alone
is not end-to-end acceptance.

`deploy/smoke.mjs` defaults to loopback. Set
`SMOKE_BASE_URL=https://chat.i-tool-chat.store` for the public HTTPS smoke when
executing this helper on the target server as `ai-tool-chat`. The helper only
accepts these two approved origins before reading the protected credentials.
It does not send model requests, and cleans up only its synthetic upload.

## Backups, Recovery And Limits

Only one process can own the data directory (SQLite exclusive process lock).
No cluster mode or shared/network filesystem is supported.
Default file cap is 8 MiB/account file quota 64 MiB; bucket capacity is 1 GiB.
Actual HTTP bodies are bounded (JSON 2 MiB, multipart 6 MiB).
At most 16 active HTTP requests and two background tasks run concurrently.
Monitor disk growth: state history does not have automatic retention cleanup.

Back up database AND object directory together during a planned stop of this
application, including config/secrets in a restricted backup destination.
Never copy only a live SQLite main file without WAL. The final deployment must
validate backup permissions, restore and available disk space.
Stop/start and backup actions require the applicable production approval.

For code rollback, stop only `ai-tool-chat.service`, point `current` to the
previous compatible release, start it and verify health. Do not erase state.
If state format changes, use the coordinated backup with its matching code.
First-install rollback is to stop/disable only the new service; public routing
changes require a validated Caddy configuration restore and graceful reload.

Queued work can resume after restart; claimed work fails as interrupted to avoid
automatically repeating a potentially billed call. Cancellation does not refund
upstream usage already incurred. Cloudflare users/files/history are NOT migrated.

Windows storage tests skip Linux permissions/file symlinks when unavailable.
Linux file modes, backup restoration and live proxy/TLS were verified on the
target environment. Actual model calls, authenticated workbench browser flows
and production capacity/load testing remain unverified.
