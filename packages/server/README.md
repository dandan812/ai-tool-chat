# Ordinary Node.js Backend

The server runs the existing business handlers as a Node.js application.
Production does not use Workers, Durable Objects, R2, Wrangler or Miniflare.
SQLite replaces namespaced state and alarms; private files replace R2.
The TypeScript classes in `packages/worker` are shared business code, bundled
locally with esbuild. No dependency installation is needed on the server.

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

Preview is bound to `http://127.0.0.1:3201` with a fresh temporary data directory.
Registration and synthetic model replies are enabled ONLY in this local
development preview. Nothing is sent to a paid model. Do not expose this port.
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
