import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import { Worker } from 'node:worker_threads'
import { SQLiteStore } from '../src/sqlite-store.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sqlite-store-test-'))
  const path = join(root, 'private', 'storage.sqlite')
  const stores = []
  const workers = []
  t.after(async () => {
    for (const worker of workers) await worker.terminate()
    for (const store of stores) await store.close()
    // Only remove this test's freshly created, absolute temporary directory.
    rmSync(root, { recursive: true, force: true })
  })
  return {
    path,
    open() {
      const store = new SQLiteStore(path)
      stores.push(store)
      return store
    },
    worker(operation, nextTime) {
      const ready = deferred()
      const done = deferred()
      const worker = new Worker(
        `
        const { parentPort, workerData } = require('node:worker_threads');
        (async () => {
          if (workerData.operation === 'lock') {
            const { DatabaseSync } = require('node:sqlite');
            const db = new DatabaseSync(workerData.path);
            db.exec('BEGIN IMMEDIATE');
            parentPort.postMessage({ type: 'ready' });
            parentPort.once('message', () => {
              setTimeout(() => {
                db.exec('ROLLBACK');
                db.close();
                parentPort.postMessage({ type: 'done', value: true });
                parentPort.close();
              }, 150);
            });
          } else {
            const { SQLiteStore } = await import(workerData.module);
            const store = new SQLiteStore(workerData.path);
            parentPort.postMessage({ type: 'ready' });
            parentPort.once('message', async () => {
              const value = await store.leaseAlarm('tasks', 'one', 100, workerData.nextTime);
              await store.close();
              parentPort.postMessage({ type: 'done', value });
              parentPort.close();
            });
          }
        })().catch(error => { throw error; });
      `,
        {
          eval: true,
          workerData: {
            operation,
            nextTime,
            path,
            module: new URL('../src/sqlite-store.mjs', import.meta.url).href
          }
        }
      )
      workers.push(worker)
      worker.on('message', (message) => {
        if (message.type === 'ready') ready.resolve()
        if (message.type === 'done') done.resolve(message.value)
      })
      worker.on('error', (error) => {
        ready.reject(error)
        done.reject(error)
      })
      worker.on('exit', (code) => {
        if (code !== 0) {
          const error = new Error(`Database worker exited with code ${code}`)
          ready.reject(error)
          done.reject(error)
        }
      })
      // A startup failure may precede the caller awaiting the completion promise.
      done.promise.catch(() => {})
      return { ready: ready.promise, done: done.promise, start: () => worker.postMessage('start') }
    }
  }
}

const deferred = () => Promise.withResolvers()

test('persists values and alarms across close/reopen, isolating namespaces and IDs', async (t) => {
  const files = fixture(t)
  const first = files.open()
  const task = first.storage('tasks', 'one')
  const value = { deadline: new Date(1000), tokens: 17n, bytes: new Uint8Array([1, 2]) }
  assert.equal(await task.put('record', value), undefined)
  await first.storage('tasks', 'two').put('record', 'other object')
  await first.storage('accounts', 'one').put('record', 'other namespace')
  await task.setAlarm(new Date(2000))
  await first.close()

  const second = files.open()
  assert.deepEqual(await second.storage('tasks', 'one').get('record'), value)
  assert.equal(await second.storage('tasks', 'two').get('record'), 'other object')
  assert.equal(await second.storage('accounts', 'one').get('record'), 'other namespace')
  assert.equal(await second.storage('tasks', 'one').getAlarm(), 2000)
  assert.deepEqual(await second.alarms(), [{ namespace: 'tasks', id: 'one', time: 2000 }])
})

test('uses WAL, parameterized keys and private POSIX permissions', async (t) => {
  const files = fixture(t)
  const store = files.open()
  const storage = store.storage("ns'); DROP TABLE kv; --", "id'?")
  await storage.put("key'; DELETE FROM alarms; --", { safe: true })
  assert.deepEqual(await storage.get("key'; DELETE FROM alarms; --"), { safe: true })
  const db = new DatabaseSync(files.path)
  try {
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal')
    assert.ok(
      db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get('kv').sql.includes('BLOB')
    )
  } finally {
    db.close()
  }
  if (process.platform !== 'win32') {
    assert.equal(statSync(dirname(files.path)).mode & 0o777, 0o700)
    assert.equal(statSync(files.path).mode & 0o777, 0o600)
    assert.equal(statSync(`${files.path}-wal`).mode & 0o777, 0o600)
    assert.equal(statSync(`${files.path}-shm`).mode & 0o777, 0o600)
  }
})

