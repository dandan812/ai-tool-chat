import { WorkerError, type Env } from "../types";
import { logger } from "../infrastructure/logger";
import { hex } from "../platform/accounts";
import { parseChunkRequest, MAX_UPLOAD_CHUNK_BYTES } from "./uploadSchema";
import {
  getUploadedFileChunkObjectKey,
  getUploadedFileObjectKey,
  getUploadedFileTextIndexObjectKey,
} from "./uploadedFileStorage";
import {
  createUploadedFileRef,
  type FileMetadata,
  isUploadExpired,
  repairMetadataFromChunks,
  UPLOAD_TTL_MS,
  assertFileMetadata,
  mergeStoredChunks,
} from "./chunkStorageSupport";

/**
 * 上传状态服务把“状态修复、分片合并、R2 正文操作”集中到一层，
 * Durable Object 本体只负责接 action 和返回响应。
 * 这样既保留了现有上传主链路，又把最难读的存储细节挪出了入口文件。
 */
export class ChunkStorageService {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async handleAction(
    action: string | null,
    request: Request,
    url: URL,
  ): Promise<Response> {
    switch (action) {
      case "storeChunk":
        return this.handleStoreChunk(request);
      case "getMetadata":
        return this.handleGetMetadata(url);
      case "isComplete":
        return this.handleIsComplete(url);
      case "mergeChunks":
        return this.handleMergeChunks(url);
      case "deleteFile":
        return this.handleDeleteFile(url);
      case "cleanup":
        return this.handleCleanup();
      default:
        return new Response("Unknown action", { status: 400 });
    }
  }

