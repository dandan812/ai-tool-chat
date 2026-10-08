/**
 * ChunkStorage Durable Object - 持久化分片存储
 *
 * 说明：
 * - 每个 fileId 对应一个 Durable Object 实例
 * - 分片写入必须幂等，避免重复上传导致计数错误
 * - 上传完成后，合并后的文件正文写入 R2，DO 只保留元数据和完成标记
 * - 断点续传依赖 metadata 中的 receivedIndices 恢复缺失分片
 */
import type { Env } from "../types";
import { WorkerError } from "../types";
import { accountRPC } from "../platform/accounts";
import { logger } from "../infrastructure/logger";
import { ChunkStorageService } from "./chunkStorageService";

export class ChunkStorage implements DurableObject {
  private readonly service: ChunkStorageService;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private state: DurableObjectState,
    private env: Env,
  ) {
    this.service = new ChunkStorageService(state, env);
  }

  fetch(request: Request): Promise<Response> {
    // Includes remote R2 awaits: a delete cannot overtake a pending write.
    const next = this.queue.then(() => this.execute(request));
    this.queue = next.catch(() => undefined);
    return next;
  }
  private async execute(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.searchParams.get("action");

    logger.debug("ChunkStorage fetch", { action, url: url.href });

    try {
      const fileId = url.searchParams.get("fileId");
      const kind =
        action === "storeChunk"
          ? "upload"
          : action === "mergeChunks"
            ? "complete"
            : action === "deleteFile"
              ? "delete"
              : undefined;
      if (fileId?.startsWith("owned-") && kind) {
        if (request.headers.get("X-File-Id") !== fileId)
          throw new WorkerError(
            "File lease is required",
            "FILE_LEASE_REQUIRED",
            409,
          );
        await accountRPC(this.env, "validate-file-lease", {
          userId: request.headers.get("X-File-User"),
          fileId,
          leaseId: request.headers.get("X-File-Lease"),
          generation: request.headers.get("X-File-Generation"),
          kind,
        });
      }
      return await this.service.handleAction(action, request, url);
    } catch (error) {
      logger.error("ChunkStorage error", { action, error });
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
          code:
            error instanceof WorkerError ? error.code : "UPLOAD_STORAGE_FAILED",
        }),
        {
          status: error instanceof WorkerError ? error.statusCode : 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }
}
