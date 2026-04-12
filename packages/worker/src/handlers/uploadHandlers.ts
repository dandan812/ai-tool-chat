import type {
  Env,
  UploadCompleteRequest,
  UploadCompleteResponse,
  UploadStatusResponse,
} from "../types";
import { ValidationError } from "../types";
import {
  createChunkStorageUrl,
  getChunkStorageStub,
} from "../upload/uploadedFileStorage";
import {
  createJSONResponse,
  safeJSONParse,
} from "../infrastructure/middleware";
import { logger } from "../infrastructure/logger";
import {
  createErrorDetails,
  ERROR_CODES,
} from "../infrastructure/observability";

/**
 * 上传链路天然更复杂：前端分片、DO 状态、R2 正文合并都在这里汇合。
 * 这一层只保留 HTTP 适配和日志，真正的状态修复/合并逻辑仍放在 DO 侧，
 * 这样入口层不需要直接理解存储细节。
 */
export async function handleUploadChunk(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // 分片上传用 multipart/form-data，
    // 因为同一请求里既要带二进制 chunk，也要带 fileId、chunkIndex 这类元数据。
    const formData = await request.formData();
    const fileId = formData.get("fileId") as string;
    const chunkIndex = Number.parseInt(
      (formData.get("chunkIndex") as string) || "0",
      10,
    );
    const totalChunks = Number.parseInt(
      (formData.get("totalChunks") as string) || "0",
      10,
    );
    const fileHash = formData.get("fileHash") as string;
    const chunk = formData.get("chunk") as File;
    const mimeType = (formData.get("mimeType") as string) || "text/plain";

    if (!fileId || !chunk || Number.isNaN(chunkIndex)) {
      throw new ValidationError(
        "Missing required fields: fileId, chunk, or chunkIndex",
        createErrorDetails(ERROR_CODES.UPLOAD_CHUNK_INVALID_REQUEST),
      );
    }

    const arrayBuffer = await chunk.arrayBuffer();

    logger.info("Uploading chunk", {
      route: "/upload/chunk",
      requestType: "upload_chunk",
      fileId,
      chunkIndex,
      size: arrayBuffer.byteLength,
    });

    // HTTP handler 不直接操作 Durable Object 的内部存储，
    // 而是把请求转发给 fileId 对应的 DO 实例，保持入口层足够薄。
    const durableObjectUrl = createChunkStorageUrl(
      `/?action=storeChunk&fileId=${encodeURIComponent(fileId)}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}&fileHash=${encodeURIComponent(fileHash)}&mimeType=${encodeURIComponent(mimeType)}`,
    );
    const chunkStorage = getChunkStorageStub(env, fileId);
    const durableRequest = new Request(durableObjectUrl, {
      method: "POST",
      body: formData,
    });
    const durableResponse = await chunkStorage.fetch(durableRequest);

    if (!durableResponse.ok) {
      const error = await durableResponse.text();
      logger.error("Durable Object error during chunk upload", {
        route: "/upload/chunk",
        requestType: "upload_chunk",
        fileId,
        chunkIndex,
        errorCode: ERROR_CODES.UPLOAD_CHUNK_STORE_FAILED,
        error,
      });
      throw new ValidationError(
        `Durable Object error: ${error}`,
        createErrorDetails(ERROR_CODES.UPLOAD_CHUNK_STORE_FAILED, {
          fileId,
          chunkIndex,
        }),
      );
    }

    const result = await durableResponse.json();
    logger.info("Chunk stored", {
      route: "/upload/chunk",
      requestType: "upload_chunk",
      fileId,
      chunkIndex,
      receivedChunks: result.receivedChunks,
      duplicate: result.duplicate,
    });

    // DO 返回的结果里会带上 duplicate / receivedChunks，
    // 前端据此恢复断点续传进度。
    return createJSONResponse(result);
  } catch (error) {
    logger.error("Upload chunk error", {
      route: "/upload/chunk",
      requestType: "upload_chunk",
      errorCode: ERROR_CODES.UPLOAD_CHUNK_STORE_FAILED,
      error,
    });
    throw error;
  }
}

export async function handleUploadComplete(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    // complete 请求只需要 fileId 等轻量字段，
    // 因此这里改用 JSON，而不是再次发送所有分片内容。
    const body = await safeJSONParse<UploadCompleteRequest>(request);
    if (!body) {
      throw new ValidationError(
        "Invalid JSON body",
        createErrorDetails(ERROR_CODES.UPLOAD_COMPLETE_INVALID_REQUEST),
      );
    }

    const { fileId, fileName } = body;

    logger.info("Upload complete request", {
      route: "/upload/complete",
      requestType: "upload_complete",
      fileId,
      fileName,
    });
    const chunkStorage = getChunkStorageStub(env, fileId);

    // merge 之前先拉一次 metadata 日志，
    // 方便排查“前端显示都传完了，但服务端认为还缺片”的情况。
    const checkDurableUrl = createChunkStorageUrl(
      `/?action=getMetadata&fileId=${encodeURIComponent(fileId)}`,
    );
    const checkResponse = await chunkStorage.fetch(checkDurableUrl);
    const checkData = await checkResponse.json();
    logger.info("Metadata check before merge", {
      route: "/upload/complete",
      requestType: "upload_complete",
      fileId,
      receivedChunks: checkData?.receivedChunks,
      totalChunks: checkData?.totalChunks,
    });

    const durableObjectUrl = createChunkStorageUrl(
      `/?action=mergeChunks&fileId=${encodeURIComponent(fileId)}`,
    );
    const durableResponse = await chunkStorage.fetch(
      new Request(durableObjectUrl, { method: "GET" }),
    );

    if (!durableResponse.ok) {
      const error = await durableResponse.text();
      logger.error("Durable Object error during merge", {
        route: "/upload/complete",
        requestType: "upload_complete",
        fileId,
        errorCode: ERROR_CODES.UPLOAD_MERGE_FAILED,
        error,
      });
      throw new ValidationError(
        `Durable Object error: ${error}`,
        createErrorDetails(ERROR_CODES.UPLOAD_MERGE_FAILED, { fileId }),
      );
    }

    const result = await durableResponse.json();
    logger.info("Chunks merged", {
      route: "/upload/complete",
      requestType: "upload_complete",
      fileId,
      success: result.success,
    });

    // merge 接口即使 HTTP 200，也可能因为缺片等业务原因返回 success=false，
    // 这里继续转成统一的校验错误，保持前端错误处理一致。
    if (!result.success) {
      throw new ValidationError(
        result.error || "Merge failed",
        createErrorDetails(ERROR_CODES.UPLOAD_MERGE_FAILED, { fileId }),
      );
    }

    return createJSONResponse({
      success: true,
      file: result.file,
    });
  } catch (error) {
    logger.error("Upload complete error", {
      route: "/upload/complete",
      requestType: "upload_complete",
      errorCode: ERROR_CODES.UPLOAD_MERGE_FAILED,
      error,
    });
    throw error;
  }
}

