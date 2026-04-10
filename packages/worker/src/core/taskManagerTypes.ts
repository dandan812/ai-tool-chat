export interface TaskStreamEvent {
  type: 'task' | 'step' | 'content' | 'error' | 'complete';
  data: unknown;
}

export interface SkillExecutionResult {
  success: boolean;
  content: string;
  error?: string;
}
