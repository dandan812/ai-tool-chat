import { WorkerError, type Env, type UploadedFileRef } from "../types";
import {
  ownedFileId,
  reserveFile,
  completeFile,
  releaseFile,
  fileLeaseHeaders,
} from "./ownedFiles";
import {
  createChunkStorageUrl,
  getChunkStorageStub,
} from "./uploadedFileStorage";
import { assertFileMetadata } from "./chunkStorageSupport";
import type { ChunkInput, CompleteInput } from "./uploadSchema";
import { withFileLease } from "./uploadLease";
import { readUploadResponse } from "./uploadResponses";

export class UploadService {
  constructor(
    private readonly env: Env,
    private readonly userId: string,
  ) {}

  private storageRequest(
    fileId: string,
    action: string,
    init?: RequestInit,
    query?: Record<string, string>,
  ) {
    const params = new URLSearchParams({ action, fileId, ...query });
    return getChunkStorageStub(this.env, fileId).fetch(
      new Request(createChunkStorageUrl("/?" + params), init),
    );
  }

  async chunk(input: ChunkInput): Promise<Record<string, unknown>> {
    const fileId = await ownedFileId(this.userId, input.fileId);
    await reserveFile(this.env, this.userId, fileId, input.fileSize, {
      externalFileId: input.fileId,
      fileName: input.fileName,
      mimeType: input.mimeType,
    });
    return withFileLease(
      this.env,
      this.userId,
      fileId,
      "upload",
      async (lease) => {
        input.formData.set("fileId", fileId);
        const response = await this.storageRequest(fileId, "storeChunk", {
          method: "POST",
          body: input.formData,
          headers: fileLeaseHeaders(this.userId, fileId, lease),
        });
        const result = await readUploadResponse(
          response,
          "UPLOAD_CHUNK_STORE_FAILED",
        );
        if (result.success !== true)
          throw new WorkerError(
            "Chunk was not stored",
            "UPLOAD_CHUNK_STORE_FAILED",
            502,
          );
        return { ...result, fileId: input.fileId };
      },
    );
  }

  async complete(
    input: CompleteInput,
  ): Promise<{ success: true; file: UploadedFileRef }> {
    const fileId = await ownedFileId(this.userId, input.fileId);
    return withFileLease(
      this.env,
      this.userId,
      fileId,
      "complete",
      async (lease) => {
        const response = await this.storageRequest(
          fileId,
          "mergeChunks",
          {
            headers: fileLeaseHeaders(this.userId, fileId, lease),
          },
          input.fileHash ? { fileHash: input.fileHash } : undefined,
        );
        const result = await readUploadResponse(
          response,
          "UPLOAD_MERGE_FAILED",
        );
        const file = result.file as UploadedFileRef | undefined;
        if (
          result.success !== true ||
          !file ||
          file.fileId !== fileId ||
          !Number.isSafeInteger(file.size) ||
          file.size <= 0 ||
          typeof file.fileHash !== "string" ||
          typeof file.fileName !== "string" ||
          typeof file.mimeType !== "string" ||
          file.source !== "uploaded"
        ) {
          throw new WorkerError(
            "Invalid merged file reference",
            "UPLOAD_MERGE_FAILED",
            502,
          );
        }
        await completeFile(this.env, this.userId, fileId, lease);
        return { success: true, file: { ...file, fileId: input.fileId } };
      },
    );
  }

  async status(
    externalFileId: string,
    chunkSize?: string,
  ): Promise<Record<string, unknown> | null> {
    const fileId = await ownedFileId(this.userId, externalFileId);
    const response = await this.storageRequest(
      fileId,
      "getMetadata",
      undefined,
      chunkSize !== undefined ? { chunkSize } : undefined,
    );
    if (response.status === 404) return null;
    const metadata = await readUploadResponse(
      response,
      "UPLOAD_STATUS_READ_FAILED",
    );
    assertFileMetadata(metadata, fileId);
    return {
      fileId: externalFileId,
      fileName: metadata.fileName,
      fileHash: metadata.fileHash,
      totalSize: metadata.totalSize,
      chunkSize: metadata.chunkSize,
      totalChunks: metadata.totalChunks,
      receivedChunks: metadata.receivedChunks,
      receivedIndices: metadata.receivedIndices,
      percentage: Math.round(
        (metadata.receivedChunks / metadata.totalChunks) * 100,
      ),
      isComplete:
        metadata.isMerged === true ||
        metadata.receivedChunks === metadata.totalChunks,
    };
  }

  async delete(externalFileId: string): Promise<{ success: true }> {
    const fileId = await ownedFileId(this.userId, externalFileId);
    return withFileLease(
      this.env,
      this.userId,
      fileId,
      "delete",
      async (lease) => {
        const response = await this.storageRequest(fileId, "deleteFile", {
          headers: fileLeaseHeaders(this.userId, fileId, lease),
        });
        await readUploadResponse(response, "UPLOAD_DELETE_FAILED");
        await releaseFile(this.env, this.userId, fileId, lease);
        return { success: true };
      },
    );
  }
}