export async function handleUploadStatus(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId");

    if (!fileId) {
      throw new ValidationError(
        "Missing fileId parameter",
        createErrorDetails(ERROR_CODES.UPLOAD_STATUS_INVALID_REQUEST),
      );
    }

    logger.info("Upload status request", {
      route: "/upload/status",
      requestType: "upload_status",
      fileId,
    });
    const chunkStorage = getChunkStorageStub(env, fileId);
    const durableObjectUrl = createChunkStorageUrl(
      `/?action=getMetadata&fileId=${encodeURIComponent(fileId)}`,
    );
    const durableResponse = await chunkStorage.fetch(durableObjectUrl);

    if (durableResponse.status === 404) {
      logger.info("Upload status not found", {
        route: "/upload/status",
        requestType: "upload_status",
        fileId,
        errorCode: ERROR_CODES.UPLOAD_STATUS_NOT_FOUND,
      });
      return createJSONResponse(
        {
          error: `File ${fileId} not found`,
          code: ERROR_CODES.UPLOAD_STATUS_NOT_FOUND,
        },
        404,
      );
    }

    if (!durableResponse.ok) {
      const errorText = await durableResponse.text();
      throw new ValidationError(
        `读取上传状态失败: ${errorText}`,
        createErrorDetails(ERROR_CODES.UPLOAD_STATUS_READ_FAILED, { fileId }),
      );
    }

    const metadata = await durableResponse.json();
    logger.info("Got upload metadata", {
      route: "/upload/status",
      requestType: "upload_status",
      fileId,
      receivedChunks: metadata?.receivedChunks,
      totalChunks: metadata?.totalChunks,
    });

    if (!metadata) {
      throw new ValidationError("Invalid metadata response");
    }

    // 这里把 DO 内部 metadata 转成前端更容易直接消费的状态对象，
    // 比如 percentage 和 isComplete，避免前端重复计算一遍。
    const percentage =
      metadata.totalChunks > 0
        ? Math.round((metadata.receivedChunks / metadata.totalChunks) * 100)
        : 0;

    return createJSONResponse({
      fileId,
      fileName: metadata.fileName,
      fileHash: metadata.fileHash,
      totalChunks: metadata.totalChunks,
      receivedChunks: metadata.receivedChunks,
      receivedIndices: metadata.receivedIndices,
      percentage,
      isComplete: metadata.receivedChunks >= metadata.totalChunks,
    });
  } catch (error) {
    logger.error("Upload status error", {
      route: "/upload/status",
      requestType: "upload_status",
      errorCode: ERROR_CODES.UPLOAD_STATUS_READ_FAILED,
      error,
    });
    throw error;
  }
}

/**
 * 删除接口用于清理断点续传残留状态。
 * 它会把 metadata、分片对象和已合并文件一起交给 DO 侧删除。
 */
export async function handleUploadDelete(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get("fileId");

    if (!fileId) {
      throw new ValidationError(
        "Missing fileId parameter",
        createErrorDetails(ERROR_CODES.UPLOAD_STATUS_INVALID_REQUEST),
      );
    }

    logger.info("Upload delete request", {
      route: "/upload/delete",
      requestType: "upload_delete",
      fileId,
    });

    const chunkStorage = getChunkStorageStub(env, fileId);
    const durableObjectUrl = createChunkStorageUrl(
      `/?action=deleteFile&fileId=${encodeURIComponent(fileId)}`,
    );
    const durableResponse = await chunkStorage.fetch(durableObjectUrl);

    if (!durableResponse.ok) {
      const errorText = await durableResponse.text();
      throw new ValidationError(
        `删除上传失败: ${errorText}`,
        createErrorDetails(ERROR_CODES.UPLOAD_STATUS_READ_FAILED, { fileId }),
      );
    }

    logger.info("Upload deleted successfully", {
      route: "/upload/delete",
      requestType: "upload_delete",
      fileId,
    });

    return createJSONResponse({ success: true });
  } catch (error) {
    logger.error("Upload delete error", {
      route: "/upload/delete",
      requestType: "upload_delete",
      error,
    });
    throw error;
  }
}
