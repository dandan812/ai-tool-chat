import type { ChatMessage } from '../types/task'

export function buildHistoryMessages(messages: ChatMessage[]): Array<Pick<ChatMessage, 'role' | 'content'>> {
  return messages
    .filter((message) => message.role !== 'system' && message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }))
}

export function buildRequestMessages(
  messages: ChatMessage[],
  userMessage: ChatMessage,
): Array<Pick<ChatMessage, 'role' | 'content'>> {
  return [...buildHistoryMessages(messages), userMessage]
}
