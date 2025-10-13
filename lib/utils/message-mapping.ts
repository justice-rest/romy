import { generateId } from '@/lib/db/schema'
import type {
  UIDataTypes,
  UIMessage,
  UIMessageMetadata,
  UITools
} from '@/lib/types/ai'
import type { DynamicToolPart } from '@/lib/types/dynamic-tools'
import type {
  DBMessagePart,
  DBMessagePartSelect,
  ToolState
} from '@/lib/types/message-persistence'

// Define local types for message parts that are compatible with the AI SDK
type TextUIPart = { type: 'text'; text: string; providerMetadata?: any }
type ReasoningUIPart = {
  type: 'reasoning'
  text: string
  providerMetadata?: any
}
type FileUIPart = {
  type: 'file'
  mediaType: string
  filename?: string
  url: string
}
type SourceUrlUIPart = {
  type: 'source-url'
  sourceId: string
  url: string
  title: string
} // title is required
type SourceDocumentUIPart = {
  type: 'source-document'
  sourceId: string
  mediaType: string
  title: string
  filename: string
  url: string
  snippet: string
} // all fields required
type ToolCallPart = {
  type: 'tool-call'
  toolCallId: string
  toolName: string
  args: any
}
type ToolResultPart = {
  type: 'tool-result'
  toolCallId: string
  result: any
  isError?: boolean
}
type DataPart = { type: string; [key: string]: any }

type UIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | FileUIPart
  | SourceUrlUIPart
  | SourceDocumentUIPart
  | ToolCallPart
  | ToolResultPart
  | DataPart

// Type guards
function isToolCallPart(part: any): part is ToolCallPart {
  return (
    part.type === 'tool-call' &&
    typeof part.toolCallId === 'string' &&
    typeof part.toolName === 'string' &&
    part.args !== undefined
  )
}

function isToolResultPart(part: any): part is ToolResultPart {
  return (
    part.type === 'tool-result' &&
    typeof part.toolCallId === 'string' &&
    part.result !== undefined
  )
}

// Type for tool-specific parts with extended properties
type ExtendedToolPart = {
  type: string
  toolCallId?: string
  state?: ToolState
  errorText?: string
  input?: any
  output?: any
}

function isExtendedToolPart(part: any): part is ExtendedToolPart {
  return (
    typeof part === 'object' &&
    part !== null &&
    typeof part.type === 'string' &&
    part.type.startsWith('tool-')
  )
}

// Helper function to create tool part mapping
function createToolPartMapping(
  basePart: Omit<DBMessagePart, 'type'>,
  part: ExtendedToolPart,
  toolName: string
): DBMessagePart {
  const inputColumn = `tool_${toolName}_input` as keyof DBMessagePart
  const outputColumn = `tool_${toolName}_output` as keyof DBMessagePart

  return {
    ...basePart,
    type: part.type,
    tool_toolCallId: part.toolCallId || generateId(),
    tool_state: part.state || ('input-available' as ToolState),
    tool_errorText: part.errorText,
    [inputColumn]: part.input,
    [outputColumn]: part.output
  } as DBMessagePart
}

/**
 * Convert UI message parts to DB format
 */