  private async handleStoreChunk(request: Request): Promise<Response> {
    const {
      fileId,
      fileName,
      fileSize,
      chunkIndex,
      totalChunks,
      fileHash,
      chunk,
      mimeType,
      chunkSize,
    } = await parseChunkRequest(request, this.env);
    const targetFileId = new URL(request.url).searchParams.get("fileId");
    if (
      (fileId.startsWith("owned-") || targetFileId) &&
      targetFileId !== fileId
    ) {
      throw new WorkerError(
        "Chunk identity does not match its lease target",
        "FILE_LEASE_REQUIRED",
        409,
      );
    }
    const arrayBuffer = await chunk.arrayBuffer();
    const metadataKey = this.getMetadataKey(fileId);
    const currentTime = Date.now();

    let metadata = await this.readMetadata(fileId);
    if (metadata && isUploadExpired(metadata)) {
      await this.deleteFileData(metadata);
      metadata = undefined;
    }

    if (
      metadata &&
      (metadata.fileHash !== fileHash ||
        metadata.totalSize !== fileSize ||
        metadata.totalChunks !== totalChunks ||
        metadata.fileName !== fileName ||
        metadata.mimeType !== mimeType ||
        (metadata.chunkSize !== undefined &&
          chunkSize !== undefined &&
          metadata.chunkSize !== chunkSize))
    ) {
      return this.jsonResponse(
        {
          error: "Upload metadata cannot change during upload",
          code: "UPLOAD_METADATA_CONFLICT",
        },
        409,
      );
    }
    if (metadata?.isMerged) {
      return this.jsonResponse({
        success: true,
        duplicate: true,
        chunkIndex,
        fileId,
        receivedChunks: metadata.receivedChunks,
        receivedIndices: metadata.receivedIndices,
      });
    }

    if (!metadata) {
      metadata = {
        fileId,
        fileName,
        fileHash,
        totalSize: fileSize,
        totalChunks,
        receivedChunks: 0,
        receivedIndices: [],
        mimeType,
        createdAt: currentTime,
        updatedAt: currentTime,
        chunkSize,
      };
      // Persist the deletion manifest before any R2 write, but not an ACK.
      await this.state.storage.put(metadataKey, metadata);
    }
    const chunkObjectKey = this.getChunkObjectKey(fileId, chunkIndex);
    const existingChunk = await this.env.UPLOADED_FILES.head(chunkObjectKey);
    // Reconcile after interruptions, not on every successful sequential write.
    if (
      metadata.receivedBytes === undefined ||
      metadata.receivedIndices.includes(chunkIndex) ||
      existingChunk ||
      (chunkSize !== undefined && metadata.chunkSize === undefined)
    ) {
      metadata = await this.reconcileMetadata(
        metadata,
        chunkSize ?? metadata.chunkSize,
      );
    }
    if (metadata.receivedIndices.includes(chunkIndex)) {
      const stored = await this.env.UPLOADED_FILES.get(chunkObjectKey);
      const bytes = stored ? new Uint8Array(await stored.arrayBuffer()) : null;
      const incoming = new Uint8Array(arrayBuffer);
      if (
        !bytes ||
        bytes.length !== incoming.length ||
        bytes.some((byte, index) => byte !== incoming[index])
      ) {
        throw new WorkerError(
          "Duplicate chunk has different bytes",
          "UPLOAD_CHUNK_CONFLICT",
          409,
        );
      }
      return this.jsonResponse({
        success: true,
        duplicate: true,
        chunkIndex,
        fileId,
        receivedChunks: metadata.receivedChunks,
        receivedIndices: metadata.receivedIndices,
      });
    }
    const receivedBytes =
      (metadata.receivedBytes ?? 0) + arrayBuffer.byteLength;
    if (receivedBytes > metadata.totalSize)
      return this.jsonResponse(
        { error: "Chunks exceed declared file size" },
        413,
      );
    const nextIndices = Array.from(
      new Set([...metadata.receivedIndices, chunkIndex]),
    ).sort((a, b) => a - b);
    const updatedMetadata: FileMetadata = {
      ...metadata,
      receivedBytes,
      receivedChunks: nextIndices.length,
      receivedIndices: nextIndices,
      updatedAt: currentTime,
      chunkSize: chunkSize ?? metadata.chunkSize,
    };
    await this.env.UPLOADED_FILES.put(chunkObjectKey, arrayBuffer, {
      httpMetadata: {
        contentType: "application/octet-stream",
      },
      customMetadata: {
        fileId,
        chunkIndex: String(chunkIndex),
        fileHash,
      },
    });
    // An ACK only follows a successful R2 write. Orphans remain discoverable.
    await this.state.storage.transaction(async (txn) => {
      await txn.put(metadataKey, updatedMetadata);
    });

    return this.jsonResponse({
      success: true,
      chunkIndex,
      fileId,
      receivedChunks: updatedMetadata.receivedChunks,
      receivedIndices: updatedMetadata.receivedIndices,
    });
  }

