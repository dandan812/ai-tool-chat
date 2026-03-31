import { describe, expect, it } from 'vitest';
import {
  APIError,
  AuthenticationError,
  NotFoundError,
  TimeoutError,
  ValidationError,
  WorkerError,
} from './index';

describe('WorkerError', () => {
  it('应该创建带默认状态码的基础错误', () => {
    const error = new WorkerError('Test error', 'TEST_ERROR');

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('WorkerError');
  });

  it('应该保留 details 字段', () => {
    const details = { field: 'email', reason: 'invalid' };
    const error = new WorkerError('Test error', 'TEST_ERROR', 400, details);

    expect(error.details).toEqual(details);
  });
});

describe('具体错误类型', () => {
  it('ValidationError 应该带 400 状态码', () => {
    const error = new ValidationError('Invalid input', { field: 'email' });

    expect(error).toBeInstanceOf(WorkerError);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.details).toEqual({ field: 'email' });
  });

  it('AuthenticationError 应该默认返回 Unauthorized', () => {
    const error = new AuthenticationError();

    expect(error.code).toBe('AUTHENTICATION_ERROR');
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Unauthorized');
  });

  it('NotFoundError 应该带资源名', () => {
    const error = new NotFoundError('User');

    expect(error.code).toBe('NOT_FOUND');
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe('User not found');
  });

  it('TimeoutError 应该包含超时时间', () => {
    const error = new TimeoutError('API call', 5000);

    expect(error.code).toBe('TIMEOUT_ERROR');
    expect(error.statusCode).toBe(504);
    expect(error.message).toContain('5000ms');
  });

  it('APIError 应该带 provider 信息', () => {
    const error = new APIError('Rate limit exceeded', 'deepseek', 429);

    expect(error.code).toBe('API_ERROR');
    expect(error.statusCode).toBe(429);
    expect(error.provider).toBe('deepseek');
    expect(error.details).toEqual({ provider: 'deepseek' });
  });
});
