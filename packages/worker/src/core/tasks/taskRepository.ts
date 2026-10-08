import type { ChatRequest, EvidenceSource, Task, TaskMetrics } from '../../types';
import { MAX_EVIDENCE_TOTAL_CHARS } from '../../retrieval/evidence';
import { unknownTaskCost } from '../taskCost';
import type { TaskStreamEvent } from '../taskManagerTypes';
import {
  compactTask, initialMetrics, MAX_EVENTS, MAX_SOURCE_EVENT_BYTES, MAX_STORAGE_VALUE_BYTES,
  RECORD_KEY, REQUEST_CHUNK_CHARS, type DurableTaskEvent, type TaskRecord,
} from './taskRecord';

const eventKey = (id: number) => `event:${String(id).padStart(8, '0')}`;
const requestKey = (id: number) => `request:${id}`;
const sourceKey = (id: number) => `source:${id}`;
const storedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

async function putBounded(storage: DurableObjectTransaction, key: string, value: unknown) {
  if (storedBytes(value) > MAX_STORAGE_VALUE_BYTES) throw new Error('TASK_STORAGE_VALUE_LIMIT');
  await storage.put(key, value);
}

function sourceBatches(sources: EvidenceSource[]): EvidenceSource[][] {
  const batches: EvidenceSource[][] = [];
  let batch: EvidenceSource[] = [];
  for (const source of sources) {
    const candidate = [...batch, source];
    if (storedBytes({ id: MAX_EVENTS, type: 'sources', data: { sources: candidate } }) > MAX_SOURCE_EVENT_BYTES) {
      if (batch.length) batches.push(batch);
      batch = [source];
      if (storedBytes({ id: MAX_EVENTS, type: 'sources', data: { sources: batch } }) > MAX_SOURCE_EVENT_BYTES) {
        throw new Error('TASK_SOURCE_VALUE_LIMIT');
      }
    } else batch = candidate;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

/** 只管理存储和原子状态转换，不调用模型、不决定是否重试任务。 */
export class TaskRepository {
  constructor(private readonly storage: DurableObjectStorage) {}

  read(): Promise<TaskRecord | undefined> { return this.storage.get<TaskRecord>(RECORD_KEY); }

  async create(record: TaskRecord, request: ChatRequest): Promise<void> {
    const text = JSON.stringify(request);
    record.requestChunks = Math.ceil(text.length / REQUEST_CHUNK_CHARS);
    await this.storage.transaction(async tx => {
      for (let index = 0; index < record.requestChunks; index++) {
        await putBounded(tx, requestKey(index), text.slice(index * REQUEST_CHUNK_CHARS, (index + 1) * REQUEST_CHUNK_CHARS));
      }
      await putBounded(tx, RECORD_KEY, record);
      await tx.setAlarm(Date.now() + 100);
    });
  }

  async readRequest(record: TaskRecord): Promise<ChatRequest> {
    const parts: string[] = [];
    for (let index = 0; index < record.requestChunks; index++) {
      const part = await this.storage.get<string>(requestKey(index));
      if (part === undefined) throw new Error('TASK_REQUEST_MISSING');
      parts.push(part);
    }
    return JSON.parse(parts.join('')) as ChatRequest;
  }

  async snapshot() {
    return this.storage.transaction(async tx => {
      const record = await tx.get<TaskRecord>(RECORD_KEY);
      if (!record) return undefined;
      const task = structuredClone(record.task);
      const sources = await this.readSources(tx, record.sourcePages || 0);
      if (sources.length) task.metadata = { ...task.metadata, sources };
      return { task, lastEventId: record.lastEventId };
    });
  }

  async events(record: TaskRecord, after: number) {
    const rows = await this.storage.list<DurableTaskEvent>({
      start: eventKey(after + 1), end: 'event;', limit: 100,
    });
    const events = [...rows.values()];
    const lastEventId = events.at(-1)?.id ?? after;
    return { events, lastEventId, terminal: record.phase === 'terminal' && lastEventId >= record.lastEventId };
  }

  async claim(): Promise<TaskRecord | undefined> {
    return this.storage.transaction(async tx => {
      const record = await tx.get<TaskRecord>(RECORD_KEY);
      if (!record || record.phase !== 'queued') return undefined;
      record.phase = 'claimed';
      record.task.status = 'running';
      record.task.updatedAt = Date.now();
      await putBounded(tx, RECORD_KEY, record);
      await tx.setAlarm(record.deadline + 1000);
      return record;
    });
  }

  async saveMetrics(metrics: TaskMetrics): Promise<void> {
    await this.storage.transaction(async tx => {
      const record = await tx.get<TaskRecord>(RECORD_KEY);
      if (!record || record.phase === 'terminal') return;
      metrics.elapsedMs = Date.now() - record.task.createdAt;
      record.task.metadata = { ...record.task.metadata, metrics: structuredClone(metrics) };
      await putBounded(tx, RECORD_KEY, record);
    });
  }

  async append(event: TaskStreamEvent, liveTask: Task, metrics: TaskMetrics): Promise<void> {
    await this.storage.transaction(async tx => {
      const record = await tx.get<TaskRecord>(RECORD_KEY);
      if (!record || record.phase === 'terminal') return;
      if (record.lastEventId >= MAX_EVENTS - 1) throw new Error('TASK_EVENT_LIMIT');
      const task = compactTask(liveTask);
      metrics.elapsedMs = Date.now() - record.task.createdAt;
      task.metadata = { ...task.metadata, metrics: structuredClone(metrics) };
      const stored = structuredClone(event);
      if (stored.type === 'task' || stored.type === 'complete') stored.data = { ...stored.data as object, task };
      if (stored.type === 'step') {
        const data = stored.data as { step: { id: string }; event: string };
        stored.data = { step: task.steps.find(step => step.id === data.step.id), event: data.event };
      }
      record.task = task;
      record.lastEventId++;
      if (event.type === 'complete') { record.phase = 'terminal'; record.task.status = 'completed'; }
      await putBounded(tx, eventKey(record.lastEventId), { ...stored, id: record.lastEventId });
      await putBounded(tx, RECORD_KEY, record);
    });
  }

  async appendSources(incoming: EvidenceSource[]): Promise<void> {
    await this.storage.transaction(async tx => {
      const record = await tx.get<TaskRecord>(RECORD_KEY);
      if (!record || record.phase === 'terminal') return;
      const sources = await this.readSources(tx, record.sourcePages || 0);
      const known = new Map(sources.map(source => [source.sourceId, source]));
      const added: EvidenceSource[] = [];
      for (const source of incoming) {
        const previous = known.get(source.sourceId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(source)) throw new Error('TASK_SOURCE_ID_CONFLICT');
        if (!previous) { known.set(source.sourceId, source); added.push(source); }
      }
      const all = [...known.values()];
      if (all.length > 24 || all.reduce((count, source) => count + source.excerpt.length, 0) > MAX_EVIDENCE_TOTAL_CHARS) {
        throw new Error('TASK_SOURCE_LIMIT');
      }
      const pages = sourceBatches(all);
      const eventBatches = sourceBatches(added);
      if (record.lastEventId + eventBatches.length >= MAX_EVENTS) throw new Error('TASK_EVENT_LIMIT');
      for (let index = 0; index < pages.length; index++) await putBounded(tx, sourceKey(index), pages[index]);
      for (let index = pages.length; index < (record.sourcePages || 0); index++) await tx.delete(sourceKey(index));
      record.sourcePages = pages.length;
      for (const batch of eventBatches) {
        record.lastEventId++;
        await putBounded(tx, eventKey(record.lastEventId), { id: record.lastEventId, type: 'sources', data: { sources: batch } });
      }
      await putBounded(tx, RECORD_KEY, record);
    });
  }

  async terminate(status: 'failed' | 'cancelled', code: string, message: string, usageUnknown = false): Promise<void> {
    await this.storage.transaction(async tx => {
      const record = await tx.get<TaskRecord>(RECORD_KEY);
      if (!record || record.phase === 'terminal') return;
      const wasClaimed = record.phase === 'claimed';
      record.phase = 'terminal';
      record.task.status = status;
      record.task.error = message;
      record.task.updatedAt = Date.now();
      record.usageUnknown = usageUnknown || (status === 'cancelled' && wasClaimed);
      const metrics = structuredClone(record.task.metadata?.metrics || initialMetrics());
      metrics.elapsedMs = Date.now() - record.task.createdAt;
      if (record.usageUnknown) {
        metrics.inputTokens = null; metrics.outputTokens = null; metrics.tokenSource = 'unknown';
        Object.assign(metrics, unknownTaskCost());
      }
      record.task.metadata = { ...record.task.metadata, errorCode: code, metrics };
      for (const step of record.task.steps) {
        if (step.status === 'running' || step.status === 'pending') {
          step.status = 'failed'; step.error = message; step.completedAt = record.task.updatedAt;
        }
      }
      record.lastEventId++;
      await putBounded(tx, eventKey(record.lastEventId), {
        id: record.lastEventId, type: 'error', data: { error: message, code, task: record.task },
      });
      await putBounded(tx, RECORD_KEY, record);
      await tx.setAlarm(Date.now() + 1000);
    });
  }

  async markSettled(): Promise<void> {
    await this.storage.transaction(async tx => {
      const record = await tx.get<TaskRecord>(RECORD_KEY);
      if (!record || record.phase !== 'terminal') return;
      record.settled = true;
      for (let index = 0; index < record.requestChunks; index++) await tx.delete(requestKey(index));
      record.requestChunks = 0;
      await putBounded(tx, RECORD_KEY, record);
      await tx.deleteAlarm();
    });
  }

  private async readSources(storage: DurableObjectTransaction, count: number): Promise<EvidenceSource[]> {
    const sources: EvidenceSource[] = [];
    for (let index = 0; index < count; index++) {
      const page = await storage.get<EvidenceSource[]>(sourceKey(index));
      if (!page) throw new Error('TASK_SOURCE_PAGE_MISSING');
      sources.push(...page);
    }
    return sources;
  }
}
