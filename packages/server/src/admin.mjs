import { randomBytes } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRuntime } from './runtime.mjs';

process.umask(0o077);
const [username, outputPath] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9_.@+-]{2,63}$/.test(username || '') || !outputPath || !process.env.DATA_DIRECTORY) {
  throw new Error('Usage: DATA_DIRECTORY=<path> node admin.mjs <username> <restricted-credentials-file>');
}
const destination = resolve(outputPath);
await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
const password = randomBytes(24).toString('base64url');
const credentials = await open(destination, 'wx', 0o600);
try { await credentials.writeFile(`username=${username}\npassword=${password}\n`); }
finally { await credentials.close(); }
const runtime = await createRuntime({
  dataDirectory: process.env.DATA_DIRECTORY,
  variables: { ALLOW_REGISTRATION: 'true', ENVIRONMENT: 'production' },
});
try {
  const response = await runtime.env.ACCOUNTS.get('accounts-v1').fetch(new Request('https://accounts/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, sessionHash: randomBytes(32).toString('hex'), ipHash: 'local-bootstrap' }),
  }));
  if (!response.ok) throw new Error('Owner provisioning failed; inspect the restricted credential file and existing account state');
  console.log('Owner account provisioned; credentials are in the specified restricted file');
} finally { await runtime.close(); }
