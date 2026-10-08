import type { Env, Task } from '../types';
import type {
  AccountSettings, AccountUsage, BeginModelCallInput, FinishTaskInput,
  ReserveTaskInput, SettleModelCallInput, UserFile,
} from './accountTypes';
import { accountError } from './accountSupport';

/** Transport only: all account data still belongs to the single accounts-v1 DO. */
export async function accountRPC<T>(env: AccountSettings, action: string, payload: unknown): Promise<T> {
  if (!env.ACCOUNTS) accountError('Account service is not configured', 'ACCOUNT_UNAVAILABLE', 503);
  const directory = env.ACCOUNTS.get(env.ACCOUNTS.idFromName('accounts-v1'));
  const response = await directory.fetch(new Request('https://accounts/' + action, {
    method: 'POST',
    body: JSON.stringify(payload),
  }));
  const data = await response.json() as T & { error?: string; code?: string };
  if (!response.ok) accountError(data.error || 'Account request failed', data.code, response.status);
  return data;
}

export const reserveTask = (env: Env, input: ReserveTaskInput) =>
  accountRPC<{ reservationId: string }>(env, 'reserve', input);
export const beginModelCall = (env: Env, input: BeginModelCallInput) =>
  accountRPC<void>(env, 'begin-call', input);
export const settleModelCall = (env: Env, input: SettleModelCallInput) =>
  accountRPC<void>(env, 'settle-call', input);
export const finishTask = (env: Env, input: FinishTaskInput) =>
  accountRPC<void>(env, 'finish', input);
export const updateTaskSummary = (env: Env, userId: string, summary: Task) =>
  accountRPC<void>(env, 'summary', { userId, summary });
export const listUserTasks = (env: Env, userId: string) =>
  accountRPC<Task[]>(env, 'list', { userId });
export const getUserUsage = (env: Env, userId: string) =>
  accountRPC<AccountUsage>(env, 'usage', { userId });
export const listUserFiles = (env: Env, userId: string) =>
  accountRPC<UserFile[]>(env, 'list-files', { userId });
