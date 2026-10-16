import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const MAGIC = Buffer.from('FBKT0001')
const HEADER_BYTES = 16
const MAX_OBJECT_BYTES = 32 * 1024 * 1024
const MAX_KEY_BYTES = 4096
const MAX_METADATA_BYTES = 64 * 1024
const DEFAULT_STORAGE_BYTES = 1024 * 1024 * 1024
const queues = new Map()

function failure(code, message) {
  return Object.assign(new Error(message), { code })
}

function unsafe() {
  return failure('FILE_BUCKET_UNSAFE_PATH', 'Unsafe bucket filesystem entry')
}

function corrupt() {
  return failure('FILE_BUCKET_CORRUPT', 'Invalid bucket object envelope')
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino
}

function checkFile(stat) {
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
  ) {
    throw unsafe()
  }
}

function hashKey(key) {
  if (typeof key !== 'string') throw new TypeError('Bucket key must be a string')
  if (key.length > MAX_KEY_BYTES || Buffer.byteLength(key) > MAX_KEY_BYTES) {
    throw new RangeError('Bucket key exceeds 4096 UTF-8 bytes')
  }
  // UTF-16 preserves distinct JS strings, including unpaired surrogates.
  return createHash('sha256').update(key, 'utf16le').digest('hex')
}

function record(value) {
  if (value === undefined) return {}
  if (
    value === null ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError('Bucket metadata must be a string-valued record')
  }
  const entries = Object.entries(value)
  if (entries.some(([, item]) => typeof item !== 'string')) {
    throw new TypeError('Bucket metadata values must be strings')
  }
  let rawBytes = 0
  for (const [key, item] of entries) {
    rawBytes += Buffer.byteLength(key) + Buffer.byteLength(item)
    if (rawBytes > MAX_METADATA_BYTES) {
      throw new RangeError('Bucket metadata exceeds 64 KiB')
    }
  }
  return Object.fromEntries(entries)
}

function metadataFor(options = {}) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Bucket put options must be an object')
  }
  return {
    customMetadata: record(options.customMetadata),
    httpMetadata: record(options.httpMetadata)
  }
}

function copyBytes(value, limit) {
  let size
  if (typeof value === 'string') size = Buffer.byteLength(value)
  else if (value instanceof ArrayBuffer || value instanceof Uint8Array) {
    size = value.byteLength
  } else {
    throw new TypeError('Bucket value must be a string, ArrayBuffer or Uint8Array')
  }
  if (size > limit) throw new RangeError('Bucket object exceeds its byte limit')
  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value)
}

function integerOption(value, fallback, upper = Number.MAX_SAFE_INTEGER) {
  const result = value === undefined ? fallback : value
  if (!Number.isSafeInteger(result) || result < 0 || result > upper) {
    throw new RangeError('Invalid bucket byte limit')
  }
  return result
}

async function readExactly(handle, length, position) {
  const bytes = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const { bytesRead } = await handle.read(bytes, offset, length - offset, position + offset)
    if (bytesRead === 0) throw corrupt()
    offset += bytesRead
  }
  return bytes
}

/**
 * Synchronous initialization; use a dedicated, local, service-owned directory.
 * options: maxStorageBytes (1 GiB), maxObjectBytes (at most 32 MiB).
 * Metadata records contain strings, as used by uploads and text retrieval.
 *
 * The budget counts actual envelope/file sizes, including abandoned temp files.
 * An overwrite needs transient disk headroom for one additional envelope.
 * Queues coordinate instances in THIS process; one process must own the root.
 * 0700/0600 protect POSIX storage. On Windows the owner must secure NTFS ACLs.
 * Without native openat/no-follow support, same-user directory replacement
 * races cannot be excluded; filesystem checks are defense in depth, not a
 * sandbox against an attacker with the service's filesystem permissions.
 */
export class FileBucket {
  #root
  #directories
  #queue
  #maxStorageBytes
  #maxObjectBytes

