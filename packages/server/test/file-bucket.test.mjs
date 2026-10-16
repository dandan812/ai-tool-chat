import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { FileBucket } from '../src/file-bucket.mjs'

async function fixture(t) {
  const sandbox = await fsp.mkdtemp(path.join(os.tmpdir(), 'file-bucket-test-'))
  t.after(async () => {
    const absolute = path.resolve(sandbox)
    assert.equal(path.dirname(absolute), path.resolve(os.tmpdir()))
    assert.ok(path.basename(absolute).startsWith('file-bucket-test-'))
    await fsp.rm(absolute, { recursive: true, force: true })
  })
  const root = path.join(sandbox, 'bucket')
  return { sandbox, root, bucket: new FileBucket(root) }
}

function filename(root, key) {
  const hash = createHash('sha256').update(key, 'utf16le').digest('hex')
  return path.join(root, `${hash}.bucket`)
}

async function diskBytes(root) {
  const files = await fsp.readdir(root)
  const stats = await Promise.all(files.map((name) => fsp.lstat(path.join(root, name))))
  return stats.reduce((total, stat) => total + stat.size, 0)
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function directoryLink(target, link) {
  await fsp.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
}

const isUnsafe = { code: 'FILE_BUCKET_UNSAFE_PATH' }
const isQuota = { code: 'FILE_BUCKET_QUOTA' }

test('binary roundtrip preserves ArrayBuffer and typed-array/Buffer offsets', async (t) => {
  const { bucket } = await fixture(t)
  const original = new Uint8Array([99, 0, 128, 255, 42, 88])
  const view = original.subarray(1, 5)
  const write = bucket.put('uploaded-file-chunks/file/0', view)
  original.fill(7)
  await write
  const object = await bucket.get('uploaded-file-chunks/file/0')
  assert.equal(object.size, 4)
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()), new Uint8Array([0, 128, 255, 42]))
  const copy = new Uint8Array(await object.arrayBuffer())
  copy.fill(0)
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()), new Uint8Array([0, 128, 255, 42]))
  await bucket.put('array-buffer', Uint8Array.from([1, 2, 3]).buffer)
  assert.deepEqual(
    new Uint8Array(await (await bucket.get('array-buffer')).arrayBuffer()),
    Uint8Array.from([1, 2, 3])
  )
  await bucket.put('buffer-view', Buffer.from([9, 4, 5, 8]).subarray(1, 3))
  assert.deepEqual(
    new Uint8Array(await (await bucket.get('buffer-view')).arrayBuffer()),
    Uint8Array.from([4, 5])
  )
})

test('UTF-8 strings, JSON and business metadata roundtrip through get/head', async (t) => {
  const { bucket } = await fixture(t)
  const key = 'uploaded-file-indices/file.json'
  const text = JSON.stringify({ content: '\u4e2d\u6587 \ud83d\ude80', chunks: [] })
  const options = {
    customMetadata: { fileId: 'file', fileName: 'notes.txt', serverContentHash: 'a'.repeat(64) },
    httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' }
  }
  const put = bucket.put(key, text, options)
  options.customMetadata.fileId = 'mutated'
  await put
  const head = await bucket.head(key)
  assert.deepEqual(head, {
    key,
    size: Buffer.byteLength(text),
    customMetadata: { ...options.customMetadata, fileId: 'file' },
    httpMetadata: options.httpMetadata
  })
  assert.equal(head.arrayBuffer, undefined)
  const object = await bucket.get(key)
  assert.equal(await object.text(), text)
  assert.deepEqual(await object.json(), JSON.parse(text))
  object.customMetadata.fileId = 'changed'
  assert.equal((await bucket.get(key)).customMetadata.fileId, 'file')
  assert.deepEqual(
    Object.keys(object).sort(),
    ['key', 'size', 'customMetadata', 'httpMetadata', 'text', 'arrayBuffer', 'json'].sort()
  )
})