test(
  'busy_timeout waits for a lock held by an independent SQLite connection',
  { timeout: 10000 },
  async (t) => {
    const files = fixture(t)
    const storage = files.open().storage('ns', 'id')
    const worker = files.worker('lock')
    await worker.ready
    worker.start()
    // The worker holds the write lock until its timer fires, even while this thread blocks.
    await storage.put('waited-for-lock', true)
    assert.equal(await worker.done, true)
    assert.equal(await storage.get('waited-for-lock'), true)
  }
)

test('has Cloudflare-compatible get/put/delete shapes, including duplicate and missing keys', async (t) => {
  const store = fixture(t).open()
  const storage = store.storage('ns', 'id')
  assert.equal(await storage.get('missing'), undefined)
  assert.equal(await storage.getAlarm(), null)
  assert.equal(await storage.put({ z: 3, a: 1, undefined: undefined }), undefined)
  assert.deepEqual(
    await storage.get(['z', 'missing', 'a', 'z', 'undefined']),
    new Map([
      ['a', 1],
      ['undefined', undefined],
      ['z', 3]
    ])
  )
  assert.deepEqual(await storage.get([]), new Map())
  assert.equal(await storage.delete('missing'), false)
  assert.equal(await storage.delete('a'), true)
  assert.equal(await storage.delete(['z', 'z', 'missing', 'undefined']), 2)
  assert.equal(await storage.delete([]), 0)
  assert.deepEqual(await storage.list(), new Map())
  assert.equal(await storage.setAlarm(1234), undefined)
  assert.equal(await storage.deleteAlarm(), undefined)
  assert.equal(await storage.deleteAlarm(), undefined)
  assert.equal(await storage.getAlarm(), null)
})

test('rolls back KV and alarms together after async failure and recovers its queue', async (t) => {
  const store = fixture(t).open()
  const storage = store.storage('tasks', 'one')
  const other = store.storage('accounts', 'two')
  await storage.put({ record: 'before', removable: true })
  await storage.setAlarm(100)
  await other.setAlarm(200)
  const failure = new Error('abort')
  await assert.rejects(
    storage.transaction(async (tx) => {
      await tx.put('record', 'uncommitted')
      await tx.delete('removable')
      await tx.setAlarm(900)
      await other.put('cross-object', 'uncommitted')
      await other.deleteAlarm()
      assert.deepEqual(await store.alarms(), [{ namespace: 'tasks', id: 'one', time: 900 }])
      assert.equal(await tx.get('record'), 'uncommitted')
      await tick()
      throw failure
    }),
    (error) => error === failure
  )
  assert.equal(await storage.get('record'), 'before')
  assert.equal(await storage.get('removable'), true)
  assert.equal(await storage.getAlarm(), 100)
  assert.equal(await other.get('cross-object'), undefined)
  assert.equal(await other.getAlarm(), 200)
  assert.equal(
    await storage.transaction(async (tx) => {
      await tx.put('record', 'after')
      await tx.deleteAlarm()
      return 42
    }),
    42
  )
  assert.equal(await storage.get('record'), 'after')
  assert.equal(await storage.getAlarm(), null)
})

