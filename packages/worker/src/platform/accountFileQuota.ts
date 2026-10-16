import type {
  AccountFileLease,
  AccountSettings,
  FileLeaseIdentity,
  FileOperation,
  ReserveFileInput,
  UserFile
} from './accountTypes'
import { accountError as fail, positive } from './accountSupport'

interface FileEntry {
  externalFileId: string
  bytes: number
  fileName: string
  mimeType: string
  createdAt: number
  updatedAt: number
  complete: boolean
  generation: string
  deleting?: boolean
  lease?: { id: string; kind: string; expiresAt: number }
}

type Files = Record<string, FileEntry>

/** Capacity and operation ownership only; R2 writes/cleanup belong to the upload domain. */
export class AccountFileQuota {
  private readonly key: string

  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: AccountSettings,
    userId: string,
    private readonly now: number
  ) {
    this.key = 'file-quota:' + userId
  }

  async list(): Promise<UserFile[]> {
    return Object.values(await this.readFiles())
      .map(
        (file): UserFile => ({
          fileId: file.externalFileId,
          bytes: file.bytes,
          fileName: file.fileName,
          mimeType: file.mimeType,
          createdAt: file.createdAt,
          updatedAt: file.updatedAt,
          status: file.complete
            ? 'complete'
            : this.now - file.updatedAt > 86400000
              ? 'expired'
              : 'uploading'
        })
      )
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  async reserve(input: ReserveFileInput): Promise<object> {
    const { fileId, bytes, metadata } = input
    const externalFileId = metadata?.externalFileId || fileId
    if (!bytes || bytes > positive(this.env.MAX_FILE_BYTES, 20 * 1024 * 1024)) {
      fail('File is too large', 'FILE_QUOTA', 413)
    }
    const files = await this.readFiles()
    const existing = this.find(files, fileId)
    if (existing?.lease || existing?.deleting) {
      fail('File operation is in progress or unknown; retry deletion', 'FILE_BUSY', 409)
    }
    if (existing && (existing.bytes !== bytes || existing.externalFileId !== externalFileId)) {
      fail('File identity or size changed', 'FILE_CONFLICT', 409)
    }
    if (!existing && Object.keys(files).length >= 50) {
      fail('Account file count limit reached; delete unused files', 'FILE_QUOTA', 413)
    }
    const totalBytes =
      Object.values(files).reduce((total, file) => total + file.bytes, 0) -
      (existing?.bytes || 0) +
      bytes
    if (totalBytes > positive(this.env.MAX_USER_FILE_BYTES, 100 * 1024 * 1024)) {
      fail('Account file quota exceeded; delete unused files', 'FILE_QUOTA', 413)
    }
    files[fileId] = existing
      ? { ...existing, updatedAt: this.now }
      : {
          externalFileId,
          bytes,
          fileName: (metadata?.fileName || externalFileId).slice(0, 255),
          mimeType: (metadata?.mimeType || 'application/octet-stream').slice(0, 128),
          createdAt: this.now,
          updatedAt: this.now,
          complete: false,
          generation: crypto.randomUUID()
        }
    await this.storage.put(this.key, files)
    return {}
  }

  async acquireLease(fileId: string, kind: FileOperation): Promise<AccountFileLease> {
    const files = await this.readFiles()
    const current = this.find(files, fileId)
    if (!current) fail('File reservation not found', 'FILE_NOT_FOUND', 404)
    if (current.deleting && kind !== 'delete') {
      fail('File deletion must finish before re-uploading', 'FILE_DELETING', 409)
    }
    if (current.lease && current.lease.expiresAt > this.now) {
      fail('File operation is in progress; please retry', 'FILE_BUSY', 409)
    }
    if (current.lease && kind !== 'delete') {
      fail(
        'Previous operation expired; delete this upload before retrying',
        'FILE_OPERATION_UNKNOWN',
        409
      )
    }
    if (kind === 'delete') current.deleting = true
    current.lease = { id: crypto.randomUUID(), kind, expiresAt: this.now + 120000 }
    await this.storage.put(this.key, files)
    return {
      leaseId: current.lease.id,
      generation: current.generation,
      expiresAt: current.lease.expiresAt
    }
  }

  async validateLease(
    fileId: string,
    lease: FileLeaseIdentity,
    kind: FileOperation
  ): Promise<object> {
    const current = this.requireLease(await this.readFiles(), fileId, lease)
    if (current.lease!.expiresAt <= this.now || current.lease!.kind !== kind) {
      fail('File operation lease expired', 'FILE_LEASE_EXPIRED', 409)
    }
    return {}
  }

  async endLease(fileId: string, lease: FileLeaseIdentity): Promise<object> {
    const files = await this.readFiles()
    const current = this.requireLease(files, fileId, lease)
    delete current.lease
    // Keep a deletion tombstone until cleanup succeeds, even after its lease ends.
    await this.storage.put(this.key, files)
    return {}
  }

  async complete(fileId: string, lease: FileLeaseIdentity): Promise<object> {
    const files = await this.readFiles()
    const current = this.requireLease(files, fileId, lease)
    if (current.lease!.kind !== 'complete')
      fail('Completion lease is required', 'FILE_LEASE_CHANGED', 409)
    files[fileId] = { ...current, complete: true, updatedAt: this.now }
    await this.storage.put(this.key, files)
    return {}
  }

  async release(fileId: string, lease: FileLeaseIdentity): Promise<object> {
    const files = await this.readFiles()
    const current = this.requireLease(files, fileId, lease)
    if (current.lease!.kind !== 'delete')
      fail('Deletion lease is required', 'FILE_LEASE_CHANGED', 409)
    // Same-generation finalization is allowed after expiry; only validateLease grants fresh R2 writes.
    delete files[fileId]
    await this.storage.put(this.key, files)
    return {}
  }

  private async readFiles(): Promise<Files> {
    return (await this.storage.get<Files>(this.key)) || {}
  }

  private find(files: Files, fileId: string): FileEntry | undefined {
    return Object.hasOwn(files, fileId) ? files[fileId] : undefined
  }

  private requireLease(files: Files, fileId: string, lease: FileLeaseIdentity): FileEntry {
    const current = this.find(files, fileId)
    if (
      !current?.lease ||
      current.lease.id !== lease.leaseId ||
      current.generation !== lease.generation
    ) {
      fail('File operation lease has changed; retry', 'FILE_LEASE_CHANGED', 409)
    }
    return current
  }
}
