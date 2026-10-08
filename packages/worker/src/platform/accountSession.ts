import type { Env } from '../types';
import { WorkerError } from '../types';
import type { AccountSettings, AccountUser } from './accountTypes';
import { accountError, digest, SESSION_SECONDS } from './accountSupport';
import { accountRPC } from './accountClient';

export { SESSION_SECONDS } from './accountSupport';

type SessionCookieName = 'ait_session' | 'ait_guest_session';
export function sessionCookie(token: string, env: AccountSettings, age = SESSION_SECONDS, name: SessionCookieName = 'ait_session'): string {
  return name + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + age +
    (env.ENVIRONMENT === 'development' ? '' : '; Secure');
}

export function sessionToken(request: Request, name: SessionCookieName = 'ait_session'): string {
  return request.headers.get('cookie')?.split(';').map(value => value.trim())
    .find(value => value.startsWith(name + '='))?.slice(name.length + 1) || '';
}

export async function requireUser(request: Request, env: Env): Promise<AccountUser> {
  // Logged-in accounts take priority; a late anonymous response cannot replace them.
  for (const name of ['ait_session', 'ait_guest_session'] as const) {
    if (name === 'ait_guest_session' && env.ALLOW_GUEST_ACCESS !== 'true') continue;
    const token = sessionToken(request, name);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) continue;
    let user: AccountUser;
    try {
      user = await accountRPC<AccountUser>(env, 'session', { hash: await digest(token) });
    } catch (error) {
      if (error instanceof WorkerError && error.statusCode === 401) continue;
      throw error;
    }
    if (user.guest && env.ALLOW_GUEST_ACCESS !== 'true') accountError('Guest access is disabled', 'UNAUTHORIZED', 401);
    if (name === 'ait_guest_session' && !user.guest) accountError('Invalid guest session', 'UNAUTHORIZED', 401);
    const expected = request.headers.get('X-Account-ID');
    if (expected && expected !== user.id) {
      accountError('Account changed in another tab; reload before continuing', 'ACCOUNT_CHANGED', 409);
    }
    return user;
  }
  accountError('Please sign in', 'UNAUTHORIZED', 401);
}

export function validateWriteOrigin(request: Request, env: AccountSettings): void {
  const origin = request.headers.get('origin');
  const target = new URL(request.url);
  const allowed = [target.origin, ...(env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)];
  let parsed: URL | undefined;
  try {
    parsed = origin ? new URL(origin) : undefined;
  } catch {
    // Malformed origins are rejected by the same gate as missing origins.
  }
  if (!origin || origin === 'null' || !parsed || parsed.origin !== origin ||
    !['http:', 'https:'].includes(parsed.protocol) ||
    (env.ENVIRONMENT !== 'development' && parsed.protocol !== 'https:') ||
    request.headers.get('sec-fetch-site') === 'cross-site' || !allowed.includes(origin)) {
    accountError('Request origin is not allowed', 'ORIGIN_FORBIDDEN', 403);
  }
}
