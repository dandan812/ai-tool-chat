/**
 * ChunkStorage Durable Object
 * 暂时保留以兼容旧的部署，将被删除
 */
export class ChunkStorage implements DurableObject {
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    return new Response('Not implemented', { status: 501 });
  }
}
