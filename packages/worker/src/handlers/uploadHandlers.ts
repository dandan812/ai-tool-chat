import type {
  Env,
  UploadCompleteRequest,
  UploadCompleteResponse,
  UploadStatusResponse,
} from '../types';
import { ValidationError } from '../types';
import { createChunkStorageUrl, getChunkStorageStub } from '../utils/uploadedFileStorage';
import { createJSONResponse, safeJSONParse } from '../utils/middleware';
import { logger } from '../utils/logger';
import { createErrorDetails, ERROR_CODES } from '../utils/observability';

/**
 * 上传链路天然更复杂：前端分片、DO 状态、R2 正文合并都在这里汇合。
 * 这一层只保留 HTTP 适配和日志，真正的状态修复/合并逻辑仍放在 DO 侧，
 * 这样入口层不需要直接理解存储细节。
 */
export async function handleUploadChunk(request: Request, env: Env): Promise<Response> {
  try {
    const formData = await request.formData();
    const fileId = formData.get('fileId') as string;
    const chunkIndex = Number.parseInt((formData.get('chunkIndex') as string) || '0', 10);
    const totalChunks = Number.parseInt((formData.get('totalChunks') as string) || '0', 10);
    const fileHash = formData.get('fileHash') as string;
    const chunk = formData.get('chunk') as File;
    const mimeType = (formData.get('mimeType') as string) || 'text/plain';

    if (!fileId || !chunk || Number.isNaN(chunkIndex)) {
      throw new ValidationError(
        'Missing required fields: fileId, chunk, or chunkIndex',
        createErrorDetails(ERROR_CODES.UPLOAD_CHUNK_INVALID_REQUEST),
      );
    }

    const arrayBuffer = await chunk.arrayBuffer();

    logger.info('Uploading chunk', {
      route: '/upload/chunk',
      requestType: 'upload_chunk',
      fileId,
      chunkIndex,
      size: arrayBuffer.byteLength,
    });

    const durableObjectUrl = createChunkStorageUrl(
      `/?action=storeChunk&fileId=${encodeURIComponent(fileId)}&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}&fileHash=${encodeURIComponent(fileHash)}&mimeType=${encodeURIComponent(mimeType)}`,
    );
    const chunkStorage = getChunkStorageStub(env, fileId);
    const durableRequest = new Request(durableObjectUrl, {
      method: 'POST',
      body: formData,
    });
    const durableResponse = await chunkStorage.fetch(durableRequest);

    if (!durableResponse.ok) {
      const error = await durableResponse.text();
      logger.error('Durable Object error during chunk upload', {
        route: '/upload/chunk',
        requestType: 'upload_chunk',
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
    logger.info('Chunk stored', {
      route: '/upload/chunk',
      requestType: 'upload_chunk',
      fileId,
      chunkIndex,
      receivedChunks: result.receivedChunks,
      duplicate: result.duplicate,
    });

    return createJSONResponse(result);
  } catch (error) {
    logger.error('Upload chunk error', {
      route: '/upload/chunk',
      requestType: 'upload_chunk',
      errorCode: ERROR_CODES.UPLOAD_CHUNK_STORE_FAILED,
      error,
    });
    throw error;
  }
}

export async function handleUploadComplete(request: Request, env: Env): Promise<Response> {
  try {
    const body = await safeJSONParse<UploadCompleteRequest>(request);
    if (!body) {
      throw new ValidationError(
        'Invalid JSON body',
        createErrorDetails(ERROR_CODES.UPLOAD_COMPLETE_INVALID_REQUEST),
      );
    }

    const { fileId, fileName } = body;

    logger.info('Upload complete request', {
      route: '/upload/complete',
      requestType: 'upload_complete',
      fileId,
      fileName,
    });
    const chunkStorage = getChunkStorageStub(env, fileId);

    const checkDurableUrl = createChunkStorageUrl(`/?action=getMetadata&fileId=${encodeURIComponent(fileId)}`);
    const checkResponse = await chunkStorage.fetch(checkDurableUrl);
    const checkData = await checkResponse.json();
    logger.info('Metadata check before merge', {
      route: '/upload/complete',
      requestType: 'upload_complete',
      fileId,
      receivedChunks: checkData?.receivedChunks,
      totalChunks: checkData?.totalChunks,
    });

    const durableObjectUrl = createChunkStorageUrl(`/?action=mergeChunks&fileId=${encodeURIComponent(fileId)}`);
    const durableResponse = await chunkStorage.fetch(new Request(durableObjectUrl, { method: 'GET' }));

    if (!durableResponse.ok) {
      const error = await durableResponse.text();
      logger.error('Durable Object error during merge', {
        route: '/upload/complete',
        requestType: 'upload_complete',
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
    logger.info('Chunks merged', {
      route: '/upload/complete',
      requestType: 'upload_complete',
      fileId,
      success: result.success,
    });

    if (!result.success) {
      throw new ValidationError(
        result.error || 'Merge failed',
        createErrorDetails(ERROR_CODES.UPLOAD_MERGE_FAILED, { fileId }),
      );
    }

    return createJSONResponse<UploadCompleteResponse>({
      success: true,
      file: result.file,
    });
  } catch (error) {
    logger.error('Upload complete error', {
      route: '/upload/complete',
      requestType: 'upload_complete',
      errorCode: ERROR_CODES.UPLOAD_MERGE_FAILED,
      error,
    });
    throw error;
  }
}

export async function handleUploadStatus(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');

    if (!fileId) {
      throw new ValidationError(
        'Missing fileId parameter',
        createErrorDetails(ERROR_CODES.UPLOAD_STATUS_INVALID_REQUEST),
      );
    }

    logger.info('Upload status request', {
      route: '/upload/status',
      requestType: 'upload_status',
      fileId,
    });
    const chunkStorage = getChunkStorageStub(env, fileId);
    const durableObjectUrl = createChunkStorageUrl(`/?action=getMetadata&fileId=${encodeURIComponent(fileId)}`);
    const durableResponse = await chunkStorage.fetch(durableObjectUrl);

    if (durableResponse.status === 404) {
      logger.info('Upload status not found', {
        route: '/upload/status',
        requestType: 'upload_status',
        fileId,
        errorCode: ERROR_CODES.UPLOAD_STATUS_NOT_FOUND,
      });
      return createJSONResponse({
        error: `File ${fileId} not found`,
        code: ERROR_CODES.UPLOAD_STATUS_NOT_FOUND,
      }, 404);
    }

    if (!durableResponse.ok) {
      const errorText = await durableResponse.text();
      throw new ValidationError(
        `读取上传状态失败: ${errorText}`,
        createErrorDetails(ERROR_CODES.UPLOAD_STATUS_READ_FAILED, { fileId }),
      );
    }

    const metadata = await durableResponse.json();
    logger.info('Got upload metadata', {
      route: '/upload/status',
      requestType: 'upload_status',
      fileId,
      receivedChunks: metadata?.receivedChunks,
      totalChunks: metadata?.totalChunks,
    });

    if (!metadata) {
      throw new ValidationError('Invalid metadata response');
    }

    const percentage = metadata.totalChunks > 0
      ? Math.round((metadata.receivedChunks / metadata.totalChunks) * 100)
      : 0;

    return createJSONResponse<UploadStatusResponse>({
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
    logger.error('Upload status error', {
      route: '/upload/status',
      requestType: 'upload_status',
      errorCode: ERROR_CODES.UPLOAD_STATUS_READ_FAILED,
      error,
    });
    throw error;
  }
}

/**
 * 处理删除上传请求
 */
export async function handleUploadDelete(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const fileId = url.searchParams.get('fileId');

    if (!fileId) {
      throw new ValidationError(
        'Missing fileId parameter',
        createErrorDetails(ERROR_CODES.UPLOAD_STATUS_INVALID_REQUEST),
      );
    }

    logger.info('Upload delete request', {
      route: '/upload/delete',
      requestType: 'upload_delete',
      fileId,
    });

    const chunkStorage = getChunkStorageStub(env, fileId);
    const durableObjectUrl = createChunkStorageUrl(`/?action=deleteFile&fileId=${encodeURIComponent(fileId)}`);
    const durableResponse = await chunkStorage.fetch(durableObjectUrl);

    if (!durableResponse.ok) {
      const errorText = await durableResponse.text();
      throw new ValidationError(
        `删除上传失败: ${errorText}`,
        createErrorDetails(ERROR_CODES.UPLOAD_STATUS_READ_FAILED, { fileId }),
      );
    }

    logger.info('Upload deleted successfully', {
      route: '/upload/delete',
      requestType: 'upload_delete',
      fileId,
    });

    return createJSONResponse({ success: true });
  } catch (error) {
    logger.error('Upload delete error', {
      route: '/upload/delete',
      requestType: 'upload_delete',
      error,
    });
    throw error;
  }
}