export function mapUIMessagePartsToDBParts(
  messageParts: UIMessagePart[],
  messageId: string
): DBMessagePart[] {
  const mappedParts = messageParts.map((part, index): DBMessagePart | null => {
    const basePart = {
      messageId,
      order: index,
      type: part.type
    }

    switch (part.type) {
      case 'text':
        return {
          ...basePart,
          text_text: part.text
        }

      case 'reasoning':
        return {
          ...basePart,
          reasoning_text: part.text,
          providerMetadata: part.providerMetadata
        }

      case 'file':
        return {
          ...basePart,
          file_mediaType: part.mediaType,
          file_filename: part.filename,
          file_url: part.url
        }

      case 'source-url':
        return {
          ...basePart,
          source_url_sourceId: part.sourceId,
          source_url_url: part.url,
          source_url_title: part.title
        }

      case 'source-document':
        return {
          ...basePart,
          source_document_sourceId: part.sourceId,
          source_document_mediaType: part.mediaType,
          source_document_title: part.title,
          source_document_filename: part.filename,
          source_document_url: part.url,
          source_document_snippet: part.snippet
        }

      // Tool parts
      case 'tool-call':
        // Type guard ensures part has the required properties
        if (!isToolCallPart(part)) {
          console.error('Invalid tool-call part:', part)
          return null
        }
        const toolName = getToolNameFromType(part.toolName)
        const toolInputColumn = `tool_${toolName}_input` as keyof DBMessagePart

        const result = {
          ...basePart,
          type: `tool-${toolName}`,
          tool_toolCallId: part.toolCallId,
          tool_state: 'input-available' as ToolState,
          [toolInputColumn]: part.args
        } as DBMessagePart

        // Store additional metadata for dynamic tools
        if (toolName === 'dynamic') {
          result.tool_dynamic_name = part.toolName
          result.tool_dynamic_type = part.toolName.startsWith('mcp__')
            ? 'mcp'
            : 'dynamic'
        }

        return result

      case 'tool-result':
        const resultToolName = getToolNameFromCallId(
          part.toolCallId,
          messageParts
        )
        const toolOutputColumn =
          `tool_${resultToolName}_output` as keyof DBMessagePart

        const toolResult = {
          ...basePart,
          type: `tool-${resultToolName}`,
          tool_toolCallId: part.toolCallId,
          tool_state: part.isError
            ? 'output-error'
            : ('output-available' as ToolState),
          tool_errorText: part.isError ? String(part.result) : undefined,
          [toolOutputColumn]: !part.isError ? part.result : undefined
        } as DBMessagePart

        // Preserve dynamic tool metadata from the corresponding tool-call
        if (resultToolName === 'dynamic') {
          const toolCallPart = messageParts.find(
            p => isToolCallPart(p) && p.toolCallId === part.toolCallId
          ) as ToolCallPart | undefined

          if (toolCallPart) {
            toolResult.tool_dynamic_name = toolCallPart.toolName
            toolResult.tool_dynamic_type = toolCallPart.toolName.startsWith(
              'mcp__'
            )
              ? 'mcp'
              : 'dynamic'
          }
        }

        return toolResult

      // Step parts (for UI tracking)
      case 'step-start':
        // Persist step-start to maintain message structure
        return basePart

      case 'step-result':
      case 'step-continue':
      case 'step-finish':
        return null // These are not needed for message structure

      // Dynamic tool parts from AI SDK v5
      case 'dynamic-tool':
        const dynamicPart = part as DynamicToolPart
        return {
          ...basePart,
          type: 'tool-dynamic',
          tool_toolCallId: dynamicPart.toolCallId || generateId(),
          tool_state: dynamicPart.state as ToolState,
          tool_dynamic_name: dynamicPart.toolName,
          tool_dynamic_type: dynamicPart.toolName.startsWith('mcp__')
            ? 'mcp'
            : 'dynamic',
          tool_dynamic_input: dynamicPart.input,
          tool_dynamic_output:
            dynamicPart.state === 'output-available'
              ? dynamicPart.output
              : undefined,
          tool_errorText:
            dynamicPart.state === 'output-error'
              ? dynamicPart.errorText
              : undefined
        }

      // Tool-specific parts that are not tool-call or tool-result
      // The following cases are tool parts with state tracking
      case 'tool-search':
        if (!isExtendedToolPart(part)) {
          console.error('Invalid extended tool part:', part)
          return null
        }
        return createToolPartMapping(basePart, part, 'search')

      case 'tool-fetch':
        if (!isExtendedToolPart(part)) {
          console.error('Invalid extended tool part:', part)
          return null
        }
        return createToolPartMapping(basePart, part, 'fetch')

      case 'tool-question':
        if (!isExtendedToolPart(part)) {
          console.error('Invalid extended tool part:', part)
          return null
        }
        return createToolPartMapping(basePart, part, 'question')

      case 'tool-todoWrite':
        if (!isExtendedToolPart(part)) {
          console.error('Invalid extended tool part:', part)
          return null
        }
        return createToolPartMapping(basePart, part, 'todoWrite')

      case 'tool-todoRead':
        if (!isExtendedToolPart(part)) {
          console.error('Invalid extended tool part:', part)
          return null
        }
        return createToolPartMapping(basePart, part, 'todoRead')

      // Data parts
      default:
        if (part.type.startsWith('data-')) {
          const dataType = part.type.substring(5) // Remove 'data-' prefix
          return {
            ...basePart,
            data_prefix: dataType,
            data_content: 'data' in part ? part.data : part,
            data_id: 'id' in part ? part.id : undefined
          }
        }

        // Unknown part type - store as data
        return {
          ...basePart,
          data_prefix: part.type,
          data_content: part
        }
    }
  })

  // Filter out null values and re-index
  return mappedParts
    .filter((part): part is DBMessagePart => part !== null)
    .map((part, index) => ({ ...part, order: index }))
}

/**
 * Convert DB message parts to UI format
 */
