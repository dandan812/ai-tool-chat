import type { Env } from '../types';

interface StoredObject {
  body: Uint8Array;
  options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  };
}

async function normalizeBody(value: unknown): Promise<Uint8Array> {
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

  if (value instanceof ReadableStream) {
    const reader = value.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) {
        break;
      }

      const normalizedChunk = chunk instanceof Uint8Array
        ? chunk
        : new Uint8Array(chunk);
      chunks.push(normalizedChunk);
      totalLength += normalizedChunk.byteLength;
    }

    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return merged;
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
      body: await normalizeBody(value),
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
    QWEN_API_KEY: 'test-qwen-key',
    CHUNK_STORAGE: chunkStorageNamespace as unknown as DurableObjectNamespace,
    UPLOADED_FILES: new MemoryR2Bucket() as unknown as R2Bucket,
    ...overrides,
  };
}
