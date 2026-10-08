# ADR: Readable task execution and truthful progress

## Status

Accepted for the local implementation on 2026-09-30. Not deployed.

## Context

The existing execution chain always reported `plan -> skill -> respond`.
However, `plan` only recorded an already selected handler, and `respond` only
copied the answer already produced by the handler. File handlers emitted
progress that the runner discarded. The frontend treated any nonterminal
step event as a new start.

The repository already contains local durable-task, account and file changes.
This refactor must preserve those changes, avoid new dependencies and paid
model calls, and keep old stored task records readable.

## Decision

- Retain Task for the lifecycle of one submitted request.
- Record `route -> skill`: routing selects a handler; the selected handler
  executes once.
- Keep file reading, retrieval and generation inside the file Skill. Report
  their progress on the same running step rather than inventing a workflow
  engine or claiming independently retryable checkpoints.
- Use `Task.result` for the final answer. Step outputs store small execution
  metadata rather than duplicate the full answer.
- Forward progress through the existing step event envelope. Deliver it via
  an explicit frontend `onStepProgress` callback.
- Keep legacy step types for old history. New tasks do not emit fake
  planning or response-generation steps.
- Propagate original exceptions, including budget error codes. A failed step
  has an end timestamp. A Skill must emit a completion marker; exhausting an
  incomplete stream is not successful completion.
- Consume the stream past its completion marker because provider usage
  accounting can happen afterward.

## Consequences

### Positive

- The runner's main method has one visible sequence: route, execute, save.
- UI descriptions correspond to real operations.
- Existing durable snapshots and replay also preserve progress.
- Tests exercise order, sources, usage, errors, cancellation and recovery.
- Removing duplicate answer storage reduces raw runner event serialization.

### Negative

- Skills have an explicit completion contract that future handlers must obey.
- Progress adds persistent events and must remain bounded. Current file
  handlers report only a few stage changes, not one event per token.
- Legacy and new step types coexist for compatibility.

### Limits

- Progress is an operation counter, not a model-token percentage.
- Event replay restores viewing, not interrupted model computation.
- The existing DurableTask interruption policy is unchanged: do not
  automatically reissue a possibly billable model call.
- The browser's durable-task path currently polls the event cursor endpoint.
  Upstream model streaming still uses SSE. This refactor does not change the
  transport to browser SSE.
- Local microbenchmarks do not measure DO storage, network or model latency.

## Alternatives Considered

1. Keep the three phases unchanged: rejected because their names overstate
   the actual execution and hide file progress.
2. Build a DAG or generic workflow engine: rejected because the current
   handlers do not require independently scheduled or retried steps.
3. Remove Task and directly call providers: rejected because it would discard
   useful lifecycle, observation and existing durable execution boundaries.

## Verification

See `docs/guides/task-execution-reading-guide.md` for the reading path and
reproducible commands. Test counts and benchmark measurements belong in the
dated handoff report, not an assertion that production is verified.
