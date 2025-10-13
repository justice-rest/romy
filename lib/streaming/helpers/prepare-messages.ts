import { UIMessage } from 'ai'

import {
  createChat,
  createChatWithFirstMessage,
  deleteMessagesFromIndex,
  loadChat,
  upsertMessage
} from '@/lib/actions/chat'
import { generateId } from '@/lib/db/schema'
import { perfLog, perfTime } from '@/lib/utils/perf-logging'

import type { StreamContext } from './types'

const DEFAULT_CHAT_TITLE = 'Untitled'

export async function prepareMessages(
  context: StreamContext,
  message: UIMessage | null
): Promise<UIMessage[]> {
  const { chatId, userId, trigger, messageId, initialChat, isNewChat } = context
  const startTime = performance.now()
  perfLog(`prepareMessages - Start: trigger=${trigger}, isNewChat=${isNewChat}`)

  if (trigger === 'regenerate-message' && messageId) {
    // Handle regeneration - use initialChat if available to avoid DB call
    let currentChat = initialChat
    if (!currentChat) {
      currentChat = await loadChat(chatId, userId)
    }
    if (!currentChat || !currentChat.messages.length) {
      throw new Error('No messages found')
    }

    let messageIndex = currentChat.messages.findIndex(
      (m: any) => m.id === messageId
    )

    // Fallback: If message not found by ID, try to find by position
    if (messageIndex === -1) {
      const lastAssistantIndex = currentChat.messages.findLastIndex(
        (m: any) => m.role === 'assistant'
      )
      const lastUserIndex = currentChat.messages.findLastIndex(
        (m: any) => m.role === 'user'
      )

      if (lastAssistantIndex >= 0 || lastUserIndex >= 0) {
        messageIndex = Math.max(lastAssistantIndex, lastUserIndex)
      } else {
        throw new Error(
          `Message ${messageId} not found and no fallback available`
        )
      }
    }

    const targetMessage = currentChat.messages[messageIndex]
    if (targetMessage.role === 'assistant') {
      await deleteMessagesFromIndex(chatId, messageId, userId)
      return currentChat.messages.slice(0, messageIndex)
    } else {
      // User message edit
      if (message && message.id === messageId) {
        await upsertMessage(chatId, message, userId)
      }
      const messagesToDelete = currentChat.messages.slice(messageIndex + 1)
      if (messagesToDelete.length > 0) {
        await deleteMessagesFromIndex(chatId, messagesToDelete[0].id, userId)
      }
      const updatedChat = await loadChat(chatId, userId)
      return (
        updatedChat?.messages || currentChat.messages.slice(0, messageIndex + 1)
      )
    }
  } else {
    // Handle normal message submission
    if (!message) {
      throw new Error('No message provided')
    }

    const messageWithId = {
      ...message,
      id: message.id || generateId()
    }

    // Optimize for new chats: create chat and save message together
    if (isNewChat) {
      // Persist the chat and first message optimistically in the background
      const createStart = performance.now()
      const persistencePromise = createChatWithFirstMessage(
        chatId,
        messageWithId,
        userId,
        DEFAULT_CHAT_TITLE
      )
        .then(result => {
          perfTime('createChatWithFirstMessage completed', createStart)
          perfTime('prepareMessages - Total', startTime)
          return result
        })
        .catch(error => {
          console.error('Error creating chat with first message:', error)
          throw error
        })

      context.pendingInitialSave = persistencePromise
      context.pendingInitialUserMessage = messageWithId

      perfTime('prepareMessages - Return (optimistic)', startTime)
      return [messageWithId]
    }

    // For existing chats
    if (!initialChat) {
      const createStart = performance.now()
      await createChat(chatId, DEFAULT_CHAT_TITLE, userId)
      perfTime('createChat completed', createStart)
    }

    const upsertStart = performance.now()
    await upsertMessage(chatId, messageWithId, userId)
    perfTime('upsertMessage completed', upsertStart)

    // If we have initialChat, append the new message instead of fetching all messages
    if (initialChat && initialChat.messages) {
      perfTime('prepareMessages - Total (using cached chat)', startTime)
      return [...initialChat.messages, messageWithId]
    }

    // Fallback to fetching if no initialChat
    const loadStart = performance.now()
    const updatedChat = await loadChat(chatId, userId)
    perfTime('loadChat (fallback) completed', loadStart)
    perfTime('prepareMessages - Total', startTime)
    return updatedChat?.messages || [messageWithId]
  }
}