test(
  'async transaction blocks external reads and all other-object writes until commit',
  { timeout: 5000 },
  async (t) => {
    const store = fixture(t).open()
    const storage = store.storage('tasks', 'one')
    const other = store.storage('accounts', 'two')
    await storage.put('record', 'before')
    await storage.setAlarm(10)
    const entered = deferred()
    const release = deferred()
    const transaction = storage.transaction(async (tx) => {
      await tx.put('record', 'after')
      await tx.setAlarm(20)
      entered.resolve()
      await release.promise
      // Reentry through the ordinary facade and the store itself must not deadlock.
      assert.equal(await storage.get('record'), 'after')
      await other.put('inside', 'committed')
      assert.equal(await store.leaseAlarm('tasks', 'one', 20, 30), true)
      assert.deepEqual(await tx.list(), new Map([['record', 'after']]))
    })
    await entered.promise
    const completed = []
    const track = (name, promise) =>
      promise.then((value) => {
        completed.push(name)
        return value
      })
    const read = track('get', storage.get('record'))
    const batch = track('get-many', storage.get(['record']))
    const list = track('list', storage.list())
    const alarm = track('getAlarm', storage.getAlarm())
    const alarms = track('alarms', store.alarms())
    const lease = track('leaseAlarm', store.leaseAlarm('tasks', 'one', 30, 40))
    const write = track('put', other.put('outside', 'preserved'))
    const deletion = track('delete', other.delete('inside'))
    const setAlarm = track('setAlarm', other.setAlarm(50))
    const deleteAlarm = track('deleteAlarm', other.deleteAlarm())
    try {
      await tick()
      assert.deepEqual(completed, [])
    } finally {
      release.resolve()
    }
    await transaction
    assert.equal(await read, 'after')
    assert.deepEqual(await batch, new Map([['record', 'after']]))
    assert.deepEqual(await list, new Map([['record', 'after']]))
    assert.equal(await alarm, 30)
    assert.deepEqual(await alarms, [{ namespace: 'tasks', id: 'one', time: 30 }])
    assert.equal(await lease, true)
    await Promise.all([write, deletion, setAlarm, deleteAlarm])
    assert.equal(await other.get('outside'), 'preserved')
    assert.equal(await other.get('inside'), undefined)
    assert.equal(await other.getAlarm(), null)
    assert.equal(await storage.getAlarm(), 40)
  }
)

test(
  'concurrent external writes never join a failing transaction',
  { timeout: 5000 },
  async (t) => {
    const store = fixture(t).open()
    const storage = store.storage('tasks', 'one')
    const other = store.storage('tasks', 'two')
    const entered = deferred()
    const release = deferred()
    const transaction = storage.transaction(async (tx) => {
      await tx.put('record', 'discarded')
      await tx.setAlarm(100)
      entered.resolve()
      await release.promise
      throw new Error('rollback')
    })
    const rejection = assert.rejects(transaction, /rollback/)
    await entered.promise
    const outsideRead = storage.get('record')
    const outsideWrite = other.put('record', 'survives')
    const outsideAlarm = other.setAlarm(200)
    await tick()
    release.resolve()
    await rejection
    assert.equal(await outsideRead, undefined)
    await Promise.all([outsideWrite, outsideAlarm])
    assert.equal(await other.get('record'), 'survives')
    assert.equal(await other.getAlarm(), 200)
    assert.equal(await storage.getAlarm(), null)
  }
)

test(
  'serializes concurrent read/await/write updates without losing increments',
  { timeout: 10000 },
  async (t) => {
    const store = fixture(t).open()
    const storage = store.storage('accounts', 'one')
    await storage.put('count', 0)
    await Promise.all(
      Array.from({ length: 80 }, (_, index) =>
        store.storage('accounts', 'one').transaction(async (tx) => {
          const value = await tx.get('count')
          await tick()
          await tx.put('count', value + 1)
          await tx.put(`entry:${index}`, value + 1)
        })
      )
    )
    assert.equal(await storage.get('count'), 80)
    assert.equal((await storage.list({ prefix: 'entry:' })).size, 80)
  }
)