  private async handleGetMetadata(url: URL): Promise<Response> {
    const fileId = url.searchParams.get("fileId");
    if (!fileId) {
      return this.jsonResponse({ error: "Missing fileId" }, 400);
    }

    let metadata = await this.readMetadata(fileId);
    if (!metadata) {
      return this.jsonResponse({ error: "File not found" }, 404);
    }

    if (isUploadExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ error: "File not found" }, 404);
    }

    const layout = url.searchParams.get("chunkSize");
    let chunkSize = metadata.chunkSize;
    if (layout !== null) {
      const requested = Number(layout);
      if (
        !/^[1-9]\d*$/.test(layout) ||
        !Number.isSafeInteger(requested) ||
        requested > MAX_UPLOAD_CHUNK_BYTES ||
        Math.ceil(metadata.totalSize / requested) !== metadata.totalChunks ||
        (chunkSize !== undefined && chunkSize !== requested)
      ) {
        throw new WorkerError(
          "Upload chunk layout changed",
          "UPLOAD_METADATA_CONFLICT",
          409,
        );
      }
      chunkSize = requested;
    }
    if (!metadata.isMerged)
      metadata = await this.reconcileMetadata(metadata, chunkSize);
    return this.jsonResponse(metadata);
  }

  private async handleIsComplete(url: URL): Promise<Response> {
    const fileId = url.searchParams.get("fileId");
    if (!fileId) {
      return this.jsonResponse({ error: "Missing fileId" }, 400);
    }

    let metadata = await this.readMetadata(fileId);
    if (!metadata) {
      return this.jsonResponse({ isComplete: false }, 404);
    }

    if (isUploadExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ isComplete: false }, 404);
    }

    if (!metadata.isMerged) metadata = await this.reconcileMetadata(metadata);
    return this.jsonResponse({
      isComplete:
        metadata.isMerged || metadata.receivedChunks >= metadata.totalChunks,
    });
  }

  /**
   * 合并前先基于真实分片修正 metadata，
   * 是为了防止前端/旧会话把“已收到的分片数”记错，导致直接在 merge 时炸掉。
   */
  private async handleMergeChunks(url: URL): Promise<Response> {
    const fileId = url.searchParams.get("fileId");
    if (!fileId) {
      return this.jsonResponse({ error: "Missing fileId" }, 400);
    }

    const metadataKey = this.getMetadataKey(fileId);
    const metadata = await this.readMetadata(fileId);
    if (!metadata) {
      return this.jsonResponse({ error: "File not found" }, 404);
    }

    if (isUploadExpired(metadata)) {
      await this.deleteFileData(metadata);
      return this.jsonResponse({ error: "File not found" }, 404);
    }

    if (
      url.searchParams.has("fileHash") &&
      url.searchParams.get("fileHash") !== metadata.fileHash
    ) {
      throw new WorkerError(
        "Upload hash changed",
        "UPLOAD_METADATA_CONFLICT",
        409,
      );
    }
    if (await this.hasUploadedFileObject(fileId)) {
      const recovered = await this.markFileAsMerged(metadata);
      return this.jsonResponse({
        success: true,
        file: createUploadedFileRef(recovered),
      });
    }
    if (metadata.isMerged) {
      throw new WorkerError(
        "Merged file object is missing",
        "FILE_VERSION_MISSING",
        410,
      );
    }

    const chunkEntries = await this.loadStoredChunks(
      fileId,
      metadata.totalChunks,
    );
    for (const entry of chunkEntries) {
      if (entry.chunk)
        this.validateStoredChunkSize(
          metadata,
          entry.index,
          entry.chunk.byteLength,
          metadata.chunkSize,
        );
    }
    const { repairedMetadata, missingIndices } = repairMetadataFromChunks(
      metadata,
      chunkEntries,
    );
    if (repairedMetadata.receivedBytes! > metadata.totalSize) {
      throw new WorkerError(
        "Chunks exceed declared file size",
        "UPLOAD_SIZE_MISMATCH",
        409,
      );
    }
    if (missingIndices.length > 0) {
      await this.state.storage.put(metadataKey, repairedMetadata);

      logger.warn("Missing chunks detected before merge", {
        fileId,
        missingIndices,
        receivedChunks: repairedMetadata.receivedChunks,
        totalChunks: repairedMetadata.totalChunks,
      });

      return this.jsonResponse({
        success: false,
        code: "UPLOAD_INCOMPLETE",
        error: `Incomplete upload: ${repairedMetadata.receivedChunks}/${repairedMetadata.totalChunks} chunks received`,
      });
    }

    const mergedBytes = mergeStoredChunks(
      metadata.totalSize,
      chunkEntries.map((entry) => entry.chunk!),
    );
    const serverContentHash = hex(
      await crypto.subtle.digest("SHA-256", mergedBytes),
    );
    const updatedMetadata: FileMetadata = {
      ...repairedMetadata,
      serverContentHash,
      isMerged: true,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.env.UPLOADED_FILES.put(
      this.getUploadedFileKey(fileId),
      mergedBytes,
      {
        httpMetadata: {
          contentType: metadata.mimeType || "text/plain",
        },
        customMetadata: {
          fileId: metadata.fileId,
          fileName: metadata.fileName,
          fileHash: metadata.fileHash,
          serverContentHash,
        },
      },
    );

    await this.state.storage.transaction(async (txn) => {
      await txn.put(metadataKey, updatedMetadata);
    });
    await this.deleteChunkObjects(fileId, metadata.totalChunks);

    return this.jsonResponse({
      success: true,
      file: createUploadedFileRef(updatedMetadata),
    });
  }

  private async handleDeleteFile(url: URL): Promise<Response> {
    const fileId = url.searchParams.get("fileId");
    if (!fileId) {
      return this.jsonResponse({ error: "Missing fileId" }, 400);
    }

    const metadata = await this.readMetadata(fileId);
    if (metadata) {
      await this.deleteFileData(metadata);
    }

    return this.jsonResponse({ success: true });
  }

  private async handleCleanup(): Promise<Response> {
    const files = await this.state.storage.list<FileMetadata>({
      prefix: "meta:",
    });
    const currentTime = Date.now();
    const expiredFiles: FileMetadata[] = [];

    for (const [key, metadata] of files) {
      assertFileMetadata(metadata, key.slice("meta:".length));
      const lastUpdatedAt = metadata.updatedAt || metadata.createdAt;
      if (!metadata.isMerged && currentTime - lastUpdatedAt > UPLOAD_TTL_MS) {
        expiredFiles.push(metadata);
      }
    }

    for (const metadata of expiredFiles) {
      await this.deleteFileData(metadata);
    }

    return this.jsonResponse({ deletedCount: expiredFiles.length });
  }

  private getMetadataKey(fileId: string): string {
    return `meta:${fileId}`;
  }

  private getUploadedFileKey(fileId: string): string {
    return getUploadedFileObjectKey(fileId);
  }

  private async deleteFileData(metadata: FileMetadata): Promise<void> {
    // Keep the deletion manifest until every R2 operation succeeds, so a retry
    // can still find partially deleted objects without releasing their quota.
    await this.deleteChunkObjects(metadata.fileId, metadata.totalChunks);
    await this.env.UPLOADED_FILES.delete(
      this.getUploadedFileKey(metadata.fileId),
    );
    await this.env.UPLOADED_FILES.delete(
      getUploadedFileTextIndexObjectKey(metadata.fileId),
    );
    await this.state.storage.transaction(async (txn) => {
      await txn.delete(this.getMetadataKey(metadata.fileId));
    });
  }

  private async readMetadata(
    fileId: string,
  ): Promise<FileMetadata | undefined> {
    const value = await this.state.storage.get<unknown>(
      this.getMetadataKey(fileId),
    );
    if (value === undefined) return undefined;
    assertFileMetadata(value, fileId);
    return value;
  }

  private validateStoredChunkSize(
    metadata: FileMetadata,
    index: number,
    bytes: number,
    chunkSize?: number,
  ): void {
    if (
      bytes < 1 ||
      bytes > MAX_UPLOAD_CHUNK_BYTES ||
      bytes > metadata.totalSize ||
      (chunkSize !== undefined &&
        bytes !== Math.min(chunkSize, metadata.totalSize - index * chunkSize))
    ) {
      throw new WorkerError(
        "Stored chunk size does not match upload layout",
        "UPLOAD_SIZE_MISMATCH",
        409,
      );
    }
  }

  private async reconcileMetadata(
    metadata: FileMetadata,
    chunkSize = metadata.chunkSize,
  ): Promise<FileMetadata> {
    const receivedIndices: number[] = [];
    let receivedBytes = 0;
    for (let index = 0; index < metadata.totalChunks; index++) {
      const key = this.getChunkObjectKey(metadata.fileId, index);
      const object = await this.env.UPLOADED_FILES.head(key);
      if (!object) continue;
      // Real R2 heads include size; memory test buckets may only expose a key.
      let size: number | undefined = object.size;
      if (size === undefined) {
        const body = await this.env.UPLOADED_FILES.get(key);
        size = body ? (await body.arrayBuffer()).byteLength : undefined;
      }
      if (size === undefined) continue;
      this.validateStoredChunkSize(metadata, index, size, chunkSize);
      receivedIndices.push(index);
      receivedBytes += size;
    }
    if (receivedBytes > metadata.totalSize) {
      throw new WorkerError(
        "Chunks exceed declared file size",
        "UPLOAD_SIZE_MISMATCH",
        409,
      );
    }
    const repaired = {
      ...metadata,
      receivedIndices,
      receivedChunks: receivedIndices.length,
      receivedBytes,
    };
    if (
      receivedBytes !== metadata.receivedBytes ||
      receivedIndices.join(",") !== metadata.receivedIndices.join(",")
    ) {
      await this.state.storage.put(
        this.getMetadataKey(metadata.fileId),
        repaired,
      );
    }
    return repaired;
  }

  private async hasUploadedFileObject(fileId: string): Promise<boolean> {
    const object = await this.env.UPLOADED_FILES.head(
      this.getUploadedFileKey(fileId),
    );
    return object !== null;
  }

  private async markFileAsMerged(
    metadata: FileMetadata,
  ): Promise<FileMetadata> {
    const object = await this.env.UPLOADED_FILES.get(
      this.getUploadedFileKey(metadata.fileId),
    );
    const serverContentHash = object?.customMetadata?.serverContentHash;
    if (!serverContentHash || !/^[a-f0-9]{64}$/.test(serverContentHash)) {
      throw new WorkerError(
        "File has no verified version",
        "FILE_VERSION_MISSING",
        410,
      );
    }
    const size = object.size ?? (await object.arrayBuffer()).byteLength;
    if (
      size !== metadata.totalSize ||
      object.customMetadata?.fileId !== metadata.fileId ||
      object.customMetadata?.fileHash !== metadata.fileHash ||
      (metadata.serverContentHash !== undefined &&
        metadata.serverContentHash !== serverContentHash)
    ) {
      throw new WorkerError(
        "Merged object does not match upload metadata",
        "UPLOAD_METADATA_INVALID",
        409,
      );
    }
    const updatedMetadata: FileMetadata = {
      ...metadata,
      isMerged: true,
      serverContentHash,
      receivedChunks: metadata.totalChunks,
      receivedIndices: Array.from(
        { length: metadata.totalChunks },
        (_, index) => index,
      ),
      receivedBytes: metadata.totalSize,
      completedAt: metadata.completedAt || Date.now(),
      updatedAt: Date.now(),
    };

    await this.state.storage.transaction(async (txn) => {
      await txn.put(this.getMetadataKey(metadata.fileId), updatedMetadata);
    });
    await this.deleteChunkObjects(metadata.fileId, metadata.totalChunks);
    return updatedMetadata;
  }

  private async loadStoredChunks(
    fileId: string,
    totalChunks: number,
  ): Promise<Array<{ index: number; chunk: ArrayBuffer | null }>> {
    const entries: Array<{ index: number; chunk: ArrayBuffer | null }> = [];

    for (let index = 0; index < totalChunks; index++) {
      const chunkObject = await this.env.UPLOADED_FILES.get(
        this.getChunkObjectKey(fileId, index),
      );
      const chunk = chunkObject ? await chunkObject.arrayBuffer() : null;
      entries.push({
        index,
        chunk: chunk ?? null,
      });
    }

    return entries;
  }

  private getChunkObjectKey(fileId: string, chunkIndex: number): string {
    return getUploadedFileChunkObjectKey(fileId, chunkIndex);
  }

  private async deleteChunkObjects(
    fileId: string,
    totalChunks: number,
  ): Promise<void> {
    for (let index = 0; index < totalChunks; index++) {
      await this.env.UPLOADED_FILES.delete(
        this.getChunkObjectKey(fileId, index),
      );
    }
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
