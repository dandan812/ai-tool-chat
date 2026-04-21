import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const allowedRootLockfile = 'pnpm-lock.yaml';
const disallowedLockfiles = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
]);
const ignoredDirectories = new Set([
  '.git',
  '.wrangler',
  'coverage',
  'dist',
  'node_modules',
]);

/**
 * 递归扫描仓库，找出不允许出现的 lockfile。
 * 根目录只允许保留一个 `pnpm-lock.yaml`。
 */
function collectDisallowedLockfiles(directory, results) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectDisallowedLockfiles(absolutePath, results);
      continue;
    }

    if (!disallowedLockfiles.has(entry.name)) {
      continue;
    }

    const relativePath = path.relative(repoRoot, absolutePath).split(path.sep).join('/');
    if (relativePath === allowedRootLockfile) {
      continue;
    }

    results.push(relativePath);
  }
}

/**
 * `.wrangler` 是本地产物目录，可以存在于工作区，
 * 但绝不能被 Git 索引跟踪。
 */
function collectTrackedWranglerFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  return output
    .split('\0')
    .filter(Boolean)
    .filter((filePath) => /(^|\/)\.wrangler(\/|$)/.test(filePath));
}

const errors = [];
const foundLockfiles = [];

if (!existsSync(path.join(repoRoot, allowedRootLockfile))) {
  errors.push(`缺少根目录 ${allowedRootLockfile}`);
}

collectDisallowedLockfiles(repoRoot, foundLockfiles);

if (foundLockfiles.length > 0) {
  errors.push(`发现不允许提交的嵌套或非 pnpm lockfile:\n- ${foundLockfiles.join('\n- ')}`);
}

const trackedWranglerFiles = collectTrackedWranglerFiles();
if (trackedWranglerFiles.length > 0) {
  errors.push(`发现被 Git 跟踪的 .wrangler 产物:\n- ${trackedWranglerFiles.join('\n- ')}`);
}

if (errors.length > 0) {
  console.error('仓库卫生检查失败。\n');
  console.error(errors.join('\n\n'));
  process.exit(1);
}

console.log('仓库卫生检查通过。');