test('v8 values are cloned at put invocation and every get/list, with cycles and typed values', async (t) => {
  const store = fixture(t).open()
  const storage = store.storage('ns', 'id')
  const entered = deferred()
  const release = deferred()
  const transaction = storage.transaction(async () => {
    entered.resolve()
    await release.promise
  })
  await entered.promise
  const shared = { n: 1 }
  const value = {
    shared,
    alias: shared,
    date: new Date(1000),
    map: new Map([['key', shared]]),
    set: new Set([shared]),
    bytes: new Uint8Array([1, 2]),
    buffer: new ArrayBuffer(2),
    bigint: 2n,
    absent: undefined,
    nan: NaN,
    regexp: /value/gi
  }
  value.self = value
  const write = storage.put('value', value)
  value.shared.n = 99
  value.bytes[0] = 99
  release.resolve()
  await transaction
  await write
  const first = await storage.get('value')
  assert.equal(first.shared.n, 1)
  assert.equal(first.bytes[0], 1)
  assert.equal(first.shared, first.alias)
  assert.equal(first.self, first)
  assert.equal(first.map.get('key'), first.shared)
  assert.equal([...first.set][0], first.shared)
  assert.deepEqual(first.date, new Date(1000))
  assert.deepEqual(first.buffer, new ArrayBuffer(2))
  assert.equal(first.bigint, 2n)
  assert.ok(Number.isNaN(first.nan))
  assert.deepEqual(first.regexp, /value/gi)
  first.shared.n = 7
  first.bytes[0] = 7
  const listed = (await storage.list()).get('value')
  assert.equal(listed.shared.n, 1)
  listed.shared.n = 8
  const batch = (await storage.get(['value'])).get('value')
  assert.equal(batch.shared.n, 1)
  batch.shared.n = 9
  assert.equal((await storage.get('value')).shared.n, 1)
})

