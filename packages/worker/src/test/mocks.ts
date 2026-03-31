import type { Env } from '../types';

interface StoredObject {
  body: Uint8Array;
  options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  };
}

function normalizeBody(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (typeof value === 'string') {
    return new TextEncoder().encode(value);
  }

  if (value instanceof Blob) {
    throw new Error('测试环境不支持直接存储 Blob，请先转为 ArrayBuffer');
  }

  return new Uint8Array();
}

export class MemoryR2Bucket {
  private objects = new Map<string, StoredObject>();

  async put(
    key: string,
    value: unknown,
    options?: StoredObject['options'],
  ): Promise<void> {
    this.objects.set(key, {
      body: normalizeBody(value),
      options,
    });
  }

  async get(key: string): Promise<{
    text: () => Promise<string>;
    arrayBuffer: () => Promise<ArrayBuffer>;
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  } | null> {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }

    return {
      text: async () => new TextDecoder().decode(object.body),
      arrayBuffer: async () => object.body.buffer.slice(
        object.body.byteOffset,
        object.body.byteOffset + object.body.byteLength,
      ),
      httpMetadata: object.options?.httpMetadata,
      customMetadata: object.options?.customMetadata,
    };
  }

  async head(key: string): Promise<{ key: string } | null> {
    return this.objects.has(key) ? { key } : null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

export class MemoryDurableObjectStorage {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? '';
    const entries = [...this.data.entries()].filter(([key]) => key.startsWith(prefix));
    return new Map(entries) as Map<string, T>;
  }

  async transaction<T>(
    callback: (txn: MemoryDurableObjectStorage) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }
}

export class MemoryDurableObjectState {
  storage = new MemoryDurableObjectStorage();
}

export function createMockEnv(overrides: Partial<Env> = {}): Env {
  const chunkStorageNamespace = {
    idFromName: (name: string) => name,
    get: () => {
      throw new Error('测试中未注入 Durable Object stub');
    },
  };

  return {
    DEEPSEEK_API_KEY: 'test-deepseek-key',
    QWEN_API_KEY: 'test-qwen-key',
    OPENAI_API_KEY: 'test-openai-key',
    CHUNK_STORAGE: chunkStorageNamespace as unknown as DurableObjectNamespace,
    UPLOADED_FILES: new MemoryR2Bucket() as unknown as R2Bucket,
    ...overrides,
  };
}