  constructor(root, options = {}) {
    if (typeof root !== 'string' || root.length === 0 || root.includes('\0')) {
      throw new TypeError('Bucket root must be a nonempty directory path')
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Bucket options must be an object')
    }
    this.#maxStorageBytes = integerOption(options.maxStorageBytes, DEFAULT_STORAGE_BYTES)
    this.#maxObjectBytes = integerOption(options.maxObjectBytes, MAX_OBJECT_BYTES, MAX_OBJECT_BYTES)
    this.#root = path.resolve(root)
    const volume = path.parse(this.#root).root
    if (this.#root === volume) throw unsafe()

    try {
      this.#directories = []
      const parts = path.relative(volume, this.#root).split(path.sep)
      let current = volume
      for (const part of ['', ...parts]) {
        if (part) current = path.join(current, part)
        let stat
        try {
          stat = fs.lstatSync(current)
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          fs.mkdirSync(current, { mode: 0o700 })
          stat = fs.lstatSync(current)
        }
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw unsafe()
        this.#directories.push({ directory: current, stat })
      }
      const rootStat = this.#directories.at(-1).stat
      if (process.platform !== 'win32' && rootStat.uid !== process.getuid()) {
        throw unsafe()
      }
      this.#assertDirectories(false)
      fs.chmodSync(this.#root, 0o700)
      this.#assertDirectories()
      this.#usage()
    } catch (error) {
      throw this.#publicError(error)
    }

    const rootStat = this.#directories.at(-1).stat
    const identity = `${rootStat.dev}:${rootStat.ino}`
    if (!queues.has(identity)) queues.set(identity, { tail: Promise.resolve() })
    this.#queue = queues.get(identity)
  }

  #publicError(error) {
    if (
      error.code?.startsWith('FILE_BUCKET_') ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      return error
    }
    // Native filesystem errors contain paths; never leak them to callers.
    return failure(error.code || 'FILE_BUCKET_IO', 'Bucket filesystem operation failed')
  }

  #run(action) {
    const result = this.#queue.tail.then(async () => {
      try {
        this.#assertDirectories()
        return await action()
      } catch (error) {
        throw this.#publicError(error)
      }
    })
    this.#queue.tail = result.catch(() => {})
    return result
  }

  async #syncDirectory() {
    if (process.platform === 'win32') return
    const directory = await fsp.open(this.#root, fs.constants.O_RDONLY)
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  }

