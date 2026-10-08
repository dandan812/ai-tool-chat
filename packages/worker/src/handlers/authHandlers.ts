import type { Env } from '../types';
import { WorkerError } from '../types';
import type { AccountUser } from '../platform/accountTypes';
import { accountError, accountJSON, digest, randomToken } from '../platform/accountSupport';
import { accountRPC, getUserUsage, listUserFiles } from '../platform/accountClient';
import { requireUser, sessionToken, sessionCookie, validateWriteOrigin, SESSION_SECONDS } from '../platform/accountSession';

export { requireUser, SESSION_SECONDS } from '../platform/accountSession';

export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const action = new URL(request.url).pathname.split('/').pop();
  if (action === 'me' && request.method === 'GET') {
    if (!env.ACCOUNTS) accountError('Account service is not configured', 'ACCOUNT_UNAVAILABLE', 503);
    let user: AccountUser | null = null;
    try {
      user = await requireUser(request, env);
    } catch (error) {
      if (!(error instanceof WorkerError) || error.statusCode !== 401) throw error;
    }
    return accountJSON({
      user, registrationEnabled: env.ALLOW_REGISTRATION === 'true',
      guestEnabled: env.ALLOW_GUEST_ACCESS === 'true',
    });
  }
  if (action === 'files' && request.method === 'GET') {
    const user = await requireUser(request, env);
    return accountJSON({ files: await listUserFiles(env, user.id) });
  }
  if (action === 'usage' && request.method === 'GET') {
    const user = await requireUser(request, env);
    return accountJSON(await getUserUsage(env, user.id));
  }
  if (request.method !== 'POST') accountError('Method not allowed', 'METHOD_NOT_ALLOWED', 405);
  validateWriteOrigin(request, env);
  if (action === 'guest') {
    if (env.ALLOW_GUEST_ACCESS !== 'true') accountError('Guest access is disabled', 'GUEST_DISABLED', 403);
    try {
      return accountJSON({ user: await requireUser(request, env) });
    } catch (error) {
      if (!(error instanceof WorkerError) || error.statusCode !== 401) throw error;
    }
    const token = randomToken();
    const user = await accountRPC<AccountUser>(env, 'guest', {
      sessionHash: await digest(token),
      ipHash: await digest(request.headers.get('CF-Connecting-IP') || 'unknown'),
    });
    return accountJSON({ user }, 200, { 'Set-Cookie': sessionCookie(token, env, SESSION_SECONDS, 'ait_guest_session') });
  }
  if (action === 'logout') {
    for (const name of ['ait_session', 'ait_guest_session'] as const) {
      await accountRPC(env, 'logout', { hash: await digest(sessionToken(request, name)) });
    }
    const response = accountJSON({ success: true }, 200, { 'Set-Cookie': sessionCookie('', env, 0) });
    response.headers.append('Set-Cookie', sessionCookie('', env, 0, 'ait_guest_session'));
    return response;
  }
  if (action !== 'register' && action !== 'login') accountError('Not found', 'NOT_FOUND', 404);
  const text = await request.text();
  if (text.length > 2048) accountError('Request too large');
  let body: { username?: string; password?: string };
  try {
    body = JSON.parse(text);
  } catch {
    accountError('Invalid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) accountError('Invalid JSON');
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!/^[a-z0-9][a-z0-9_.@+-]{2,63}$/.test(username) || password.length < 12 || password.length > 128) accountError('用户名需3–64位，密码需12–128位');
  const token = randomToken();
  const user = await accountRPC<AccountUser>(env, action, {
    username, password,
    sessionHash: await digest(token),
    ipHash: await digest(request.headers.get('CF-Connecting-IP') || 'unknown'),
  });
  return accountJSON({ user }, 200, { 'Set-Cookie': sessionCookie(token, env) });
}
