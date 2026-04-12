/**
 * 测试运行器
 * 运行所有 Worker 测试
 */

console.log('🚀 Starting Worker Test Suite\n');
console.log('='.repeat(50));

// 按顺序运行测试
import '../utils/id.test';
import '../utils/cache.test';
import '../types/errors.test';
import '../core/taskManager.test';
import '../mcp/client.test';
import './integration.test';

console.log('\n' + '='.repeat(50));
console.log('✅ All tests completed!');
console.log('='.repeat(50));
