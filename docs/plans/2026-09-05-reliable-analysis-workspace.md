# Reliable Analysis Workspace Implementation Plan

> User approved direct implementation. Execute with available code/adaptive-dev-guardrails and bounded agents; the superpowers package is unavailable. No production deployment or main push: repository CI deploys on push.

**Goal:** Account-isolated, budget-bounded, recoverable, source-backed analysis with measurable local tests.

**Architecture:** Retain Vue/TypeScript/Workers. AccountDirectory persists identities, hashed sessions and atomic user reservations. DurableTask persists snapshots and event logs and executes via alarms independent of the browser; interrupted claimed runs retain output and need explicit retry rather than blindly calling a provider twice.

**Tech Stack:** pnpm, Vue 3, Pinia, Workers, Durable Objects, R2, Vitest.

## Task 1 — account and ownership boundary
Files: worker/platform/accounts.ts, handlers/authHandlers.ts, handlers/uploadHandlers.ts, upload/* and tests.
Tests: two accounts with same external fileId remain isolated, no anonymous fallback, malformed chunk validation, concurrent atomic reserve/begin/settle with idempotent keys. Missing account binding fails closed. Registration opt-in, local development explicit.

## Task 2 — durable tasks
Files: core/durableTask.ts, handlers/taskHandlers.ts, task manager/store/runner and tests.
Tests: duplicate key reserves once, different payload 409, owner verified, disconnect recovery reads same events, cancel propagates, restarted claimed alarm never repeats model calls, terminal settlement idempotent.

## Task 3 — evidence and offline evaluation
Files: retrieval/evidence.ts, retrieval/text/textRetriever.ts, skills/fileSkill*Processing.ts, utils/filePromptBuilders.ts, evaluation/*.
Tests: original excerpts match exact offsets, CRLF/Unicode and file-version isolation, no invented PDF pages, fixed 30-question offline corpus. Offline results do not claim model answer correctness.

## Task 4 — integration
Files: worker/types/index.ts, index.ts, wrangler.toml, infrastructure/middleware.ts, providers/*; frontend/api/*, auth module, App.vue, chat store/message display and workspace panel.
Implement cookie requests, owner-scoped browser storage, persistent task list/replay/cancel, citations and honestly labeled metrics. Preserve anonymous legacy storage without automatically assigning it to a new account.

## Task 5 — validation
Run pnpm check:repo, pnpm check:frontend, pnpm check:worker. Test local Wrangler development bindings and mock provider (no real API key) with browser signup/login, isolation, upload, disconnect/recovery, cancellation, source display, budgets and mobile overflow. Record passed checks and remaining deployment prerequisites.