test('missing objects are null; empty objects and repeated/batch deletes work', async (t) => {
  const { bucket } = await fixture(t)
  assert.equal(await bucket.get('missing'), null)
  assert.equal(await bucket.head('missing'), null)
  await bucket.delete('missing')
  await bucket.put('', '')
  await bucket.put('other', 'data')
  const empty = await bucket.get('')
  assert.equal(empty.size, 0)
  assert.equal(await empty.text(), '')
  assert.equal((await empty.arrayBuffer()).byteLength, 0)
  await bucket.delete(['', 'other', 'missing', 'other'])
  assert.equal(await bucket.head(''), null)
  assert.equal(await bucket.get('other'), null)
})

test('key/value/options limits reject invalid input before changing storage', async (t) => {
  const { root, bucket } = await fixture(t)
  for (const key of [null, undefined, 12, {}, ['key'], new String('key')]) {
    await assert.rejects(bucket.get(key), TypeError)
    await assert.rejects(bucket.head(key), TypeError)
    await assert.rejects(bucket.put(key, 'value'), TypeError)
  }
  for (const key of [null, undefined, 12, {}, new String('key')]) {
    await assert.rejects(bucket.delete(key), TypeError)
  }
  for (const key of ['x'.repeat(4097), '\u4e2d'.repeat(1366)]) {
    await assert.rejects(bucket.put(key, ''), RangeError)
    await assert.rejects(bucket.get(key), RangeError)
    await assert.rejects(bucket.head(key), RangeError)
    await assert.rejects(bucket.delete(key), RangeError)
  }
  for (const value of [null, {}, new DataView(new ArrayBuffer(4)), new Uint16Array(4)]) {
    await assert.rejects(bucket.put('bad', value), TypeError)
  }
  await bucket.put('keep', 'old')
  await assert.rejects(bucket.delete(['keep', null]), TypeError)
  assert.equal(await (await bucket.get('keep')).text(), 'old')
  await assert.rejects(bucket.put('bad', 'x', { customMetadata: { n: 1 } }), TypeError)
  await assert.rejects(bucket.put('bad', 'x', { httpMetadata: [] }), TypeError)
  await assert.rejects(bucket.put('bad', 'x', null), TypeError)
  await assert.rejects(
    bucket.put('keep', 'new', { customMetadata: { huge: 'x'.repeat(65536) } }),
    RangeError
  )
  assert.equal(await (await bucket.get('keep')).text(), 'old')
  assert.equal((await fsp.readdir(root)).length, 1)
})

test('32 MiB hard cap and configured cap use byte sizes, not character counts', async (t) => {
  const { root, bucket } = await fixture(t)
  await assert.rejects(bucket.put('huge', new Uint8Array(32 * 1024 * 1024 + 1)), RangeError)
  await bucket.put('at-limit', new Uint8Array(32 * 1024 * 1024))
  assert.equal((await bucket.head('at-limit')).size, 32 * 1024 * 1024)
  await bucket.delete('at-limit')
  assert.throws(() => new FileBucket(root, { maxObjectBytes: 32 * 1024 * 1024 + 1 }), RangeError)
  const small = new FileBucket(root, { maxObjectBytes: 4 })
  await small.put('exact', Uint8Array.from([1, 2, 3, 4]))
  await assert.rejects(small.put('exact', '\u4e2d\u6587'), RangeError)
  assert.equal((await small.head('exact')).size, 4)
  for (const maxStorageBytes of [-1, 1.2, NaN, Infinity, '100']) {
    assert.throws(() => new FileBucket(root, { maxStorageBytes }), RangeError)
  }
})

test('overwrite publishes one envelope and existing get objects remain snapshots', async (t) => {
  const { root, bucket } = await fixture(t)
  await bucket.put('key', 'old', { customMetadata: { version: 'old' } })
  const old = await bucket.get('key')
  await bucket.put('key', 'new and longer', { customMetadata: { version: 'new' } })
  const current = await bucket.get('key')
  assert.equal(await current.text(), 'new and longer')
  assert.equal(current.customMetadata.version, 'new')
  assert.equal(await old.text(), 'old')
  assert.equal(old.customMetadata.version, 'old')
  assert.equal((await fsp.readdir(root)).length, 1)
  await bucket.delete('key')
  assert.equal(await current.text(), 'new and longer')
  assert.equal(await old.text(), 'old')
})

