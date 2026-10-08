import { WorkerError } from '../types';

export const SESSION_SECONDS = 60 * 60 * 24 * 30;

export function accountError(message: string, code = 'ACCOUNT_INVALID', status = 400): never {
  throw new WorkerError(message, code, status);
}

export function positive(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

export function hex(data: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(data), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function digest(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export function randomToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(32)));
}

export function accountJSON(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
