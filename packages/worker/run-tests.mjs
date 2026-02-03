#!/usr/bin/env node
/**
 * 测试运行脚本
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('🚀 Starting Worker Test Suite\n');

const tests = [
  { name: 'ID Utils', file: 'src/utils/id.test.ts' },
  { name: 'Cache', file: 'src/utils/cache.test.ts' },
  { name: 'Error Types', file: 'src/types/errors.test.ts' },
  { name: 'Task Manager', file: 'src/core/taskManager.test.ts' },
  { name: 'MCP Client', file: 'src/mcp/client.test.ts' },
  { name: 'Integration', file: 'src/integration.test.ts' },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  console.log(`\n📦 Running ${test.name}...`);
  try {
    execSync(`npx tsx ${join(__dirname, test.file)}`, {
      stdio: 'inherit',
      cwd: __dirname,
    });
    passed++;
  } catch (err) {
    console.error(`❌ ${test.name} failed`);
    failed++;
  }
}

console.log('\n' + '='.repeat(50));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

process.exit(failed > 0 ? 1 : 0);
