import type { Env, UploadedFileRef } from '../types';
import { accountError, accountRPC, digest } from '../platform/accounts';
import { createChunkStorageUrl, getChunkStorageStub } from './uploadedFileStorage';
import { createUploadedFileRef, type FileMetadata } from './chunkStorageSupport';
export function validateFileId(fileId: string) { if (!/^[a-zA-Z0-9_-]{1,160}$/.test(fileId)) accountError('Invalid file ID'); }
export async function ownedFileId(userId: string, fileId: string) { validateFileId(fileId); if (!userId) accountError('Please sign in', 'UNAUTHORIZED', 401); return 'owned-' + await digest(userId + '\0' + fileId); }
export async function reserveFile(env: Env, userId: string, fileId: string, bytes: number, metadata?: { externalFileId: string; fileName: string; mimeType: string }) { return accountRPC(env, 'reserve-file', { userId, fileId, bytes, metadata }); }
export interface FileLease { leaseId: string; generation: string; expiresAt: number }
export const acquireFileLease = (env: Env, userId: string, fileId: string, kind: 'upload' | 'complete' | 'delete') => accountRPC<FileLease>(env, 'lease-file', { userId, fileId, kind });
export const endFileLease = (env: Env, userId: string, fileId: string, lease: FileLease) => accountRPC(env, 'end-file-lease', { userId, fileId, ...lease });
export function fileLeaseHeaders(userId: string, fileId: string, lease: FileLease) { return { 'X-File-User': userId, 'X-File-Id': fileId, 'X-File-Lease': lease.leaseId, 'X-File-Generation': lease.generation }; }
export async function completeFile(env: Env, userId: string, fileId: string, lease: FileLease) { return accountRPC(env, 'complete-file', { userId, fileId, ...lease }); }
export async function releaseFile(env: Env, userId: string, fileId: string, lease: FileLease) { return accountRPC(env, 'release-file', { userId, fileId, ...lease }); }
export async function resolveOwnedUploadedFiles(env: Env, userId: string, refs: UploadedFileRef[]): Promise<UploadedFileRef[]> {
  if (!Array.isArray(refs) || refs.length > 10) accountError('At most 10 files can be analyzed');
  return Promise.all(refs.map(async ref => {
    if (!ref || typeof ref.fileId !== 'string') accountError('Invalid file reference');
    const fileId = await ownedFileId(userId, ref.fileId);
    const response = await getChunkStorageStub(env, fileId).fetch(createChunkStorageUrl('/?action=getMetadata&fileId=' + encodeURIComponent(fileId)));
    if (!response.ok) accountError('File not found in your account', 'FILE_NOT_FOUND', 404);
    const metadata = await response.json() as FileMetadata;
    if (!metadata.isMerged) accountError('File upload is not complete', 'FILE_INCOMPLETE', 409);
    if (!metadata.serverContentHash || !/^[a-f0-9]{64}$/.test(metadata.serverContentHash)) accountError('File has no verified version; please re-upload', 'FILE_VERSION_MISSING', 410);
    return { ...createUploadedFileRef(metadata), fileHash: metadata.serverContentHash };
  }));
}