test('old file remains intact until atomic rename; queued readers see new snapshot', async (t) => {
  const { root, bucket } = await fixture(t)
  await bucket.put('key', 'old', { customMetadata: { v: 'old' } })
  const original = await fsp.readFile(filename(root, 'key'))
  const rename = fsp.rename
  const entered = deferred()
  const release = deferred()
  t.mock.method(fsp, 'rename', async (...args) => {
    entered.resolve()
    await release.promise
    return rename(...args)
  })
  const overwrite = bucket.put('key', 'new', { customMetadata: { v: 'new' } })
  try {
    await entered.promise
    assert.deepEqual(await fsp.readFile(filename(root, 'key')), original)
    const pendingRead = bucket.get('key')
    release.resolve()
    await overwrite
    const object = await pendingRead
    assert.equal(await object.text(), 'new')
    assert.equal(object.customMetadata.v, 'new')
    assert.equal((await fsp.readdir(root)).length, 1)
  } finally {
    release.resolve()
    await overwrite
  }
})

test('failed rename preserves old data/metadata, removes temp and does not poison queue', async (t) => {
  const { root, bucket } = await fixture(t)
  await bucket.put('key', 'old', { httpMetadata: { contentType: 'text/plain' } })
  const oldBytes = await diskBytes(root)
  const injected = t.mock.method(fsp, 'rename', async () => {
    throw Object.assign(new Error(`injected failure at ${root}`), { code: 'EIO' })
  })
  await assert.rejects(bucket.put('key', 'new'), (error) => {
    assert.equal(error.code, 'EIO')
    assert.ok(!error.message.includes(root))
    return true
  })
  injected.mock.restore()
  const object = await bucket.get('key')
  assert.equal(await object.text(), 'old')
  assert.equal(object.httpMetadata.contentType, 'text/plain')
  assert.equal(await diskBytes(root), oldBytes)
  assert.equal((await fsp.readdir(root)).length, 1)
  await bucket.put('key', 'recovered')
  assert.equal(await (await bucket.get('key')).text(), 'recovered')
})

test('partial temp write failure never publishes incomplete bytes or metadata', async (t) => {
  const { root, bucket } = await fixture(t)
  await bucket.put('key', 'old', { customMetadata: { version: 'old' } })
  const original = await fsp.readFile(filename(root, 'key'))
  const open = fsp.open
  const injected = t.mock.method(fsp, 'open', async (...args) => {
    const handle = await open(...args)
    if (args[0].endsWith('.tmp')) {
      t.mock.method(handle, 'writeFile', async (bytes) => {
        await handle.write(bytes.subarray(0, 12))
        throw Object.assign(new Error('injected partial write'), { code: 'ENOSPC' })
      })
    }
    return handle
  })
  await assert.rejects(bucket.put('key', 'new', { customMetadata: { version: 'new' } }), {
    code: 'ENOSPC'
  })
  injected.mock.restore()
  assert.deepEqual(await fsp.readFile(filename(root, 'key')), original)
  assert.equal((await fsp.readdir(root)).length, 1)
  const object = await bucket.get('key')
  assert.equal(await object.text(), 'old')
  assert.equal(object.customMetadata.version, 'old')
  await bucket.put('key', 'recovered')
})

test('concurrent puts, reads and deletes are ordered, including across instances', async (t) => {
  const { root, bucket } = await fixture(t)
  const other = new FileBucket(root)
  const operations = []
  for (let index = 0; index < 24; index++) {
    const instance = index % 2 ? bucket : other
    const body = String(index).repeat(index + 1)
    operations.push(instance.put('shared', body, { customMetadata: { index: String(index) } }))
    operations.push(
      other.get('shared').then(async (object) => {
        assert.equal(await object.text(), body)
        assert.equal(object.size, Buffer.byteLength(body))
        assert.equal(object.customMetadata.index, String(index))
      })
    )
    operations.push(instance.delete('shared'))
    operations.push(bucket.head('shared').then((object) => assert.equal(object, null)))
  }
  await Promise.all(operations)
  assert.equal(await bucket.get('shared'), null)
  assert.deepEqual(await fsp.readdir(root), [])
})

