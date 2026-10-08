import type { AccountSettings, AccountUser, CredentialsInput } from './accountTypes';
import { accountError as fail, hex, positive, randomToken, SESSION_SECONDS } from './accountSupport';

interface StoredUser extends AccountUser { salt: string; hash: string }
interface StoredSession { user: AccountUser; expiresAt: number }
interface AttemptWindow { count: number; until: number }

async function passwordHash(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  // Keep the existing Workers-compatible work factor and mandatory throttling.
  return hex(await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000,
  }, key, 256));
}

function sameHash(a: string, b: string): boolean {
  let result = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    result |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return result === 0;
}

/** Credentials, attempt windows and sessions only; called under the directory gate. */
export class AccountAuthentication {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: AccountSettings,
    private readonly now: number,
  ) {}

  async session(hash: string): Promise<AccountUser> {
    const key = 'session:' + hash;
    const session = await this.storage.get<StoredSession>(key);
    if (!session || session.expiresAt <= this.now) {
      await this.storage.delete(key);
      fail('Session expired', 'UNAUTHORIZED', 401);
    }
    return session.user;
  }

  async logout(hash: string): Promise<object> {
    await this.storage.delete('session:' + hash);
    return {};
  }

  async guest(sessionHash: string, ipHash: string): Promise<AccountUser> {
    if (this.env.ALLOW_GUEST_ACCESS !== 'true') fail('Guest access is disabled', 'GUEST_DISABLED', 403);
    const count = await this.storage.get<number>('guest:created') || 0;
    if (count >= positive(this.env.MAX_GUEST_SESSIONS, 1000)) {
      fail('Guest capacity reached', 'GUEST_CAPACITY', 429);
    }
    // Bound aggregate creation before recording per-IP windows or session data.
    const globalWindow = await this.attemptWindow('attempt:guest:global', 100);
    const ipKey = 'attempt:guest:ip:' + ipHash;
    const ipWindow = await this.attemptWindow(ipKey, 10);
    const user: AccountUser = { id: crypto.randomUUID(), username: 'guest', guest: true };
    await this.storage.put({
      'guest:created': count + 1,
      'attempt:guest:global': globalWindow,
      [ipKey]: ipWindow,
      ['session:' + sessionHash]: { user, expiresAt: this.now + SESSION_SECONDS * 1000 },
    });
    return user;
  }

  async authenticate(action: 'register' | 'login', input: CredentialsInput): Promise<AccountUser> {
    if (action === 'register' && this.env.ALLOW_REGISTRATION !== 'true') {
      fail('Registration is disabled', 'REGISTRATION_DISABLED', 403);
    }
    const userAttemptKey = 'attempt:user:' + input.username;
    await this.recordAttempt(userAttemptKey, 8);
    await this.recordAttempt('attempt:ip:' + input.ipHash, 30);
    const userKey = 'user:' + input.username;
    let user = await this.storage.get<StoredUser>(userKey);
    if (action === 'register') {
      if (user) fail('Unable to register this username', 'REGISTRATION_CONFLICT', 409);
      const salt = randomToken();
      user = { id: crypto.randomUUID(), username: input.username, salt, hash: await passwordHash(input.password, salt) };
      await this.storage.put(userKey, user);
    } else {
      const actual = await passwordHash(input.password, user?.salt || 'invalid-user-dummy-salt');
      if (!user || !sameHash(actual, user.hash)) fail('Username or password is incorrect', 'UNAUTHORIZED', 401);
    }
    const publicUser = { id: user.id, username: user.username };
    await this.storage.put('session:' + input.sessionHash, {
      user: publicUser, expiresAt: this.now + SESSION_SECONDS * 1000,
    });
    // Successful authentication clears only the username window, not the IP window.
    await this.storage.delete(userAttemptKey);
    return publicUser;
  }

  private async recordAttempt(key: string, limit: number): Promise<void> {
    await this.storage.put(key, await this.attemptWindow(key, limit));
  }

  private async attemptWindow(key: string, limit: number): Promise<AttemptWindow> {
    const previous = await this.storage.get<AttemptWindow>(key);
    const entry = previous && previous.until > this.now ? previous : { count: 0, until: this.now + 15 * 60 * 1000 };
    if (entry.count >= limit) fail('Too many attempts; retry later', 'RATE_LIMITED', 429);
    return { ...entry, count: entry.count + 1 };
  }
}
