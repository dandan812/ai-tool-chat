import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const release = 'node-' + new Date().toISOString().replaceAll(/[-:.]/g, '');
const output = join(root, 'generated', 'node-server-deployment');
const stage = join(output, release);
await mkdir(stage, { recursive: true });
await import('./build.mjs');
await mkdir(join(stage, 'backend'));
for (const file of ['server.mjs', 'admin.mjs', 'runtime.mjs']) {
  await cp(join(root, 'packages/server/dist', file), join(stage, 'backend', file));
}
execFileSync(process.execPath, [
  join(root, 'packages/frontend/node_modules/vite/bin/vite.js'),
  'build', '--outDir', join(stage, 'frontend'),
], {
  cwd: join(root, 'packages/frontend'),
  env: { ...process.env, VITE_API_URL: '/api' },
  stdio: 'inherit',
});
await cp(join(root, 'packages/server/deploy'), join(stage, 'deployment'), { recursive: true });
await cp(join(root, 'packages/server/.env.example'), join(stage, 'deployment/server.env.example'));
await cp(join(root, 'packages/server/README.md'), join(stage, 'README.md'));
const html = await readFile(join(stage, 'frontend/index.html'), 'utf8');
if (!html.includes('/assets/')) throw new Error('Frontend build is missing its expected assets');
const archive = join(output, release + '.tar.gz');
execFileSync('tar', ['-czf', archive, '-C', stage, '.'], { stdio: 'inherit' });
const sha256 = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(archive + '.sha256', sha256 + '  ' + release + '.tar.gz\n');
console.log(JSON.stringify({ release, archive, sha256 }));
