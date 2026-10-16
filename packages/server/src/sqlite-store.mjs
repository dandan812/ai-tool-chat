import { AsyncLocalStorage } from 'node:async_hooks'
import { chmodSync, closeSync, constants, fchmodSync, mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { deserialize, serialize } from 'node:v8'

const MAX_KEY_BYTES = 2048
const MAX_VALUE_BYTES = 128 * 1024
const MAX_BATCH_KEYS = 128
const MAX_LIST_ROWS = 10000
const MAX_LIST_BYTES = 64 * 1024 * 1024

function text(value, label, allowEmpty = true) {
  if (typeof value !== 'string' || !value.isWellFormed() || (!allowEmpty && !value)) {
    throw new TypeError(`${label} must be a well-formed string`)
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_KEY_BYTES) {
    throw new RangeError(`${label} exceeds ${MAX_KEY_BYTES} bytes`)
  }
  return value
}

function keys(input) {
  const many = Array.isArray(input)
  if (many && input.length > MAX_BATCH_KEYS) {
    throw new RangeError(`A batch cannot exceed ${MAX_BATCH_KEYS} keys`)
  }
  const result = [...new Set(Array.from(many ? input : [input], (key) => text(key, 'Key')))]
  result.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
  return { many, values: result }
}

function timestamp(value) {
  const time = value instanceof Date ? value.getTime() : value
  if (!Number.isSafeInteger(time) || time < 0) {
    throw new TypeError('Alarm time must be a non-negative safe integer timestamp')
  }
  return time
}

function encoded(value) {
  const blob = serialize(value)
  if (blob.byteLength > MAX_VALUE_BYTES) {
    throw new RangeError(`Serialized value exceeds ${MAX_VALUE_BYTES} bytes`)
  }
  return blob
}

function decodeText(blob) {
  // node:sqlite truncates returned TEXT at NUL; BLOB preserves the complete key.
  return Buffer.from(blob).toString('utf8')
}

// Use one store per database per event loop and a dedicated private data directory.
export class SQLiteStore {
  #db
  #context = new AsyncLocalStorage()
  #tail = Promise.resolve()
  #closing = false
  #closed = false
  #closePromise
  #get
  #put
  #delete
  #getAlarm
  #setAlarm
  #deleteAlarm
  #alarms
  #leaseAlarm

  constructor(path) {
    if (typeof path !== 'string' || !path || path.includes('\0')) {
      throw new TypeError('Database path must be a non-empty string without NUL')
    }
    if (path !== ':memory:') {
      path = resolve(path)
      const directory = dirname(path)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      chmodSync(directory, 0o700)
      const fd = openSync(
        path,
        constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
        0o600
      )
      try {
        fchmodSync(fd, 0o600)
      } finally {
        closeSync(fd)
      }
    }
    this.#db = new DatabaseSync(path)
    try {
      this.#db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS kv (
          ns TEXT COLLATE BINARY NOT NULL,
          id TEXT COLLATE BINARY NOT NULL,
          key TEXT COLLATE BINARY NOT NULL,
          value BLOB NOT NULL,
          PRIMARY KEY (ns, id, key)
        ) STRICT, WITHOUT ROWID;
        CREATE TABLE IF NOT EXISTS alarms (
          ns TEXT COLLATE BINARY NOT NULL,
          id TEXT COLLATE BINARY NOT NULL,
          time INTEGER NOT NULL,
          PRIMARY KEY (ns, id)
        ) STRICT, WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS alarms_by_time ON alarms(time, ns, id);
      `)
      this.#get = this.#db.prepare('SELECT value FROM kv WHERE ns = ? AND id = ? AND key = ?')
      this.#put = this.#db.prepare(`
        INSERT INTO kv (ns, id, key, value) VALUES (?, ?, ?, ?)
        ON CONFLICT (ns, id, key) DO UPDATE SET value = excluded.value
      `)
      this.#delete = this.#db.prepare('DELETE FROM kv WHERE ns = ? AND id = ? AND key = ?')
      this.#getAlarm = this.#db.prepare('SELECT time FROM alarms WHERE ns = ? AND id = ?')
      this.#setAlarm = this.#db.prepare(`
        INSERT INTO alarms (ns, id, time) VALUES (?, ?, ?)
        ON CONFLICT (ns, id) DO UPDATE SET time = excluded.time
      `)
      this.#deleteAlarm = this.#db.prepare('DELETE FROM alarms WHERE ns = ? AND id = ?')
      this.#alarms = this.#db.prepare(`
        SELECT CAST(ns AS BLOB) AS ns, CAST(id AS BLOB) AS id, time
        FROM alarms ORDER BY time, ns COLLATE BINARY, id COLLATE BINARY
      `)
      this.#leaseAlarm = this.#db.prepare(`
        UPDATE alarms SET time = ? WHERE ns = ? AND id = ? AND time = ?
      `)
    } catch (error) {
      this.#db.close()
      throw error
    }
  }

  storage(namespace, id) {
    return this.#storage(text(namespace, 'Namespace', false), text(id, 'ID', false))
  }

  #storage(namespace, id, transaction) {
    const run = (operation) => this.#dispatch(operation, transaction)
    return Object.freeze({
      get: async (input) => {
        const { many, values } = keys(input)
        return run(() => {
          if (!many) {
            const row = this.#get.get(namespace, id, values[0])
            return row ? deserialize(row.value) : undefined
          }
          const result = new Map()
          for (const key of values) {
            const row = this.#get.get(namespace, id, key)
            if (row) result.set(key, deserialize(row.value))
          }
          return result
        })
      },
      put: async (input, value) => {
        let entries
        if (typeof input === 'string') {
          entries = [[text(input, 'Key'), encoded(value)]]
        } else {
          if (
            !input ||
            (Object.getPrototypeOf(input) !== Object.prototype &&
              Object.getPrototypeOf(input) !== null)
          ) {
            throw new TypeError('Put requires a key or an entries object')
          }
          const names = Object.keys(input)
          if (names.length > MAX_BATCH_KEYS) {
            throw new RangeError(`A batch cannot exceed ${MAX_BATCH_KEYS} keys`)
          }
          // Snapshot and validate every value before any queued write can run.
          entries = names.map((key) => [text(key, 'Key'), encoded(input[key])])
        }
        return run(() =>
          this.#atomic(() => {
            for (const [key, blob] of entries) this.#put.run(namespace, id, key, blob)
          })
        )
      },
      delete: async (input) => {
        const { many, values } = keys(input)
        return run(() =>
          this.#atomic(() => {
            let count = 0
            for (const key of values) count += this.#delete.run(namespace, id, key).changes
            return many ? count : count !== 0
          })
        )
      },
      list: async (options = {}) => {
        const query = this.#listQuery(namespace, id, options)
        return run(() => {
          const result = new Map()
          let bytes = 0
          for (const row of this.#db.prepare(query.sql).iterate(...query.params)) {
            bytes += row.key.byteLength + row.value.byteLength
            if (result.size === MAX_LIST_ROWS || bytes > MAX_LIST_BYTES) {
              throw new RangeError('List result exceeds the safety limit; request a smaller page')
            }
            result.set(decodeText(row.key), deserialize(row.value))
          }
          return result
        })
      },
      transaction: async (callback) => {
        if (transaction) throw new Error('Nested transactions are not supported')
        return this.#transaction(namespace, id, callback)
      },
      getAlarm: async () => run(() => this.#getAlarm.get(namespace, id)?.time ?? null),
      setAlarm: async (value) => {
        const time = timestamp(value)
        return run(() => {
          this.#setAlarm.run(namespace, id, time)
        })
      },
      deleteAlarm: async () =>
        run(() => {
          this.#deleteAlarm.run(namespace, id)
        })
    })
  }

  #listQuery(namespace, id, options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('List options must be an object')
    }
    const { prefix, start, end, startAfter, limit, reverse = false } = options
    if (start !== undefined && startAfter !== undefined) {
      throw new TypeError('List cannot specify both start and startAfter')
    }
    if (typeof reverse !== 'boolean') throw new TypeError('List reverse must be a boolean')
    if (
      limit !== undefined &&
      (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_ROWS)
    ) {
      throw new RangeError(`List limit must be between 1 and ${MAX_LIST_ROWS}`)
    }
    const conditions = ['ns = ?', 'id = ?']
    const params = [namespace, id]
    for (const [value, comparison, label] of [
      [start, '>=', 'Start'],
      [startAfter, '>', 'StartAfter'],
      [end, '<', 'End']
    ]) {
      if (value !== undefined) {
        conditions.push(`key COLLATE BINARY ${comparison} ?`)
        params.push(text(value, label))
      }
    }
    if (prefix !== undefined) {
      const bytes = Buffer.from(text(prefix, 'Prefix'))
      if (bytes.byteLength) {
        conditions.push('key COLLATE BINARY >= ?', 'substr(CAST(key AS BLOB), 1, ?) = ?')
        params.push(prefix, bytes.byteLength, bytes)
      }
    }
    params.push(limit ?? MAX_LIST_ROWS + 1)
    return {
      sql: `SELECT CAST(key AS BLOB) AS key, value FROM kv
        WHERE ${conditions.join(' AND ')}
        ORDER BY key COLLATE BINARY ${reverse ? 'DESC' : 'ASC'} LIMIT ?`,
      params
    }
  }

  #enqueue(operation) {
    if (this.#closed || this.#closing) return Promise.reject(new Error('SQLiteStore is closed'))
    const result = this.#tail.then(operation)
    this.#tail = result.catch(() => {})
    return result
  }

  #dispatch(operation, transaction) {
    const context = this.#context.getStore()
    if (transaction && (context !== transaction || !transaction.active)) {
      return Promise.reject(
        new Error('Transaction handle is inactive or used outside its callback')
      )
    }
    if (!context) return this.#enqueue(operation)
    if (!context.active) return Promise.reject(new Error('Transaction context is inactive'))
    // Only the owning async context bypasses the global queue, including across await.
    try {
      return Promise.resolve(operation())
    } catch (error) {
      return Promise.reject(error)
    }
  }

  #atomic(operation) {
    if (this.#context.getStore()?.active) return operation()
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.#db.exec('COMMIT')
      return result
    } catch (error) {
      this.#rollback(error)
    }
  }

  #rollback(error) {
    try {
      this.#db.exec('ROLLBACK')
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Transaction and rollback both failed')
    }
    throw error
  }

  #transaction(namespace, id, callback) {
    if (typeof callback !== 'function')
      return Promise.reject(new TypeError('Transaction requires a callback'))
    const current = this.#context.getStore()
    if (current) {
      return Promise.reject(
        new Error(
          current.active
            ? 'Nested transactions are not supported'
            : 'Transaction context is inactive'
        )
      )
    }
    return this.#enqueue(async () => {
      this.#db.exec('BEGIN IMMEDIATE')
      const context = { active: true }
      try {
        const result = await this.#context.run(context, async () =>
          callback(this.#storage(namespace, id, context))
        )
        this.#db.exec('COMMIT')
        return result
      } catch (error) {
        this.#rollback(error)
      } finally {
        context.active = false
      }
    })
  }

  async alarms() {
    return this.#dispatch(() =>
      this.#alarms.all().map((row) => ({
        namespace: decodeText(row.ns),
        id: decodeText(row.id),
        time: row.time
      }))
    )
  }

  async leaseAlarm(namespace, id, expectedTime, nextTime) {
    text(namespace, 'Namespace', false)
    text(id, 'ID', false)
    expectedTime = timestamp(expectedTime)
    nextTime = timestamp(nextTime)
    return this.#dispatch(
      () => this.#leaseAlarm.run(nextTime, namespace, id, expectedTime).changes === 1
    )
  }

  close() {
    if (this.#context.getStore()) {
      return Promise.reject(new Error('Cannot close SQLiteStore from a transaction context'))
    }
    if (this.#closePromise) return this.#closePromise
    this.#closing = true
    this.#closePromise = this.#tail.then(() => {
      this.#db.close()
      this.#closed = true
    })
    this.#tail = this.#closePromise.catch(() => {})
    return this.#closePromise
  }
}
