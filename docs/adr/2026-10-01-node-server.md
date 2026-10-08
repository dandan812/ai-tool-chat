# Node Server Deployment

## Status

Accepted for the user-requested Node migration on 2026-10-01.
Independent US-server installation was explicitly approved on 2026-10-01.
Authorized DNS/HTTPS launch completed on 2026-10-02; public owner login and
upload smoke passed, and anonymous desktop/mobile login views were checked.
A protected model credential remains required for real AI use; no paid model
calls were made.
The approved domain is chat.i-tool-chat.store; runtime is pinned to Node 24.21.0
following official release-index verification.

## Decision

Run the existing request handlers, account controls, upload pipeline, retrieval,
and task state machine in a normal Node.js 24 process. Cloudflare bindings are
replaced at the infrastructure boundary: SQLite persists namespaced key/value
records and scheduled jobs; a private filesystem bucket stores file objects.
No Wrangler, Miniflare, Cloudflare runtime, R2 bucket, or Durable Objects service
is required in production.

Use one supervised process and one independent data directory per installation.
Do not attach this application to the existing Sub2API PostgreSQL or Redis.
SQLite transactions serialize all reads/writes and include alarm state.
Each object retains the concurrency gate expected by its business handler.

Scheduled tasks use persisted leases and a bounded global execution count.
After restart, queued work can execute, while already claimed work is marked
interrupted instead of automatically repeating a potentially paid model call.
No multi-process or clustered deployment against the same database is supported.

## Tradeoffs

This preserves existing behavior and focused test coverage without rewriting
the application. The adapter covers only the storage and namespace methods
actually used by this codebase; it is not a general Cloudflare emulator.

The single process and synchronous SQLite statements limit throughput. This
is appropriate for the initial low-traffic server deployment, not a claim of
high-concurrency capacity. Disk usage, backups, task latency, and account
directory contention must be monitored before increasing scale.

## Security And Operation

The backend binds only to loopback. Caddy serves the built frontend and proxies
same-origin `/api/` requests. The reverse proxy overwrites client-IP metadata.
Production registration and mock models are disabled. A separate local CLI
provisions the initial owner and stores the generated password in a restricted
file, never in the frontend, logs, or source.

Model credentials must be supplied by the owner. No paid model call is made
by deployment verification. Synthetic local accounts, uploads and mock model
results are used only in an isolated development data directory.

Back up the application database and object directory together while the
application is stopped, or use a snapshot coordinated with the database.
Copying a live SQLite main file without its WAL is not a valid backup.
Rollback must preserve the independent data directory and object files.

Existing Cloudflare accounts, file data, and anonymous browser history are not
automatically migrated. This is a separate installation on the new domain.