test('list uses binary order, task event ranges, exclusive cursors and literal prefixes', async (t) => {
  const store = fixture(t).open()
  const storage = store.storage('tasks', 'one')
  const names = [
    'record',
    'event:00000001',
    'event:00000002',
    'event:00000003',
    'event;next',
    'meta:%_one',
    'meta:Xone',
    'a\0b',
    'a\0c',
    '',
    '\ue000',
    '\u{10000}',
    '\u00e9'
  ]
  await storage.put(Object.fromEntries(names.map((name) => [name, { key: name }])))
  const ordered = [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  assert.deepEqual([...(await storage.list()).keys()], ordered)
  assert.deepEqual([...(await storage.get([...names].reverse())).keys()], ordered)
  assert.deepEqual([...(await storage.list({ prefix: '' })).keys()], ordered)
  assert.deepEqual(
    [
      ...(
        await storage.list({
          start: 'event:00000002',
          end: 'event;',
          limit: 100
        })
      ).keys()
    ],
    ['event:00000002', 'event:00000003']
  )
  assert.deepEqual(
    [
      ...(
        await storage.list({
          prefix: 'event:',
          startAfter: 'event:00000001',
          end: 'event:00000003'
        })
      ).keys()
    ],
    ['event:00000002']
  )
  assert.deepEqual(
    [
      ...(
        await storage.list({
          prefix: 'event:',
          start: 'event:00000001',
          end: 'event;',
          reverse: true,
          limit: 2
        })
      ).keys()
    ],
    ['event:00000003', 'event:00000002']
  )
  assert.deepEqual([...(await storage.list({ prefix: 'meta:%_' })).keys()], ['meta:%_one'])
  assert.deepEqual([...(await storage.list({ prefix: 'a\0' })).keys()], ['a\0b', 'a\0c'])
  assert.deepEqual([...(await storage.list({ start: 'z', end: 'a' })).keys()], [])
  assert.deepEqual([...(await storage.list({ prefix: 'none' })).keys()], [])
  assert.deepEqual([...(await storage.list({ reverse: true, limit: 1 })).keys()], ordered.slice(-1))
})

test(
  'alarm lease is a persisted compare-and-update, safe against competing and stale schedulers',
  { timeout: 10000 },
  async (t) => {
    const files = fixture(t)
    const store = files.open()
    const otherConnection = files.open()
    const storage = store.storage('tasks', 'one')
    await storage.setAlarm(100)
    const firstWorker = files.worker('lease', 200)
    const secondWorker = files.worker('lease', 300)
    await Promise.all([firstWorker.ready, secondWorker.ready])
    firstWorker.start()
    secondWorker.start()
    const leases = await Promise.all([firstWorker.done, secondWorker.done])
    assert.equal(leases.filter(Boolean).length, 1)
    const claimed = await storage.getAlarm()
    assert.ok(claimed === 200 || claimed === 300)
    assert.equal(await store.leaseAlarm('tasks', 'one', 100, 400), false)
    assert.equal(await store.leaseAlarm('tasks', 'missing', 100, 400), false)
    await assert.rejects(
      storage.transaction(async (tx) => {
        assert.equal(await store.leaseAlarm('tasks', 'one', claimed, 500), true)
        assert.equal(await tx.getAlarm(), 500)
        throw new Error('abort lease')
      }),
      /abort lease/
    )
    assert.equal(await storage.getAlarm(), claimed)
    await storage.setAlarm(600)
    assert.equal(await store.leaseAlarm('tasks', 'one', claimed, 700), false)
    await store.storage('a\0ns', 'id\0suffix').setAlarm(10)
    await store.storage('a', 'two').setAlarm(10)
    assert.deepEqual(await store.alarms(), [
      { namespace: 'a', id: 'two', time: 10 },
      { namespace: 'a\0ns', id: 'id\0suffix', time: 10 },
      { namespace: 'tasks', id: 'one', time: 600 }
    ])
    await store.close()
    await otherConnection.close()
    assert.equal(await files.open().storage('tasks', 'one').getAlarm(), 600)
  }
)

test(
  'rejects nested transactions, leaked handles and stale async reentry without deadlock',
  { timeout: 5000 },
  async (t) => {
    const store = fixture(t).open()
    const storage = store.storage('ns', 'id')
    let leaked
    let detached
    const continueDetached = deferred()
    const entered = deferred()
    const release = deferred()
    const transaction = storage.transaction(async (tx) => {
      leaked = tx
      detached = (async () => {
        await continueDetached.promise
        await assert.rejects(storage.put('stale', true), /context is inactive/)
        await assert.rejects(tx.get('value'), /inactive/)
        await assert.rejects(
          storage.transaction(async () => {}),
          /context is inactive/
        )
      })()
      await assert.rejects(
        storage.transaction(async () => {}),
        /Nested transactions/
      )
      await assert.rejects(
        tx.transaction(async () => {}),
        /Nested transactions/
      )
      await assert.rejects(store.close(), /transaction context/)
      await tx.put('value', 1)
      entered.resolve()
      await release.promise
    })
    await entered.promise
    await assert.rejects(leaked.put('outside', true), /outside its callback/)
    release.resolve()
    await transaction
    await assert.rejects(leaked.get('value'), /inactive/)
    continueDetached.resolve()
    await detached
    assert.equal(await storage.get('value'), 1)
    assert.equal(await storage.get('outside'), undefined)
    assert.equal(await storage.get('stale'), undefined)
  }
)

test('bounds key/value/batch/list inputs and rejects invalid entries before writing any of them', async (t) => {
  const store = fixture(t).open()
  const storage = store.storage('ns', 'id')
  const maximumKey = 'k'.repeat(2048)
  await storage.put(maximumKey, true)
  assert.equal(await storage.get(maximumKey), true)
  await storage.put('\u00e9'.repeat(1024), 'utf8')
  await assert.rejects(storage.get('k'.repeat(2049)), /2048 bytes/)
  await assert.rejects(storage.put('\u00e9'.repeat(1025), 1), /2048 bytes/)
  await assert.rejects(storage.put('value', 'x'.repeat(128 * 1024)), /131072 bytes/)
  await assert.rejects(storage.put({ good: 1, bad: () => {} }), /could not be cloned/)
  await assert.rejects(
    storage.put({ good: 1, oversized: Buffer.alloc(128 * 1024) }),
    /131072 bytes/
  )
  assert.equal(await storage.get('good'), undefined)
  const tooMany = Array.from({ length: 129 }, (_, index) => `key:${index}`)
  await assert.rejects(storage.get(tooMany), /128 keys/)
  await assert.rejects(storage.delete(tooMany), /128 keys/)
  await assert.rejects(storage.put(Object.fromEntries(tooMany.map((key) => [key, 1]))), /128 keys/)
  await assert.rejects(storage.get(1), /well-formed string/)
  await assert.rejects(storage.put([], 1), /entries object/)
  await assert.rejects(storage.put('\ud800', 1), /well-formed string/)
  await assert.rejects(storage.get(new Array(1)), /well-formed string/)
  await assert.rejects(storage.transaction(null), /callback/)
  for (const options of [
    null,
    { start: 'a', startAfter: 'b' },
    { limit: 0 },
    { limit: -1 },
    { limit: 1.5 },
    { limit: 10001 },
    { reverse: 'yes' },
    { prefix: 'p'.repeat(2049) }
  ])
    await assert.rejects(storage.list(options))
  for (const time of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '10', new Date(NaN)]) {
    await assert.rejects(storage.setAlarm(time), /timestamp/)
    await assert.rejects(store.leaseAlarm('ns', 'id', time, 100), /timestamp/)
    await assert.rejects(store.leaseAlarm('ns', 'id', 100, time), /timestamp/)
  }
  assert.throws(() => store.storage('', 'id'), /Namespace/)
  assert.throws(() => store.storage('ns', ''), /ID/)
  await storage.put('queue-still-works', true)
  assert.equal(await storage.get('queue-still-works'), true)
})

