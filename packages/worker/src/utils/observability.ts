import { WorkerError } from '../types';

export const ERROR_CODES = {
  REQUEST_METHOD_NOT_ALLOWED: 'REQUEST_METHOD_NOT_ALLOWED',
  REQUEST_UNSUPPORTED_CONTENT_TYPE: 'REQUEST_UNSUPPORTED_CONTENT_TYPE',
  REQUEST_BODY_TOO_LARGE: 'REQUEST_BODY_TOO_LARGE',
  CHAT_INVALID_JSON: 'CHAT_INVALID_JSON',
  CHAT_MESSAGES_REQUIRED: 'CHAT_MESSAGES_REQUIRED',
  CHAT_TASK_EXECUTION_FAILED: 'CHAT_TASK_EXECUTION_FAILED',
  CHAT_STREAM_WRITE_FAILED: 'CHAT_STREAM_WRITE_FAILED',
  UPLOAD_CHUNK_INVALID_REQUEST: 'UPLOAD_CHUNK_INVALID_REQUEST',
  UPLOAD_CHUNK_STORE_FAILED: 'UPLOAD_CHUNK_STORE_FAILED',
  UPLOAD_COMPLETE_INVALID_REQUEST: 'UPLOAD_COMPLETE_INVALID_REQUEST',
  UPLOAD_MERGE_FAILED: 'UPLOAD_MERGE_FAILED',
  UPLOAD_STATUS_INVALID_REQUEST: 'UPLOAD_STATUS_INVALID_REQUEST',
  UPLOAD_STATUS_READ_FAILED: 'UPLOAD_STATUS_READ_FAILED',
  UPLOAD_STATUS_NOT_FOUND: 'UPLOAD_STATUS_NOT_FOUND',
  UPLOADED_FILE_NOT_FOUND: 'UPLOADED_FILE_NOT_FOUND',
  UPLOADED_FILE_READ_FAILED: 'UPLOADED_FILE_READ_FAILED',
  FILE_RETRIEVAL_SCOPE_LIMIT: 'FILE_RETRIEVAL_SCOPE_LIMIT',
  FILE_ANALYSIS_EXECUTION_FAILED: 'FILE_ANALYSIS_EXECUTION_FAILED',
} as const;

export type DomainErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES];

export interface LogContext {
  route?: string;
  requestType?: string;
  method?: string;
  status?: number;
  taskId?: string;
  fileId?: string;
  skill?: string;
  model?: string;
  durationMs?: number;
  errorCode?: string;
  [key: string]: unknown;
}

export function getRequestType(pathname: string): string {
  switch (pathname) {
    case '/':
    case '/chat':
      return 'chat';
    case '/upload/chunk':
      return 'upload_chunk';
    case '/upload/complete':
      return 'upload_complete';
    case '/upload/status':
      return 'upload_status';
    case '/health':
      return 'health';
    case '/stats':
      return 'stats';
    default:
      return 'unknown';
  }
}

export function createErrorDetails(
  errorCode: DomainErrorCode,
  details?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    errorCode,
    ...(details || {}),
  };
}

export function getErrorCode(error: unknown): string | undefined {
  if (error instanceof WorkerError) {
    const details = error.details;
    if (details && typeof details.errorCode === 'string') {
      return details.errorCode;
    }
    return error.code;
  }

  if (isRecord(error) && typeof error.errorCode === 'string') {
    return error.errorCode;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
