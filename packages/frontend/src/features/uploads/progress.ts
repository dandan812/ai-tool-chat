import type { UploadProgressCallback } from '../../types/task'
import { chunkBytes, type UploadPlan } from './file'

export function createProgressReporter(plan: UploadPlan, onProgress?: UploadProgressCallback) {
  const startTime = Date.now()
  let transferredBytes = 0
  return {
    transferred(index: number) {
      transferredBytes += chunkBytes(plan, index)
    },
    report(indices: Set<number>) {
      const receivedBytes = [...indices].reduce((sum, index) => sum + chunkBytes(plan, index), 0)
      const elapsed = Math.max((Date.now() - startTime) / 1000, 0)
      const speed = elapsed > 0 ? transferredBytes / 1024 / elapsed : 0
      onProgress?.({
        fileId: plan.fileId,
        fileName: plan.file.name,
        uploadedChunks: indices.size,
        totalChunks: plan.totalChunks,
        percentage: (receivedBytes / plan.file.size) * 100,
        speed,
        estimatedTime: speed > 0 ? (plan.file.size - receivedBytes) / 1024 / speed : 0
      })
    }
  }
}