test('restart preserves binary payload, metadata and size accounting', async (t) => {
  const { root, bucket } = await fixture(t)
  await bucket.put('persisted', Uint8Array.from([0, 12, 255]), {
    customMetadata: { fileId: 'persistent' },
    httpMetadata: { contentType: 'application/octet-stream' }
  })
  const actual = await diskBytes(root)
  const script = `
    const { FileBucket } = await import(process.argv[1]);
    const bucket = new FileBucket(process.argv[2], {
      maxStorageBytes: Number(process.argv[3]),
    });
    const object = await bucket.get("persisted");
    let quotaCode;
    try { await bucket.put("new", ""); } catch (error) { quotaCode = error.code; }
    console.log(JSON.stringify({
      bytes: Array.from(new Uint8Array(await object.arrayBuffer())),
      customMetadata: object.customMetadata,
      httpMetadata: object.httpMetadata,
      quotaCode,
    }));
  `
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      script,
      new URL('../src/file-bucket.mjs', import.meta.url).href,
      root,
      String(actual)
    ],
    { timeout: 10000, maxBuffer: 8192 }
  )
  assert.equal(stderr, '')
  assert.deepEqual(JSON.parse(stdout), {
    bytes: [0, 12, 255],
    customMetadata: { fileId: 'persistent' },
    httpMetadata: { contentType: 'application/octet-stream' },
    quotaCode: 'FILE_BUCKET_QUOTA'
  })
  const restarted = new FileBucket(root, { maxStorageBytes: actual })
  const object = await restarted.get('persisted')
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()), Uint8Array.from([0, 12, 255]))
  assert.equal(object.customMetadata.fileId, 'persistent')
  assert.equal(object.httpMetadata.contentType, 'application/octet-stream')
  await assert.rejects(restarted.put('new', ''), isQuota)
  await restarted.delete('persisted')
  await restarted.put('new', '')
  assert.ok((await diskBytes(root)) <= actual)
})

test('quota counts physical envelopes and credits overwrite/deletion without drift', async (t) => {
  const { root, bucket } = await fixture(t)
  await bucket.put('old', 'x'.repeat(100))
  const actual = await diskBytes(root)
  assert.ok(actual > 100)
  const limited = new FileBucket(root, { maxStorageBytes: actual })
  await assert.rejects(limited.put('old', 'x'.repeat(101)), isQuota)
  await limited.put('old', 'y'.repeat(100))
  assert.equal(await diskBytes(root), actual)
  await assert.rejects(limited.put('other', ''), isQuota)
  await limited.put('old', 'small')
  assert.equal(await diskBytes(root), actual - 95)
  await limited.put('other', '')
  assert.ok((await diskBytes(root)) <= actual)
  await limited.delete(['old', 'other', 'other'])
  assert.equal(await diskBytes(root), 0)
  await limited.put('replacement', 'z'.repeat(100))
  assert.equal(await diskBytes(root), actual)
  await assert.rejects(
    limited.put('replacement', 'z'.repeat(100), {
      customMetadata: { extra: 'metadata consumes quota too' }
    }),
    isQuota
  )
})

test('concurrent writes to different keys cannot exceed a shared global quota', async (t) => {
  const { root, bucket } = await fixture(t)
  await bucket.put('seed', 'payload')
  const size = await diskBytes(root)
  await bucket.delete('seed')
  const left = new FileBucket(root, { maxStorageBytes: size })
  const right = new FileBucket(root, { maxStorageBytes: size })
  const results = await Promise.allSettled([
    left.put('left', 'payload'),
    right.put('right', 'payload')
  ])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(
    results.find((result) => result.status === 'rejected').reason.code,
    'FILE_BUCKET_QUOTA'
  )
  assert.equal(await diskBytes(root), size)
  await left.delete(['left', 'right'])
  await right.put('again', 'payload')
})

