export interface TaskStreamEvent {
  type: 'task' | 'step' | 'content' | 'error' | 'complete' | 'sources' | 'usage';
  data: unknown;
}
