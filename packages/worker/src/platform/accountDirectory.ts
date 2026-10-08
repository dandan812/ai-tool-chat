import { WorkerError } from '../types';
import type { AccountSettings } from './accountTypes';
import { accountError as fail, accountJSON as json } from './accountSupport';
import { parseAccountRequest, type AccountRequest } from './accountRequests';
import { AccountAuthentication } from './accountAuthentication';
import { TaskBudgetLedger } from './accountLedger';
import { AccountFileQuota } from './accountFileQuota';
import { AccountTaskSummaries } from './accountTaskSummaries';

function errorResponse(error: unknown): Response {
  return json({
    error: error instanceof Error ? error.message : 'Account failure',
    code: error instanceof WorkerError ? error.code : 'ACCOUNT_ERROR',
  }, error instanceof WorkerError ? error.statusCode : 500);
}

/** A serialized directory for the initial small deployment; no public DO endpoint. */
export class AccountDirectory implements DurableObject {
  constructor(private readonly state: DurableObjectState, private readonly env: AccountSettings) {}

  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') fail('Method not allowed', 'METHOD_NOT_ALLOWED', 405);
      const action = new URL(request.url).pathname.slice(1);
      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        fail('Invalid JSON');
      }
      return await this.state.blockConcurrencyWhile(async () => {
        try {
          return json(await this.dispatch(parseAccountRequest(action, payload)));
        } catch (error) {
          // Expected account failures must not reject the DO concurrency gate.
          return errorResponse(error);
        }
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  private async dispatch(command: AccountRequest): Promise<unknown> {
    const storage = this.state.storage;
    const now = Date.now();
    const authentication = new AccountAuthentication(storage, this.env, now);
    const budget = (userId: string) => new TaskBudgetLedger(storage, this.env, userId, now);
    const files = (userId: string) => new AccountFileQuota(storage, this.env, userId, now);
    switch (command.action) {
      case 'guest':
        return authentication.guest(command.sessionHash, command.ipHash);
      case 'register':
      case 'login':
        return authentication.authenticate(command.action, command.input);
      case 'session':
        return authentication.session(command.hash);
      case 'logout':
        return authentication.logout(command.hash);
      case 'reserve':
        return budget(command.input.userId).reserve(command.input);
      case 'begin-call':
        return budget(command.input.userId).beginCall(command.input);
      case 'settle-call':
        return budget(command.input.userId).settleCall(command.input);
      case 'finish':
        return budget(command.input.userId).finish(command.input);
      case 'usage':
        return budget(command.userId).usage();
      case 'list':
        return new AccountTaskSummaries(storage, command.userId).list();
      case 'summary':
        return new AccountTaskSummaries(storage, command.userId).update(command.summary);
      case 'list-files':
        return files(command.userId).list();
      case 'reserve-file':
        return files(command.input.userId).reserve(command.input);
      case 'lease-file':
        return files(command.input.userId).acquireLease(command.input.fileId, command.input.kind);
      case 'validate-file-lease':
        return files(command.input.userId).validateLease(command.input.fileId, command.input, command.input.kind);
      case 'end-file-lease':
        return files(command.input.userId).endLease(command.input.fileId, command.input);
      case 'complete-file':
        return files(command.input.userId).complete(command.input.fileId, command.input);
      case 'release-file':
        return files(command.input.userId).release(command.input.fileId, command.input);
    }
  }
}