test('abandoned temp files and actual external file growth consume storage quota', async (t) => {
  const { root, bucket } = await fixture(t)
  await bucket.put('key', 'data')
  const size = await diskBytes(root)
  const limited = new FileBucket(root, { maxStorageBytes: size })
  const abandoned = path.join(root, '.abandoned.tmp')
  await fsp.writeFile(abandoned, Buffer.alloc(1), { mode: 0o600 })
  await assert.rejects(limited.put('key', 'data'), isQuota)
  await fsp.unlink(abandoned)
  await limited.put('key', 'data')
  await fsp.appendFile(filename(root, 'key'), Buffer.alloc(100))
  await assert.rejects(limited.put('new', ''), isQuota)
  await limited.delete('key')
  await limited.put('new', '')
})

test('traversal, absolute, NUL and ill-formed Unicode keys are only hash inputs', async (t) => {
  const { sandbox, root, bucket } = await fixture(t)
  const sentinel = path.join(sandbox, 'outside.txt')
  await fsp.writeFile(sentinel, 'untouched')
  const keys = [
    '../outside.txt',
    '../../escape',
    '/absolute',
    'C:\\absolute\\file',
    '\\\\server\\share\\file',
    'a/../../b',
    'a\0b',
    '\ud800',
    '\ud801'
  ]
  for (const [index, key] of keys.entries()) await bucket.put(key, String(index))
  for (const [index, key] of keys.entries()) {
    assert.equal(await (await bucket.get(key)).text(), String(index))
  }
  assert.equal(await fsp.readFile(sentinel, 'utf8'), 'untouched')
  const names = await fsp.readdir(root)
  assert.equal(names.length, keys.length)
  assert.ok(names.every((name) => /^[a-f0-9]{64}\.bucket$/.test(name)))
  assert.deepEqual((await fsp.readdir(sandbox)).sort(), ['bucket', 'outside.txt'])
})

test(
  'POSIX bucket directories/files have private modes',
  {
    skip:
      process.platform === 'win32'
        ? 'Windows requires service-owned NTFS ACLs, not POSIX modes'
        : false
  },
  async (t) => {
    const { sandbox } = await fixture(t)
    const root = path.join(sandbox, 'nested', 'bucket')
    const bucket = new FileBucket(root)
    await bucket.put('key', 'private')
    assert.equal((await fsp.stat(path.dirname(root))).mode & 0o777, 0o700)
    assert.equal((await fsp.stat(root)).mode & 0o777, 0o700)
    assert.equal((await fsp.stat(filename(root, 'key'))).mode & 0o777, 0o600)
    await fsp.chmod(root, 0o777)
    await assert.rejects(bucket.put('key', 'unsafe'), isUnsafe)
    await assert.rejects(bucket.get('key'), isUnsafe)
    await assert.rejects(bucket.delete('key'), isUnsafe)
    await fsp.chmod(root, 0o700)
  }
)

test('object file symlinks are never read, overwritten or deleted', async (t) => {
  const { sandbox, root, bucket } = await fixture(t)
  const outside = path.join(sandbox, 'outside.txt')
  await fsp.writeFile(outside, 'secret')
  try {
    await fsp.symlink(outside, filename(root, 'link'), 'file')
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Windows denied creation of file symlinks; directory junctions are tested separately')
      return
    }
    throw error
  }
  await assert.rejects(bucket.get('link'), isUnsafe)
  await assert.rejects(bucket.head('link'), isUnsafe)
  await assert.rejects(bucket.put('link', 'overwrite'), isUnsafe)
  await assert.rejects(bucket.delete('link'), isUnsafe)
  assert.throws(() => new FileBucket(root), isUnsafe)
  assert.equal(await fsp.readFile(outside, 'utf8'), 'secret')
  assert.ok((await fsp.lstat(filename(root, 'link'))).isSymbolicLink())
})