export function mapDBPartToUIMessagePart(
  part: DBMessagePartSelect
): UIMessagePart {
  switch (part.type) {
    case 'text':
      return {
        type: 'text',
        text: part.text_text || ''
      }

    case 'reasoning':
      return {
        type: 'reasoning',
        text: part.reasoning_text || '',
        providerMetadata: part.providerMetadata
      }

    case 'file':
      return {
        type: 'file',
        mediaType: part.file_mediaType || '',
        filename: part.file_filename || '',
        url: part.file_url || ''
      }

    case 'source-url':
      return {
        type: 'source-url',
        sourceId: part.source_url_sourceId || '',
        url: part.source_url_url || '',
        title: part.source_url_title || ''
      }

    case 'source-document':
      return {
        type: 'source-document',
        sourceId: part.source_document_sourceId || '',
        mediaType: part.source_document_mediaType || '',
        title: part.source_document_title || '',
        filename: part.source_document_filename || '',
        url: part.source_document_url || '',
        snippet: part.source_document_snippet || ''
      }

    default:
      // Tool parts
      if (part.type.startsWith('tool-')) {
        const toolName = part.type.substring(5) // Remove 'tool-' prefix
        const inputColumn =
          `tool_${toolName}_input` as keyof DBMessagePartSelect
        const outputColumn =
          `tool_${toolName}_output` as keyof DBMessagePartSelect

        // Special handling for dynamic tools
        if (toolName === 'dynamic') {
          return {
            type: 'dynamic-tool',
            toolCallId: part.tool_toolCallId || '',
            toolName: part.tool_dynamic_name || '',
            state: part.tool_state as any, // Maps directly to AI SDK states
            input: part.tool_dynamic_input,
            output: part.tool_dynamic_output,
            errorText: part.tool_errorText
          }
        }

        // Special handling for tool parts that maintain their type
        if (toolName === 'search') {
          if (!part.tool_state) {
            throw new Error(`tool_state is undefined for ${toolName}`)
          }

          switch (part.tool_state) {
            case 'input-streaming':
              return {
                type: 'tool-search',
                state: 'input-streaming',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_search_input!
              }
            case 'input-available':
              return {
                type: 'tool-search',
                state: 'input-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_search_input!
              }
            case 'output-available':
              return {
                type: 'tool-search',
                state: 'output-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_search_input!,
                output: part.tool_search_output!
              }
            case 'output-error':
              return {
                type: 'tool-search',
                state: 'output-error',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_search_input!,
                errorText: part.tool_errorText!
              }
            default:
              throw new Error(`Unknown tool state: ${part.tool_state}`)
          }
        }

        if (toolName === 'fetch') {
          if (!part.tool_state) {
            throw new Error(`tool_state is undefined for ${toolName}`)
          }

          switch (part.tool_state) {
            case 'input-streaming':
              return {
                type: 'tool-fetch',
                state: 'input-streaming',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_fetch_input!
              }
            case 'input-available':
              return {
                type: 'tool-fetch',
                state: 'input-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_fetch_input!
              }
            case 'output-available':
              return {
                type: 'tool-fetch',
                state: 'output-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_fetch_input!,
                output: part.tool_fetch_output!
              }
            case 'output-error':
              return {
                type: 'tool-fetch',
                state: 'output-error',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_fetch_input!,
                errorText: part.tool_errorText!
              }
            default:
              throw new Error(`Unknown tool state: ${part.tool_state}`)
          }
        }

        if (toolName === 'question') {
          if (!part.tool_state) {
            throw new Error(`tool_state is undefined for ${toolName}`)
          }

          switch (part.tool_state) {
            case 'input-streaming':
              return {
                type: 'tool-question',
                state: 'input-streaming',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_question_input!
              }
            case 'input-available':
              return {
                type: 'tool-question',
                state: 'input-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_question_input!
              }
            case 'output-available':
              return {
                type: 'tool-question',
                state: 'output-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_question_input!,
                output: part.tool_question_output!
              }
            case 'output-error':
              return {
                type: 'tool-question',
                state: 'output-error',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_question_input!,
                errorText: part.tool_errorText!
              }
            default:
              throw new Error(`Unknown tool state: ${part.tool_state}`)
          }
        }

        if (toolName === 'todoWrite') {
          if (!part.tool_state) {
            throw new Error(`tool_state is undefined for ${toolName}`)
          }

          switch (part.tool_state) {
            case 'input-streaming':
              return {
                type: 'tool-todoWrite',
                state: 'input-streaming',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_todoWrite_input!
              }
            case 'input-available':
              return {
                type: 'tool-todoWrite',
                state: 'input-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_todoWrite_input!
              }
            case 'output-available':
              return {
                type: 'tool-todoWrite',
                state: 'output-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_todoWrite_input!,
                output: part.tool_todoWrite_output!
              }
            case 'output-error':
              return {
                type: 'tool-todoWrite',
                state: 'output-error',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_todoWrite_input!,
                errorText: part.tool_errorText!
              }
            default:
              throw new Error(`Unknown tool state: ${part.tool_state}`)
          }
        }

        if (toolName === 'todoRead') {
          if (!part.tool_state) {
            throw new Error(`tool_state is undefined for ${toolName}`)
          }

          switch (part.tool_state) {
            case 'input-streaming':
              return {
                type: 'tool-todoRead',
                state: 'input-streaming',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_todoRead_input!
              }
            case 'input-available':
              return {
                type: 'tool-todoRead',
                state: 'input-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_todoRead_input!
              }
            case 'output-available':
              return {
                type: 'tool-todoRead',
                state: 'output-available',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_todoRead_input!,
                output: part.tool_todoRead_output!
              }
            case 'output-error':
              return {
                type: 'tool-todoRead',
                state: 'output-error',
                toolCallId: part.tool_toolCallId || '',
                input: part.tool_todoRead_input!,
                errorText: part.tool_errorText!
              }
            default:
              throw new Error(`Unknown tool state: ${part.tool_state}`)
          }
        }

        // Standard tool-call/tool-result pattern
        if (
          part.tool_state === 'input-available' ||
          part.tool_state === 'input-streaming'
        ) {
          // For dynamic tools, use the stored original name
          const originalToolName =
            toolName === 'dynamic' && part.tool_dynamic_name
              ? part.tool_dynamic_name
              : getOriginalToolName(toolName)

          return {
            type: 'tool-call',
            toolCallId: part.tool_toolCallId || '',
            toolName: originalToolName,
            args: part[inputColumn] as any
          }
        } else {
          // output-available or output-error
          return {
            type: 'tool-result',
            toolCallId: part.tool_toolCallId || '',
            isError: part.tool_state === 'output-error',
            result:
              part.tool_state === 'output-error'
                ? part.tool_errorText
                : part[outputColumn]
          }
        }
      }

      // Step parts
      if (part.type === 'step-start') {
        return {
          type: 'step-start'
        }
      }

      // Data parts
      if (part.data_prefix) {
        return {
          type: `data-${part.data_prefix}`,
          data: part.data_content,
          ...(part.data_id ? { id: part.data_id } : {})
        }
      }

      // Fallback - should not happen
      throw new Error(`Unknown part type: ${part.type}`)
  }
}