  #assertDirectories(requirePrivate = true) {
    for (const { directory, stat } of this.#directories) {
      const current = fs.lstatSync(directory)
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        !sameFile(current, stat) ||
        (directory === this.#root &&
          process.platform !== 'win32' &&
          (current.uid !== process.getuid() || (requirePrivate && (current.mode & 0o077) !== 0)))
      ) {
        throw unsafe()
      }
    }
  }

  #fileStat(filename) {
    this.#assertDirectories()
    try {
      const stat = fs.lstatSync(filename)
      checkFile(stat)
      return stat
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  #usage() {
    this.#assertDirectories()
    let bytes = 0
    for (const name of fs.readdirSync(this.#root)) {
      const stat = this.#fileStat(path.join(this.#root, name))
      if (!stat) continue
      bytes += stat.size
      if (!Number.isSafeInteger(bytes)) throw unsafe()
    }
    return bytes
  }

  async #read(key, hash, withBody) {
    const filename = path.join(this.#root, `${hash}.bucket`)
    const before = this.#fileStat(filename)
    if (!before) return null
    const handle = await fsp.open(
      filename,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
    )
    try {
      this.#assertDirectories()
      const stat = await handle.stat()
      checkFile(stat)
      if (!sameFile(before, stat)) throw unsafe()
      if (stat.size < HEADER_BYTES) throw corrupt()
      const header = await readExactly(handle, HEADER_BYTES, 0)
      const metadataSize = header.readUInt32BE(8)
      const size = header.readUInt32BE(12)
      if (
        !header.subarray(0, 8).equals(MAGIC) ||
        metadataSize > MAX_METADATA_BYTES ||
        size > MAX_OBJECT_BYTES ||
        stat.size !== HEADER_BYTES + metadataSize + size
      ) {
        throw corrupt()
      }
      const encodedMetadata = await readExactly(handle, metadataSize, HEADER_BYTES)
      let metadata
      try {
        const parsed = JSON.parse(encodedMetadata.toString('utf8'))
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          !Object.hasOwn(parsed, 'customMetadata') ||
          !Object.hasOwn(parsed, 'httpMetadata')
        )
          throw corrupt()
        metadata = metadataFor(parsed)
      } catch {
        throw corrupt()
      }
      const bytes = withBody ? await readExactly(handle, size, HEADER_BYTES + metadataSize) : null
      const after = await handle.stat()
      const entry = this.#fileStat(filename)
      if (
        !entry ||
        !sameFile(entry, stat) ||
        after.size !== stat.size ||
        after.mtimeMs !== stat.mtimeMs ||
        after.ctimeMs !== stat.ctimeMs
      ) {
        throw unsafe()
      }
      const object = { key, size, ...metadata }
      if (withBody) {
        object.text = async () => new TextDecoder().decode(bytes)
        object.arrayBuffer = async () => Uint8Array.from(bytes).buffer
        object.json = async () => JSON.parse(new TextDecoder().decode(bytes))
      }
      return object
    } finally {
      await handle.close()
    }
  }

  async get(key) {
    const hash = hashKey(key)
    return this.#run(() => this.#read(key, hash, true))
  }

  async head(key) {
    const hash = hashKey(key)
    return this.#run(() => this.#read(key, hash, false))
  }

  async put(key, value, options) {
    const hash = hashKey(key)
    const bytes = copyBytes(value, this.#maxObjectBytes)
    const metadata = metadataFor(options)
    const encodedMetadata = Buffer.from(JSON.stringify(metadata))
    if (encodedMetadata.length > MAX_METADATA_BYTES) {
      throw new RangeError('Bucket metadata exceeds 64 KiB')
    }
    const header = Buffer.alloc(HEADER_BYTES)
    MAGIC.copy(header)
    header.writeUInt32BE(encodedMetadata.length, 8)
    header.writeUInt32BE(bytes.length, 12)
    const envelope = Buffer.concat([header, encodedMetadata, bytes])

    return this.#run(async () => {
      const filename = path.join(this.#root, `${hash}.bucket`)
      const existing = this.#fileStat(filename)
      if (this.#usage() - (existing?.size ?? 0) + envelope.length > this.#maxStorageBytes) {
        throw failure('FILE_BUCKET_QUOTA', 'Bucket storage quota exceeded')
      }
      const temporary = path.join(this.#root, `.${hash}-${randomUUID()}.tmp`)
      let temporaryStat
      let committed = false
      try {
        this.#assertDirectories()
        const handle = await fsp.open(
          temporary,
          fs.constants.O_WRONLY |
            fs.constants.O_CREAT |
            fs.constants.O_EXCL |
            (fs.constants.O_NOFOLLOW || 0),
          0o600
        )
        try {
          temporaryStat = await handle.stat()
          checkFile(temporaryStat)
          this.#assertDirectories()
          await handle.writeFile(envelope)
          await handle.sync()
        } finally {
          await handle.close()
        }
        const written = this.#fileStat(temporary)
        if (!written || !sameFile(written, temporaryStat) || written.size !== envelope.length) {
          throw unsafe()
        }
        const destination = this.#fileStat(filename)
        if (
          (existing && (!destination || !sameFile(existing, destination))) ||
          (!existing && destination)
        ) {
          throw unsafe()
        }
        await fsp.rename(temporary, filename)
        committed = true
        this.#assertDirectories()
        await this.#syncDirectory()
        return { key, size: bytes.length, ...metadata }
      } finally {
        if (!committed && temporaryStat) {
          // Do not clean up through a replaced directory or remove a foreign inode.
          const leftover = this.#fileStat(temporary)
          if (leftover && sameFile(leftover, temporaryStat)) await fsp.unlink(temporary)
        }
      }
    })
  }

  async delete(keyOrKeys) {
    const keys = Array.isArray(keyOrKeys) ? Array.from(keyOrKeys) : [keyOrKeys]
    const hashes = [...new Set(keys.map(hashKey))]
    return this.#run(async () => {
      const entries = hashes.map((hash) => {
        const filename = path.join(this.#root, `${hash}.bucket`)
        return { filename, stat: this.#fileStat(filename) }
      })
      for (const { filename, stat } of entries) {
        if (!stat) continue
        const current = this.#fileStat(filename)
        if (!current || !sameFile(current, stat)) throw unsafe()
        await fsp.unlink(filename)
      }
      await this.#syncDirectory()
    })
  }
}