test('root and ancestor symlinks/junctions are refused before writing outside', async (t) => {
  const { sandbox, root, bucket } = await fixture(t)
  const outside = path.join(sandbox, 'outside')
  await fsp.mkdir(outside)
  const linkedRoot = path.join(sandbox, 'linked-root')
  await directoryLink(outside, linkedRoot)
  assert.throws(() => new FileBucket(linkedRoot), isUnsafe)
  assert.throws(() => new FileBucket(path.join(linkedRoot, 'new-bucket')), isUnsafe)
  await fsp.rename(root, path.join(sandbox, 'original-bucket'))
  await directoryLink(outside, root)
  await assert.rejects(bucket.get('key'), isUnsafe)
  await assert.rejects(bucket.head('key'), isUnsafe)
  await assert.rejects(bucket.put('key', 'escape'), isUnsafe)
  await assert.rejects(bucket.delete('key'), isUnsafe)
  assert.deepEqual(await fsp.readdir(outside), [])
})

test('object-name directory junction cannot redirect reads/writes/delete', async (t) => {
  const { sandbox, root, bucket } = await fixture(t)
  const outside = path.join(sandbox, 'outside')
  await fsp.mkdir(outside)
  await fsp.writeFile(path.join(outside, 'secret'), 'untouched')
  await directoryLink(outside, filename(root, 'key'))
  await assert.rejects(bucket.get('key'), isUnsafe)
  await assert.rejects(bucket.head('key'), isUnsafe)
  await assert.rejects(bucket.put('key', 'escape'), isUnsafe)
  await assert.rejects(bucket.delete('key'), isUnsafe)
  assert.equal(await fsp.readFile(path.join(outside, 'secret'), 'utf8'), 'untouched')
})

test('hardlinked object files cannot read or mutate a file outside the bucket', async (t) => {
  const { sandbox, root, bucket } = await fixture(t)
  await bucket.put('key', 'private')
  const outside = path.join(sandbox, 'outside.bucket')
  await fsp.link(filename(root, 'key'), outside)
  await assert.rejects(bucket.get('key'), isUnsafe)
  await assert.rejects(bucket.head('key'), isUnsafe)
  await assert.rejects(bucket.put('key', 'changed'), isUnsafe)
  await assert.rejects(bucket.delete('key'), isUnsafe)
  assert.throws(() => new FileBucket(root), isUnsafe)
})

test('replacing an ancestor with a regular directory invalidates the existing bucket', async (t) => {
  const { sandbox } = await fixture(t)
  const parent = path.join(sandbox, 'parent')
  const root = path.join(parent, 'bucket')
  const bucket = new FileBucket(root)
  await bucket.put('key', 'original')
  await fsp.rename(parent, path.join(sandbox, 'saved-parent'))
  await fsp.mkdir(root, { recursive: true })
  await assert.rejects(bucket.put('key', 'replacement'), isUnsafe)
  assert.deepEqual(await fsp.readdir(root), [])
})

test('directories and corrupt/bounded envelope headers fail closed', async (t) => {
  const { root, bucket } = await fixture(t)
  await fsp.mkdir(filename(root, 'directory'))
  await assert.rejects(bucket.get('directory'), isUnsafe)
  await assert.rejects(bucket.put('directory', 'x'), isUnsafe)
  await assert.rejects(bucket.delete('directory'), isUnsafe)
  await fsp.rmdir(filename(root, 'directory'))
  await bucket.put('key', 'valid')
  const original = await fsp.readFile(filename(root, 'key'))
  const mutations = [
    original.subarray(0, 10),
    Buffer.concat([original, Buffer.from('extra')]),
    Buffer.from(original),
    Buffer.from(original),
    Buffer.from(original)
  ]
  mutations[2].writeUInt32BE(0xffffffff, 8)
  mutations[3].writeUInt32BE(0xffffffff, 12)
  mutations[4].fill(0, 0, 8)
  for (const bytes of mutations) {
    await fsp.writeFile(filename(root, 'key'), bytes)
    await assert.rejects(bucket.get('key'), { code: 'FILE_BUCKET_CORRUPT' })
    await assert.rejects(bucket.head('key'), { code: 'FILE_BUCKET_CORRUPT' })
  }
  await bucket.put('key', 'repaired')
  assert.equal(await (await bucket.get('key')).text(), 'repaired')
})
