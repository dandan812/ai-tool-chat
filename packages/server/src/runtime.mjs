import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import handler, { AccountDirectory, ChunkStorage, DurableTask } from '../../worker/src/index.ts';
import { SQLiteStore } from './sqlite-store.mjs';
import { FileBucket } from './file-bucket.mjs';

class LocalNamespace {
  constructor(name, factory, database, env, limit = 2048) {
    Object.assign(this, { name, factory, database, env, limit });
    this.entries = new Map();
  }

  idFromName(name) {
    if (typeof name !== 'string' || !name || name.length > 256) throw new Error('Invalid object identity');
    return name;
  }

  entry(id) {
    id = this.idFromName(id.toString());
    let entry = this.entries.get(id);
    if (entry) {
      this.entries.delete(id);
      this.entries.set(id, entry);
      return entry;
    }
    if (this.entries.size >= this.limit) {
      const idle = [...this.entries].find(([, value]) => value.active === 0);
      if (!idle) throw new Error('Object capacity reached');
      this.entries.delete(idle[0]);
    }
    let gate = Promise.resolve();
    const state = {
      storage: this.database.storage(this.name, id),
      blockConcurrencyWhile(callback) {
        const operation = gate.then(callback);
        gate = operation.catch(() => undefined);
        return operation;
      },
    };
    entry = { actor: new this.factory(state, this.env), active: 0 };
    this.entries.set(id, entry);
    return entry;
  }

  get(id) {
    return {
      fetch: async (input, init) => {
        const request = input instanceof Request && !init ? input : new Request(input, init);
        const entry = this.entry(id);
        entry.active++;
        try { return await entry.actor.fetch(request); }
        finally { entry.active--; }
      },
    };
  }

  async alarm(id) {
    const entry = this.entry(id);
    entry.active++;
    try { await entry.actor.alarm(); }
    finally { entry.active--; }
  }
}

export async function createRuntime({ dataDirectory, variables = {}, pollMs = 250 }) {
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const processLock = new DatabaseSync(join(dataDirectory, 'process-lock.sqlite'));
  try { processLock.exec('BEGIN EXCLUSIVE'); }
  catch { processLock.close(); throw new Error('Another process already owns this data directory'); }
  let database;
  let bucket;
  try {
    database = new SQLiteStore(join(dataDirectory, 'state.sqlite'));
    bucket = new FileBucket(join(dataDirectory, 'objects'));
  } catch (error) { if (database) await database.close(); processLock.close(); throw error; }
  const env = {
    ENVIRONMENT: 'production',
    ALLOW_REGISTRATION: 'false',
    MAX_CONCURRENT_TASKS: '2',
    MAX_FILE_BYTES: String(8 * 1024 * 1024),
    MAX_USER_FILE_BYTES: String(64 * 1024 * 1024),
    ...variables,
    UPLOADED_FILES: bucket,
  };
  if (env.ENVIRONMENT !== 'development' && env.MOCK_MODEL === 'true') {
    await database.close();
    processLock.close();
    throw new Error('Mock models are not allowed in production');
  }
  env.ACCOUNTS = new LocalNamespace('accounts', AccountDirectory, database, env);
  env.CHUNK_STORAGE = new LocalNamespace('chunks', ChunkStorage, database, env);
  env.TASKS = new LocalNamespace('tasks', DurableTask, database, env);
  const active = new Set();
  const running = new Set();
  let closed = false;
  let closePromise;
  let polling = false;
  const concurrency = Math.max(1, Math.min(4, Number(variables.NODE_TASK_CONCURRENCY) || 2));

  // Queued work may continue after restart. Claimed work is marked interrupted by
  // the existing task state machine, never silently billed a second time.
  for (const alarm of await database.alarms()) {
    if (alarm.namespace === 'tasks') {
      await database.leaseAlarm(alarm.namespace, alarm.id, alarm.time, Date.now());
    }
  }

  async function poll() {
    if (closed || polling) return;
    polling = true;
    try {
      for (const alarm of await database.alarms()) {
        if (closed || running.size >= concurrency) break;
        if (alarm.namespace !== 'tasks' || alarm.time > Date.now() || active.has(alarm.id)) continue;
        if (!await database.leaseAlarm('tasks', alarm.id, alarm.time, Date.now() + 30000)) continue;
        active.add(alarm.id);
        const operation = env.TASKS.alarm(alarm.id).catch(async () => {
          console.error('Background task settlement failed; retrying persisted state');
          // Preserve any newer deadline already committed by the task.
          const storage = database.storage('tasks', alarm.id);
          if (await storage.getAlarm() === null) await storage.setAlarm(Date.now() + 5000);
        }).finally(() => { active.delete(alarm.id); running.delete(operation); });
        running.add(operation);
      }
    } finally { polling = false; }
  }
  const timer = setInterval(() => { poll().catch(() => console.error('Task scheduler unavailable')); }, pollMs);
  timer.unref();
  await poll();
  return {
    env,
    async fetch(request) {
      if (closed) return Response.json({ error: { code: 'SERVER_UNAVAILABLE', message: 'Service temporarily unavailable' } }, { status: 503 });
      const path = new URL(request.url).pathname;
      if (env.ENVIRONMENT !== 'development' && !env.QWEN_API_KEY &&
          request.method === 'POST' && ['/', '/chat', '/tasks'].includes(path)) {
        return Response.json({ error: { code: 'MODEL_NOT_CONFIGURED', message: 'Model credentials are not configured' } }, {
          status: 503, headers: { 'Cache-Control': 'no-store' },
        });
      }
      const response = await handler.fetch(request, env);
      if (response.status < 500) return response;
      await response.body?.cancel();
      return Response.json({ error: { code: 'SERVER_UNAVAILABLE', message: 'Service temporarily unavailable' } }, {
        status: response.status, headers: { 'Cache-Control': 'no-store' },
      });
    },
    close() {
      if (closePromise) return closePromise;
      closed = true;
      clearInterval(timer);
      closePromise = (async () => {
        while (polling) await new Promise(resolve => setTimeout(resolve, 5));
        await Promise.allSettled([...running]);
        await database.close();
        processLock.close();
      })();
      return closePromise;
    },
  };
}