test(
  'assimilates thenables inside the owning async context and recovers after synchronous errors',
  { timeout: 5000 },
  async (t) => {
    const storage = fixture(t).open().storage('ns', 'id')
    const failure = new Error('synchronous failure')
    await assert.rejects(
      storage.transaction(() => {
        throw failure
      }),
      (error) => error === failure
    )
    const result = await storage.transaction((tx) => ({
      async then(resolve, reject) {
        try {
          await storage.put('record', 'committed')
          await tick()
          assert.equal(await tx.get('record'), 'committed')
          await tx.setAlarm(10)
          resolve('result')
        } catch (error) {
          reject(error)
        }
      }
    }))
    assert.equal(result, 'result')
    assert.equal(await storage.get('record'), 'committed')
    assert.equal(await storage.getAlarm(), 10)
  }
)

test(
  'list safety limits reject an oversized result instead of silently truncating it',
  { timeout: 10000 },
  async (t) => {
    const storage = fixture(t).open().storage('ns', 'id')
    await storage.transaction(async (tx) => {
      for (let offset = 0; offset < 10001; offset += 128) {
        const names = Array.from(
          { length: Math.min(128, 10001 - offset) },
          (_, index) => `row:${String(offset + index).padStart(5, '0')}`
        )
        await tx.put(Object.fromEntries(names.map((name) => [name, true])))
      }
    })
    await assert.rejects(storage.list(), /safety limit/)
    const firstPage = await storage.list({ limit: 10000 })
    assert.equal(firstPage.size, 10000)
    const lastPage = await storage.list({ startAfter: [...firstPage.keys()].at(-1) })
    assert.deepEqual(lastPage, new Map([['row:10000', true]]))
    await storage.put('after-error', true)
    assert.equal(await storage.get('after-error'), true)
  }
)

test(
  'close drains pending work, disallows new requests and is idempotent',
  { timeout: 5000 },
  async (t) => {
    const files = fixture(t)
    const store = files.open()
    const storage = store.storage('ns', 'id')
    const entered = deferred()
    const release = deferred()
    const transaction = storage.transaction(async (tx) => {
      entered.resolve()
      await release.promise
      await tx.put('inside', 1)
    })
    await entered.promise
    const write = storage.put('queued', 2)
    const closing = store.close()
    assert.equal(store.close(), closing)
    await assert.rejects(storage.get('inside'), /closed/)
    await assert.rejects(store.alarms(), /closed/)
    release.resolve()
    await Promise.all([transaction, write, closing])
    await store.close()
    await assert.rejects(storage.put('late', 3), /closed/)
    const reopened = files.open().storage('ns', 'id')
    assert.deepEqual(
      await reopened.list(),
      new Map([
        ['inside', 1],
        ['queued', 2]
      ])
    )
  }
)
