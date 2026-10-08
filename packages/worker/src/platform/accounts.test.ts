import { describe, expect, it, vi } from 'vitest';
import {
  AccountDirectory, accountRPC, beginModelCall, digest, finishTask, getUserUsage,
  reserveTask, settleModelCall, requireUser, handleAuthRequest, listUserFiles,
  listUserTasks, updateTaskSummary, type AccountSettings,
} from './accounts';
import type { Task } from '../types';
import type { AccountFileLease } from './accountTypes';
import { createMockEnv } from '../test/mocks';
class Storage {
  data = new Map<string, unknown>();
  async get<T>(key: string) { return structuredClone(this.data.get(key)) as T | undefined; }
  async put(key: string, value: unknown) { this.data.set(key, structuredClone(value)); }
  async delete(key: string) { return this.data.delete(key); }
  async transaction<T>(fn: (storage: Storage) => Promise<T>) { return fn(this); }
}
export function accountTestEnv(settings: Partial<AccountSettings> = {}) {
  const storage = new Storage(); let queue = Promise.resolve();
  const state = { storage, blockConcurrencyWhile<T>(fn: () => Promise<T>) { const result = queue.then(fn); queue = result.then(() => undefined, () => undefined); return result; } };
  const env = createMockEnv({ ALLOW_REGISTRATION: 'true', ENVIRONMENT: 'development', ...settings });
  const directory = new AccountDirectory(state as unknown as DurableObjectState, env);
  env.ACCOUNTS = { idFromName: (name: string) => name, get: () => directory } as unknown as DurableObjectNamespace;
  return { env, storage, directory, state };
}
function auth(action: string, username = 'alice', password = 'correct-password', origin = 'https://app.test') {
  return new Request('https://app.test/auth/' + action, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username, password }) });
}
const task = (taskId = 'task-1') => ({ userId: 'user-1', taskId, requestHash: 'hash', maxCalls: 2, reservedTokens: 1000, maxDurationMs: 60000 });
describe('Account boundary', () => {
  it('rejects short passwords, null origins and cross-site writes even with allowlisted origin', async () => {
    const { env } = accountTestEnv({ ALLOWED_ORIGINS: 'null,https://trusted.test' });
    await expect(handleAuthRequest(auth('register', 'alice', 'elevenchars'), env)).rejects.toMatchObject({ statusCode: 400 });
    await expect(handleAuthRequest(auth('register', 'alice', 'correct-password', 'null'), env)).rejects.toMatchObject({ statusCode: 403 });
    const request = auth('register', 'alice', 'correct-password', 'https://trusted.test'); request.headers.set('sec-fetch-site', 'cross-site');
    await expect(handleAuthRequest(request, env)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('expires concurrency without refunding ambiguous work or deleting its reservation', async () => {
    const { env, storage } = accountTestEnv({ MAX_CONCURRENT_TASKS: '1' });
    const clock = vi.spyOn(Date, 'now'); const start = Date.now(); clock.mockReturnValue(start);
    try {
      await reserveTask(env, { ...task('expired'), maxDurationMs: 1000 });
      await expect(reserveTask(env, task('next'))).rejects.toMatchObject({ statusCode: 429 });
      clock.mockReturnValue(start + 1001);
      expect((await getUserUsage(env, 'user-1')).activeTasks).toBe(0);
      expect((await getUserUsage(env, 'user-1')).chargedTokens).toBe(1000);
      await reserveTask(env, task('next'));
      expect((await getUserUsage(env, 'user-1')).activeTasks).toBe(1);
      expect(storage.data.has('reservation:user-1:expired')).toBe(true);
      expect(storage.data.has('reservation:user-1:next')).toBe(true);
      await expect(beginModelCall(env, { userId: 'user-1', taskId: 'expired', callId: 'late', model: 'test', estimatedInputTokens: 1, maxOutputTokens: 1 })).rejects.toMatchObject({ statusCode: 409 });
    } finally { clock.mockRestore(); }
  });
  it('fails closed without configured accounts and without authentication', async () => {
    await expect(requireUser(new Request('https://app.test'), createMockEnv())).rejects.toMatchObject({ statusCode: 401 });
    await expect(handleAuthRequest(auth('register'), createMockEnv())).rejects.toMatchObject({ statusCode: 503 });
  });
  it('registers, logs in with secure cookies, stores only salted hash and invalidates logout', async () => {
    const { env, storage } = accountTestEnv({ ENVIRONMENT: 'production' });
    const response = await handleAuthRequest(auth('register'), env);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=Lax');
    expect(JSON.stringify([...storage.data.values()])).not.toContain('correct-password');
    const request = new Request('https://app.test/auth/me', { headers: { cookie } });
    expect((await requireUser(request, env)).username).toBe('alice');
    const login = await handleAuthRequest(auth('login'), env);
    expect(login.status).toBe(200);
    await handleAuthRequest(new Request('https://app.test/auth/logout', { method: 'POST', headers: { cookie, origin: 'https://app.test' } }), env);
    await expect(requireUser(request, env)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('requires an approved origin and explicit registration enablement', async () => {
    const { env } = accountTestEnv({ ALLOW_REGISTRATION: 'false' });
    await expect(handleAuthRequest(auth('register'), env)).rejects.toMatchObject({ statusCode: 403 });
    await expect(handleAuthRequest(auth('login', 'alice', 'correct-password', 'https://evil.test'), env)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('limits failed login attempts without creating sessions', async () => {
    const { env } = accountTestEnv();
    await handleAuthRequest(auth('register'), env);
    for (let i = 0; i < 8; i++) await expect(handleAuthRequest(auth('login', 'alice', 'wrong-password'), env)).rejects.toMatchObject({ statusCode: 401 });
    await expect(handleAuthRequest(auth('login'), env)).rejects.toMatchObject({ statusCode: 429 });
  });
  it('serializes concurrent reservations and does not charge duplicate task requests', async () => {
    const { env } = accountTestEnv({ MAX_CONCURRENT_TASKS: '1' });
    const results = await Promise.allSettled([reserveTask(env, task('a')), reserveTask(env, task('b'))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    await reserveTask(env, task('a'));
    expect((await getUserUsage(env, 'user-1')).chargedTokens).toBe(1000);
    await expect(reserveTask(env, { ...task('a'), requestHash: 'different' })).rejects.toMatchObject({ statusCode: 409 });
  });
  it('settles provider usage once and releases concurrency but retains unknown charges', async () => {
    const { env } = accountTestEnv(); await reserveTask(env, task());
    const call = { userId: 'user-1', taskId: 'task-1', callId: 'call-1', model: 'test', estimatedInputTokens: 100, maxOutputTokens: 400 };
    await beginModelCall(env, call);
    await expect(beginModelCall(env, call)).rejects.toMatchObject({ statusCode: 409 });
    const usage = { ...call, tokenSource: 'provider' as const, inputTokens: 50, outputTokens: 100, outcome: 'completed' };
    await settleModelCall(env, usage); await settleModelCall(env, usage);
    const finish = { userId: 'user-1', taskId: 'task-1', status: 'completed', usageUnknown: false };
    await finishTask(env, finish); await finishTask(env, finish);
    expect((await getUserUsage(env, 'user-1')).chargedTokens).toBe(150);
    await reserveTask(env, task('unknown'));
    await finishTask(env, { ...finish, taskId: 'unknown', status: 'failed', usageUnknown: true });
    const result = await getUserUsage(env, 'user-1'); expect(result.chargedTokens).toBe(1150); expect(result.activeTasks).toBe(0);
  });
  it('enforces per-call and daily limits and isolates account usage', async () => {
    const { env } = accountTestEnv({ DAILY_TOKEN_BUDGET: '1200' }); await reserveTask(env, task());
    await expect(reserveTask(env, task('two'))).rejects.toMatchObject({ statusCode: 429 });
    await expect(beginModelCall(env, { userId: 'user-1', taskId: 'task-1', callId: 'x', model: 'test', estimatedInputTokens: 1001, maxOutputTokens: 1 })).rejects.toMatchObject({ statusCode: 429 });
    expect((await getUserUsage(env, 'user-2')).chargedTokens).toBe(0);
  });
});

const modelCall = (taskId = 'task-1', callId = 'call-1') => ({
  userId: 'user-1', taskId, callId, model: 'test', estimatedInputTokens: 100, maxOutputTokens: 400,
});
const finishedTask = (taskId = 'task-1', usageUnknown = false) => ({
  userId: 'user-1', taskId, status: 'completed', usageUnknown,
});

describe('Task budget accounting', () => {
  it('ignores conflicting duplicate settlement and finish without any new write', async () => {
    const { env, storage } = accountTestEnv();
    await reserveTask(env, task());
    await beginModelCall(env, modelCall());
    await settleModelCall(env, {
      ...modelCall(), tokenSource: 'provider', inputTokens: 50, outputTokens: 100, outcome: 'completed',
    });
    await finishTask(env, finishedTask());
    const previous = structuredClone(storage.data);
    const put = vi.spyOn(storage, 'put');
    await settleModelCall(env, {
      ...modelCall(), tokenSource: 'unknown', inputTokens: 999, outputTokens: 999, outcome: 'failed',
    });
    await finishTask(env, finishedTask('task-1', true));
    expect(put).not.toHaveBeenCalled();
    expect(storage.data).toEqual(previous);
    expect(await getUserUsage(env, 'user-1')).toMatchObject({ chargedTokens: 150, activeTasks: 0 });
  });

  it.each([
    { source: 'estimated' as const, input: 1, output: 2 },
    { source: 'unknown' as const, input: 1, output: 2 },
    { source: 'provider' as const, input: 1, output: undefined },
  ])('keeps conservative reservation for $source usage ($output output tokens)', async ({ source, input, output }) => {
    const { env, storage } = accountTestEnv();
    await reserveTask(env, task());
    await beginModelCall(env, modelCall());
    await settleModelCall(env, {
      ...modelCall(), tokenSource: source, inputTokens: input, outputTokens: output, outcome: 'completed',
    });
    await finishTask(env, finishedTask());
    // A partial provider count falls back to its call reservation, exactly as before.
    expect((await getUserUsage(env, 'user-1')).chargedTokens).toBe(source === 'provider' ? 500 : 1000);
    expect(storage.data.get('reservation:user-1:task-1')).toMatchObject({ used: 500, finished: true });
  });

  it('keeps precharge when usageUnknown is true even if all calls have provider usage', async () => {
    const { env } = accountTestEnv();
    await reserveTask(env, task());
    await beginModelCall(env, modelCall());
    await settleModelCall(env, {
      ...modelCall(), tokenSource: 'provider', inputTokens: 1, outputTokens: 2, outcome: 'completed',
    });
    await finishTask(env, finishedTask('task-1', true));
    expect(await getUserUsage(env, 'user-1')).toMatchObject({ chargedTokens: 1000, activeTasks: 0 });
  });

  it('records late provider settlement after unknown finish without retroactive refund', async () => {
    const { env, storage } = accountTestEnv();
    await reserveTask(env, task());
    await beginModelCall(env, modelCall());
    await finishTask(env, finishedTask('task-1', true));
    await settleModelCall(env, {
      ...modelCall(), tokenSource: 'provider', inputTokens: 10, outputTokens: 20, outcome: 'completed',
    });
    await finishTask(env, finishedTask());
    expect(storage.data.get('reservation:user-1:task-1')).toMatchObject({ finished: true, used: 30 });
    expect(await getUserUsage(env, 'user-1')).toMatchObject({ chargedTokens: 1000, activeTasks: 0 });
    await expect(beginModelCall(env, modelCall('task-1', 'late'))).rejects.toMatchObject({ code: 'TASK_STOPPED' });
  });

  it('allows explicit finish to refund an unused reservation, including after expiry', async () => {
    const { env, storage } = accountTestEnv();
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    await reserveTask(env, { ...task(), maxDurationMs: 1000 });
    clock.mockReturnValue(start + 1001);
    expect((await getUserUsage(env, 'user-1')).chargedTokens).toBe(1000);
    await finishTask(env, finishedTask());
    expect((await getUserUsage(env, 'user-1')).chargedTokens).toBe(0);
    expect(storage.data.has('reservation:user-1:task-1')).toBe(true);
  });

  it('settles on the original UTC day and does not debit the day of completion', async () => {
    const { env, storage } = accountTestEnv();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-29T23:59:50Z'));
    await reserveTask(env, task());
    await beginModelCall(env, modelCall());
    clock.mockReturnValue(Date.parse('2026-09-30T00:00:10Z'));
    await settleModelCall(env, {
      ...modelCall(), tokenSource: 'provider', inputTokens: 50, outputTokens: 100, outcome: 'completed',
    });
    await finishTask(env, finishedTask());
    expect(storage.data.get('ledger:user-1')).toEqual({ days: { '2026-09-29': 150 }, active: {} });
    expect(await getUserUsage(env, 'user-1')).toMatchObject({ day: '2026-09-30', chargedTokens: 0 });
  });

  it('keeps settled calls committed and honors call-count limits independently of tokens', async () => {
    const { env, storage } = accountTestEnv();
    await reserveTask(env, { ...task(), maxCalls: 1 });
    await beginModelCall(env, modelCall());
    await settleModelCall(env, {
      ...modelCall(), tokenSource: 'provider', inputTokens: 1, outputTokens: 1, outcome: 'completed',
    });
    const previous = structuredClone(storage.data);
    await expect(beginModelCall(env, modelCall('task-1', 'second'))).rejects.toMatchObject({ code: 'BUDGET_LIMIT' });
    expect(storage.data).toEqual(previous);
  });

  it('does not truncate larger provider usage to the pre-reservation', async () => {
    const { env } = accountTestEnv();
    await reserveTask(env, task());
    await beginModelCall(env, modelCall());
    await settleModelCall(env, {
      ...modelCall(), tokenSource: 'provider', inputTokens: 600, outputTokens: 600, outcome: 'completed',
    });
    await finishTask(env, finishedTask());
    expect((await getUserUsage(env, 'user-1')).chargedTokens).toBe(1200);
  });

  it('preserves reservation records while pruning the 35-day ledger window on writes', async () => {
    const { env, storage } = accountTestEnv();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T12:00:00Z'));
    const legacyReservation = { taskId: 'old', requestHash: 'old', reserved: 5 };
    storage.data.set('reservation:user-1:old', legacyReservation);
    storage.data.set('ledger:user-1', {
      days: { '2026-08-25': 5, '2026-08-27': 7 }, active: { old: Date.parse('2026-09-01T00:00:00Z') },
    });
    const before = structuredClone(storage.data);
    await getUserUsage(env, 'user-1');
    expect(storage.data).toEqual(before);
    await reserveTask(env, task());
    expect(storage.data.get('ledger:user-1')).toMatchObject({ days: { '2026-08-27': 7, '2026-09-30': 1000 } });
    expect((storage.data.get('ledger:user-1') as { days: object }).days).not.toHaveProperty('2026-08-25');
    expect(storage.data.get('reservation:user-1:old')).toEqual(legacyReservation);
  });

  it.each(['begin-call', 'settle-call', 'finish'])('isolates %s by account without changing another owner', async action => {
    const { env, storage } = accountTestEnv();
    await reserveTask(env, task());
    await beginModelCall(env, modelCall());
    const previous = structuredClone(storage.data);
    await expect(accountRPC(env, action, {
      ...modelCall(), ...finishedTask(), userId: 'user-2',
      tokenSource: 'provider', inputTokens: 1, outputTokens: 1, outcome: 'completed',
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(storage.data).toEqual(previous);
  });
});

const fileTarget = { userId: 'alice', fileId: 'internal-file' };
const reserveFile = (env: AccountSettings, fileId = fileTarget.fileId, userId = 'alice', bytes = 5) =>
  accountRPC(env, 'reserve-file', { userId, fileId, bytes, metadata: { externalFileId: 'public-file', fileName: 'test.txt', mimeType: 'text/plain' } });
const leaseFile = (env: AccountSettings, kind: 'upload' | 'complete' | 'delete') =>
  accountRPC<AccountFileLease>(env, 'lease-file', { ...fileTarget, kind });

describe('File capacity and lease ownership', () => {
  it.each(['validate-file-lease', 'end-file-lease', 'complete-file', 'release-file'])(
    'rejects another account lease on %s without touching either quota',
    async action => {
      const { env, storage } = accountTestEnv();
      await reserveFile(env);
      await reserveFile(env, fileTarget.fileId, 'bob');
      const lease = await leaseFile(env, 'complete');
      const previous = structuredClone(storage.data);
      await expect(accountRPC(env, action, { ...fileTarget, userId: 'bob', ...lease, kind: 'complete' }))
        .rejects.toMatchObject({ code: 'FILE_LEASE_CHANGED' });
      expect(storage.data).toEqual(previous);
    },
  );

  it.each(['upload', 'complete'] as const)('requires deletion lease to release %s quota', async kind => {
    const { env, storage } = accountTestEnv();
    await reserveFile(env);
    const lease = await leaseFile(env, kind);
    const previous = structuredClone(storage.data);
    await expect(accountRPC(env, 'release-file', { ...fileTarget, ...lease })).rejects.toMatchObject({ code: 'FILE_LEASE_CHANGED' });
    expect(storage.data).toEqual(previous);
  });

  it('requires a completion lease and rejects validation with the wrong operation kind', async () => {
    const { env, storage } = accountTestEnv();
    await reserveFile(env);
    const lease = await leaseFile(env, 'upload');
    const previous = structuredClone(storage.data);
    await expect(accountRPC(env, 'complete-file', { ...fileTarget, ...lease })).rejects.toMatchObject({ code: 'FILE_LEASE_CHANGED' });
    await expect(accountRPC(env, 'validate-file-lease', { ...fileTarget, ...lease, kind: 'complete' }))
      .rejects.toMatchObject({ code: 'FILE_LEASE_EXPIRED' });
    expect(storage.data).toEqual(previous);
  });

  it('retains ambiguous expired uploads and deletion tombstones until cleanup finishes', async () => {
    const { env, storage } = accountTestEnv();
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    await reserveFile(env);
    const uploadLease = await leaseFile(env, 'upload');
    clock.mockReturnValue(start + 120000);
    const previous = structuredClone(storage.data);
    await expect(accountRPC(env, 'validate-file-lease', { ...fileTarget, ...uploadLease, kind: 'upload' }))
      .rejects.toMatchObject({ code: 'FILE_LEASE_EXPIRED' });
    await expect(leaseFile(env, 'upload')).rejects.toMatchObject({ code: 'FILE_OPERATION_UNKNOWN' });
    await expect(reserveFile(env)).rejects.toMatchObject({ code: 'FILE_BUSY' });
    expect(storage.data).toEqual(previous);
    const deletion = await leaseFile(env, 'delete');
    await accountRPC(env, 'end-file-lease', { ...fileTarget, ...deletion });
    await expect(leaseFile(env, 'complete')).rejects.toMatchObject({ code: 'FILE_DELETING' });
    await expect(reserveFile(env)).rejects.toMatchObject({ code: 'FILE_BUSY' });
    expect(await listUserFiles(env, 'alice')).toHaveLength(1);
    const retry = await leaseFile(env, 'delete');
    await accountRPC(env, 'release-file', { ...fileTarget, ...retry });
    expect(await listUserFiles(env, 'alice')).toEqual([]);
  });

  it('prevents old lease or generation from releasing a newly reserved file', async () => {
    const { env, storage } = accountTestEnv();
    await reserveFile(env);
    const old = await leaseFile(env, 'delete');
    await accountRPC(env, 'release-file', { ...fileTarget, ...old });
    await reserveFile(env);
    const current = await leaseFile(env, 'delete');
    expect(current.generation).not.toBe(old.generation);
    const previous = structuredClone(storage.data);
    for (const identity of [old, { ...current, generation: old.generation }, { ...current, leaseId: old.leaseId }]) {
      await expect(accountRPC(env, 'release-file', { ...fileTarget, ...identity })).rejects.toMatchObject({ code: 'FILE_LEASE_CHANGED' });
    }
    expect(storage.data).toEqual(previous);
  });

  it('allows authoritative same-generation cleanup after expiry without granting new writes', async () => {
    const { env } = accountTestEnv();
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    await reserveFile(env);
    const completion = await leaseFile(env, 'complete');
    clock.mockReturnValue(start + 120001);
    await accountRPC(env, 'complete-file', { ...fileTarget, ...completion });
    await accountRPC(env, 'end-file-lease', { ...fileTarget, ...completion });
    expect((await listUserFiles(env, 'alice'))[0].status).toBe('complete');
    const deletion = await leaseFile(env, 'delete');
    clock.mockReturnValue(start + 240002);
    await accountRPC(env, 'release-file', { ...fileTarget, ...deletion });
    expect(await listUserFiles(env, 'alice')).toEqual([]);
  });

  it('preserves record fields, generation and immutable metadata on duplicate reservation', async () => {
    const { env, storage } = accountTestEnv();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await reserveFile(env);
    const original = structuredClone(storage.data.get('file-quota:alice')) as Record<string, object>;
    clock.mockReturnValue(now + 1);
    await accountRPC(env, 'reserve-file', {
      ...fileTarget, bytes: 5, metadata: { externalFileId: 'public-file', fileName: 'spoofed', mimeType: 'image/jpeg' },
    });
    expect(storage.data.get('file-quota:alice')).toEqual({
      ...original, [fileTarget.fileId]: { ...original[fileTarget.fileId], updatedAt: now + 1 },
    });
    expect(Object.keys(original[fileTarget.fileId]).sort()).toEqual([
      'bytes', 'complete', 'createdAt', 'externalFileId', 'fileName', 'generation', 'mimeType', 'updatedAt',
    ]);
    const lease = await leaseFile(env, 'upload');
    const entry = (storage.data.get('file-quota:alice') as Record<string, { lease: object }>)[fileTarget.fileId];
    expect(entry.lease).toEqual({ id: lease.leaseId, kind: 'upload', expiresAt: lease.expiresAt });
    expect(JSON.stringify(await listUserFiles(env, 'alice'))).not.toContain(lease.generation);
  });

  it('enforces count and byte quotas without changing reservations on a rejected write', async () => {
    const { env, storage } = accountTestEnv({ MAX_FILE_BYTES: '10', MAX_USER_FILE_BYTES: '1000' });
    for (let index = 0; index < 50; index++) await reserveFile(env, 'file-' + index);
    const previous = structuredClone(storage.data);
    await expect(reserveFile(env, 'fifty-first')).rejects.toMatchObject({ code: 'FILE_QUOTA', statusCode: 413 });
    await expect(reserveFile(env, 'too-large', 'alice', 11)).rejects.toMatchObject({ code: 'FILE_QUOTA' });
    await expect(reserveFile(env, 'file-0', 'alice', 6)).rejects.toMatchObject({ code: 'FILE_CONFLICT' });
    expect(storage.data).toEqual(previous);
    env.MAX_USER_FILE_BYTES = '5';
    await reserveFile(env, 'one', 'bob');
    await expect(reserveFile(env, 'two', 'bob')).rejects.toMatchObject({ code: 'FILE_QUOTA' });
    expect(await listUserFiles(env, 'alice')).toHaveLength(50);
  });
});

describe('Account request input gate', () => {
  it('converts business errors inside the concurrency gate rather than rejecting its callback', async () => {
    const { env, state } = accountTestEnv();
    const gate = vi.spyOn(state, 'blockConcurrencyWhile');
    await expect(accountRPC(env, 'unknown', {})).rejects.toMatchObject({ statusCode: 400 });
    await expect(gate.mock.results[0].value).resolves.toHaveProperty('status', 400);
    await expect(reserveTask(env, { ...task(), reservedTokens: 16001 })).rejects.toMatchObject({ statusCode: 429 });
    await expect(gate.mock.results[1].value).resolves.toHaveProperty('status', 429);
    await expect(reserveTask(env, task())).resolves.toEqual({ reservationId: 'task-1' });
  });

  it.each([
    ['unknown', { userId: 'user-1', taskId: 'task-1' }],
    ['release-file-typo', fileTarget],
    ['reserve', null],
    ['reserve', []],
    ['reserve', { ...task(), userId: { id: 'user-1' } }],
    ['reserve', { ...task(), taskId: '__proto__' }],
    ['reserve', { ...task(), reservedTokens: '1000' }],
    ['reserve', { ...task(), maxCalls: -1 }],
    ['begin-call', { ...modelCall(), callId: 'constructor' }],
    ['begin-call', { ...modelCall(), estimatedInputTokens: 0.5 }],
    ['settle-call', { ...modelCall(), tokenSource: 'bogus', outcome: 'done' }],
    ['settle-call', { ...modelCall(), tokenSource: 'provider', inputTokens: -1, outcome: 'done' }],
    ['finish', { ...finishedTask(), usageUnknown: 'false' }],
    ['summary', { userId: 'user-1', summary: {} }],
    ['reserve-file', { ...fileTarget, bytes: '5' }],
    ['reserve-file', { ...fileTarget, bytes: 5, metadata: { fileName: {} } }],
    ['reserve-file', { ...fileTarget, bytes: 5, metadata: { externalFileId: '../escape' } }],
    ['lease-file', { ...fileTarget, kind: 'bogus' }],
    ['release-file', { ...fileTarget, leaseId: {}, generation: 'generation' }],
    ['login', { username: 'alice', password: 'correct-password' }],
  ])('rejects malformed %s requests before any storage write (%j)', async (action, input) => {
    const { env, storage } = accountTestEnv();
    await reserveTask(env, task());
    await beginModelCall(env, modelCall());
    await reserveFile(env);
    const previous = structuredClone(storage.data);
    const put = vi.spyOn(storage, 'put');
    const remove = vi.spyOn(storage, 'delete');
    const transaction = vi.spyOn(storage, 'transaction');
    await expect(accountRPC(env, action as string, input)).rejects.toMatchObject({ code: 'ACCOUNT_INVALID', statusCode: 400 });
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(storage.data).toEqual(previous);
  });

  it('rejects malformed JSON and non-POST RPC requests without writes', async () => {
    const { directory, storage } = accountTestEnv();
    const badJSON = await directory.fetch(new Request('https://accounts/reserve', { method: 'POST', body: '{' }));
    expect(badJSON.status).toBe(400);
    const wrongMethod = await directory.fetch(new Request('https://accounts/logout', { method: 'GET' }));
    expect(wrongMethod.status).toBe(405);
    expect(storage.data.size).toBe(0);
  });

  it('rejects unsafe settlement sums without updating the call or ledger', async () => {
    const { env, storage } = accountTestEnv();
    await reserveTask(env, task());
    await beginModelCall(env, modelCall());
    const previous = structuredClone(storage.data);
    await expect(settleModelCall(env, {
      ...modelCall(), tokenSource: 'provider',
      inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1, outcome: 'completed',
    })).rejects.toMatchObject({ code: 'ACCOUNT_INVALID' });
    expect(storage.data).toEqual(previous);
  });
});

describe('Account authentication compatibility', () => {
  it('preserves account-change guards across me, usage and files', async () => {
    const { env, storage } = accountTestEnv();
    const registration = await handleAuthRequest(auth('register'), env);
    const cookie = registration.headers.get('set-cookie')!;
    const previous = structuredClone(storage.data);
    for (const action of ['me', 'usage', 'files']) {
      await expect(handleAuthRequest(new Request('https://app.test/auth/' + action, {
        headers: { cookie, 'X-Account-ID': 'someone-else' },
      }), env)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED', statusCode: 409 });
    }
    expect(storage.data).toEqual(previous);
  });

  it('uses hashed session keys with the original expiry and cookie lifetime', async () => {
    const { env, storage } = accountTestEnv({ ENVIRONMENT: 'production' });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const registration = await handleAuthRequest(auth('register'), env);
    const cookie = registration.headers.get('set-cookie')!;
    const token = cookie.split(';')[0].slice('ait_session='.length);
    const key = 'session:' + await digest(token);
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(cookie).toContain('Max-Age=2592000');
    expect(cookie).toContain('Secure');
    expect(storage.data.get(key)).toMatchObject({ expiresAt: now + 2592000000 });
    clock.mockReturnValue(now + 2592000000);
    const response = await handleAuthRequest(new Request('https://app.test/auth/me', { headers: { cookie } }), env);
    expect(await response.json()).toMatchObject({ user: null });
    expect(storage.data.has(key)).toBe(false);
    const logout = await handleAuthRequest(new Request('https://app.test/auth/logout', {
      method: 'POST', headers: { cookie, origin: 'https://app.test' },
    }), env);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('keeps the IP attempt window after successful logins and preserves throttling order', async () => {
    const { env, storage } = accountTestEnv();
    await handleAuthRequest(auth('register'), env);
    const ipKey = 'attempt:ip:' + await digest('unknown');
    expect(storage.data.get(ipKey)).toMatchObject({ count: 1 });
    await handleAuthRequest(auth('login'), env);
    expect(storage.data.get(ipKey)).toMatchObject({ count: 2 });
    expect(storage.data.has('attempt:user:alice')).toBe(false);
    storage.data.set(ipKey, { count: 30, until: Date.now() + 60000 });
    const sessions = [...storage.data.keys()].filter(key => key.startsWith('session:'));
    await expect(handleAuthRequest(auth('login'), env)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(storage.data.get('attempt:user:alice')).toMatchObject({ count: 1 });
    expect([...storage.data.keys()].filter(key => key.startsWith('session:'))).toEqual(sessions);
  });

  it.each(['http://app.test', 'https://app.test/', 'https://user@app.test', 'not-a-url'])(
    'rejects unsafe production origin %s before storage mutation',
    async origin => {
      const { env, storage } = accountTestEnv({ ENVIRONMENT: 'production', ALLOWED_ORIGINS: origin });
      await expect(handleAuthRequest(auth('register', 'alice', 'correct-password', origin), env))
        .rejects.toMatchObject({ code: 'ORIGIN_FORBIDDEN' });
      expect(storage.data.size).toBe(0);
    },
  );
});

describe('Account task summary index', () => {
  const summary = (id: string): Task => ({
    id, type: 'chat', status: 'completed', userMessage: 'x'.repeat(200), steps: [],
    result: 'private model result', metadata: { model: 'private model' }, createdAt: 1, updatedAt: 2,
  });

  it('keeps the original bounded projection without touching task budget or file quota', async () => {
    const { env, storage } = accountTestEnv();
    await reserveTask(env, task());
    await reserveFile(env);
    const previous = structuredClone(storage.data);
    const source = summary('task-1');
    await updateTaskSummary(env, 'user-1', source);
    expect(await listUserTasks(env, 'user-1')).toEqual([{
      id: 'task-1', type: 'chat', status: 'completed', userMessage: 'x'.repeat(120),
      steps: [], createdAt: 1, updatedAt: 2,
    }]);
    expect(await listUserTasks(env, 'user-2')).toEqual([]);
    expect(storage.data.get('ledger:user-1')).toEqual(previous.get('ledger:user-1'));
    expect(storage.data.get('reservation:user-1:task-1')).toEqual(previous.get('reservation:user-1:task-1'));
    expect(storage.data.get('file-quota:alice')).toEqual(previous.get('file-quota:alice'));
    expect(source.userMessage).toHaveLength(200);
  });

  it('caps history at 100 and replaces duplicate IDs at the front', async () => {
    const { env } = accountTestEnv();
    for (let index = 0; index < 101; index++) await updateTaskSummary(env, 'user-1', summary('task-' + index));
    const result = await listUserTasks(env, 'user-1');
    expect(result).toHaveLength(100);
    expect(result[0].id).toBe('task-100');
    expect(result.some(task => task.id === 'task-0')).toBe(false);
    await updateTaskSummary(env, 'user-1', { ...summary('task-50'), status: 'failed', updatedAt: 3 });
    const replaced = await listUserTasks(env, 'user-1');
    expect(replaced).toHaveLength(100);
    expect(replaced[0]).toMatchObject({ id: 'task-50', status: 'failed', updatedAt: 3 });
    expect(replaced.filter(task => task.id === 'task-50')).toHaveLength(1);
  });
});
