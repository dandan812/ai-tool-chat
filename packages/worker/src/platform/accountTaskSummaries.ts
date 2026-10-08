import type { Task } from '../types';

/** A bounded account index, not the durable task record or the token ledger. */
export class AccountTaskSummaries {
  private readonly key: string;

  constructor(private readonly storage: DurableObjectStorage, userId: string) {
    this.key = 'summaries:' + userId;
  }

  async list(): Promise<Task[]> {
    return await this.storage.get<Task[]>(this.key) || [];
  }

  async update(source: Task): Promise<object> {
    const summary: Task = {
      id: source.id, type: source.type, status: source.status,
      userMessage: source.userMessage.slice(0, 120), steps: [],
      createdAt: source.createdAt, updatedAt: source.updatedAt,
    };
    const summaries = await this.list();
    await this.storage.put(this.key, [summary, ...summaries.filter(task => task.id !== summary.id)].slice(0, 100));
    return {};
  }
}