/**
 * Normalize tool name (from tool-call's toolName)
 */
function getToolNameFromType(toolName: string): string {
  // Map original tool names to DB column names
  const toolNameMap: Record<string, string> = {
    search: 'search',
    fetch: 'fetch',
    askQuestion: 'question',
    question: 'question',
    todoWrite: 'todoWrite',
    todoRead: 'todoRead'
  }

  // For dynamic tools (MCP and others)
  if (toolName.startsWith('mcp__') || toolName.startsWith('dynamic__')) {
    return 'dynamic'
  }

  return toolNameMap[toolName] || toolName
}

/**
 * Get tool name from tool-result
 */
function getToolNameFromCallId(
  toolCallId: string,
  allParts: UIMessagePart[]
): string {
  // Find tool-call part with the same toolCallId
  const toolCallPart = allParts.find(
    part => part.type === 'tool-call' && part.toolCallId === toolCallId
  ) as any

  if (toolCallPart) {
    return getToolNameFromType(toolCallPart.toolName)
  }

  // Fallback - should not happen
  return 'unknown'
}

/**
 * Convert DB column name back to original tool name
 */
function getOriginalToolName(dbToolName: string): string {
  const reverseMap: Record<string, string> = {
    search: 'search',
    fetch: 'fetch',
    question: 'askQuestion',
    todoWrite: 'todoWrite',
    todoRead: 'todoRead',
    dynamic: 'dynamic' // For dynamic tools, the actual tool name is stored separately
  }

  return reverseMap[dbToolName] || dbToolName
}

/**
 * Convert UI message to DB message (excluding parts)
 */
export function mapUIMessageToDBMessage(
  message: UIMessage & { id: string; chatId: string }
): {
  id: string
  chatId: string
  role: string
  metadata?: UIMessageMetadata | null
} {
  return {
    id: message.id,
    chatId: message.chatId,
    role: message.role,
    metadata: message.metadata || null
  }
}

/**
 * Build UI message from DB message and parts
 */
export function buildUIMessageFromDB(
  dbMessage: {
    id: string
    role: string
    metadata?: UIMessageMetadata | null
    createdAt?: Date | string
  },
  dbParts: DBMessagePartSelect[]
): UIMessage {
  // Merge metadata from DB with createdAt
  const metadata: UIMessageMetadata = {
    ...(dbMessage.metadata || {}),
    ...(dbMessage.createdAt && {
      createdAt:
        dbMessage.createdAt instanceof Date
          ? dbMessage.createdAt
          : new Date(dbMessage.createdAt)
    })
  }

  return {
    id: dbMessage.id,
    role: dbMessage.role as 'user' | 'assistant',
    parts: dbParts.map(mapDBPartToUIMessagePart) as UIMessage['parts'],
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined
  }
}
