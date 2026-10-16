import { logger } from '../infrastructure/logger'
import { WorkerError, type Env } from '../types'
import { acquireFileLease, endFileLease, type FileLease } from './ownedFiles'

export async function withFileLease<T>(
  env: Env,
  userId: string,
  fileId: string,
  kind: 'upload' | 'complete' | 'delete',
  operation: (lease: FileLease) => Promise<T>
): Promise<T> {
  const lease = await acquireFileLease(env, userId, fileId, kind)
  async function closeLease() {
    try {
      await endFileLease(env, userId, fileId, lease)
    } catch (error) {
      // Delete releases the reservation; stale cleanup cannot end a new lease.
      if (!(error instanceof WorkerError && error.code === 'FILE_LEASE_CHANGED')) throw error
    }
  }
  let result: T
  try {
    result = await operation(lease)
  } catch (error) {
    try {
      await closeLease()
    } catch (cleanupError) {
      logger.error('Could not close failed upload lease', {
        fileId,
        kind,
        error: cleanupError
      })
    }
    throw error
  }
  await closeLease()
  return result
}
