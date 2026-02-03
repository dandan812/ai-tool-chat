/**
 * 错误类型单元测试
 */

import {
  WorkerError,
  ValidationError,
  AuthenticationError,
  NotFoundError,
  TimeoutError,
  APIError,
} from './index';

// 测试框架
function describe(name: string, fn: () => void) {
  console.log(`\n📦 ${name}`);
  fn();
}

function it(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.log(`  ❌ ${name}: ${(err as Error).message}`);
  }
}

function expect(actual: unknown) {
  return {
    toBe(expected: unknown) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toEqual(expected: unknown) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeInstanceOf(expected: new (...args: unknown[]) => unknown) {
      if (!(actual instanceof expected)) {
        throw new Error(`Expected instance of ${expected.name}`);
      }
    },
    toMatchObject(expected: Record<string, unknown>) {
      const actualObj = actual as Record<string, unknown>;
      for (const key of Object.keys(expected)) {
        if (actualObj[key] !== expected[key]) {
          throw new Error(`Expected ${key} to be ${expected[key]} but got ${actualObj[key]}`);
        }
      }
    },
  };
}

describe('WorkerError', () => {
  it('should create WorkerError with default status', () => {
    const error = new WorkerError('Test error', 'TEST_ERROR');
    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe('WorkerError');
  });

  it('should create WorkerError with custom status', () => {
    const error = new WorkerError('Test error', 'TEST_ERROR', 400);
    expect(error.statusCode).toBe(400);
  });

  it('should create WorkerError with details', () => {
    const details = { field: 'email', reason: 'invalid' };
    const error = new WorkerError('Test error', 'TEST_ERROR', 400, details);
    expect(error.details).toEqual(details);
  });

  it('should be instance of Error', () => {
    const error = new WorkerError('Test', 'TEST');
    expect(error).toBeInstanceOf(Error);
  });
});

describe('ValidationError', () => {
  it('should create ValidationError', () => {
    const error = new ValidationError('Invalid input');
    expect(error.message).toBe('Invalid input');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('ValidationError');
  });

  it('should create ValidationError with details', () => {
    const error = new ValidationError('Invalid input', { field: 'email' });
    expect(error.details).toEqual({ field: 'email' });
  });

  it('should be instance of WorkerError', () => {
    const error = new ValidationError('Test');
    expect(error).toBeInstanceOf(WorkerError);
  });
});

describe('AuthenticationError', () => {
  it('should create AuthenticationError with default message', () => {
    const error = new AuthenticationError();
    expect(error.message).toBe('Unauthorized');
    expect(error.code).toBe('AUTHENTICATION_ERROR');
    expect(error.statusCode).toBe(401);
  });

  it('should create AuthenticationError with custom message', () => {
    const error = new AuthenticationError('Invalid token');
    expect(error.message).toBe('Invalid token');
  });
});

describe('NotFoundError', () => {
  it('should create NotFoundError', () => {
    const error = new NotFoundError('User');
    expect(error.message).toBe('User not found');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.statusCode).toBe(404);
  });
});

describe('TimeoutError', () => {
  it('should create TimeoutError', () => {
    const error = new TimeoutError('API call', 5000);
    expect(error.message).toBe('API call timeout after 5000ms');
    expect(error.code).toBe('TIMEOUT_ERROR');
    expect(error.statusCode).toBe(504);
  });
});

describe('APIError', () => {
  it('should create APIError', () => {
    const error = new APIError('Rate limit exceeded', 'deepseek', 429);
    expect(error.message).toBe('Rate limit exceeded');
    expect(error.code).toBe('API_ERROR');
    expect(error.statusCode).toBe(429);
    expect(error.provider).toBe('deepseek');
    expect(error.details).toEqual({ provider: 'deepseek' });
  });
});

console.log('🧪 Running Error Types Tests...');
