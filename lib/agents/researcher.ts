import {
  type ModelMessage,
  smoothStream,
  stepCountIs,
  streamText,
  tool,
  type UIMessageStreamWriter
} from 'ai'

import type {
  ResearcherAgent,
  ResearcherRespondOptions,
  ResearcherResponse,
  ResearcherTools
} from '@/lib/types/agent'
import { type Model } from '@/lib/types/models'

import { fetchTool } from '../tools/fetch'
import { createQuestionTool } from '../tools/question'
import { createSearchTool } from '../tools/search'
import { createTodoTools } from '../tools/todo'
import { SearchMode } from '../types/search'
import { getModel } from '../utils/registry'
import { isTracingEnabled } from '../utils/telemetry'

import {
  ADAPTIVE_MODE_PROMPT,
  PLANNING_MODE_PROMPT,
  QUICK_MODE_PROMPT
} from './prompts/search-mode-prompts'

// Enhanced wrapper function with better type safety and streaming support
function wrapSearchToolForQuickMode<
  T extends ReturnType<typeof createSearchTool>
>(originalTool: T): T {
  return tool({
    description: originalTool.description,
    inputSchema: originalTool.inputSchema,
    async *execute(params, context) {
      const executeFunc = originalTool.execute
      if (!executeFunc) {
        throw new Error('Search tool execute function is not defined')
      }

      // Force optimized type for quick mode
      const modifiedParams = {
        ...params,
        type: 'optimized' as const
      }

      // Execute the original tool and pass through all yielded values
      const result = executeFunc(modifiedParams, context)

      // Handle AsyncIterable (streaming) case
      if (
        result &&
        typeof result === 'object' &&
        Symbol.asyncIterator in result
      ) {
        for await (const chunk of result) {
          yield chunk
        }
      } else {
        // Fallback for non-streaming (shouldn't happen with new implementation)
        const finalResult = await result
        yield finalResult || {
          state: 'complete' as const,
          results: [],
          images: [],
          query: params.query,
          number_of_results: 0
        }
      }
    }
  }) as T
}

// Enhanced researcher function with improved type safety
export function createResearcher({
  model,
  modelConfig,
  abortSignal,
  writer,
  parentTraceId,
  searchMode = 'adaptive'
}: {
  model: string
  modelConfig?: Model
  abortSignal?: AbortSignal
  writer?: UIMessageStreamWriter
  parentTraceId?: string
  searchMode?: SearchMode
}): ResearcherAgent {
  try {
    const currentDate = new Date().toLocaleString()

    // Create model-specific tools with proper typing
    const originalSearchTool = createSearchTool(model)
    const askQuestionTool = createQuestionTool(model)
    const todoTools = writer ? createTodoTools() : {}

    let systemPrompt: string
    let activeToolsList: (keyof ResearcherTools)[] = []
    let maxSteps: number
    let searchTool = originalSearchTool

    // Configure based on search mode
    switch (searchMode) {
      case 'quick':
        console.log(
          '[Researcher] Quick mode: maxSteps=20, tools=[search, fetch]'
        )
        systemPrompt = QUICK_MODE_PROMPT
        activeToolsList = ['search', 'fetch']
        maxSteps = 20
        searchTool = wrapSearchToolForQuickMode(originalSearchTool)
        break

      case 'planning':
        systemPrompt = PLANNING_MODE_PROMPT
        activeToolsList = ['search', 'fetch']
        if (writer && 'todoWrite' in todoTools) {
          activeToolsList.push('todoWrite', 'todoRead')
        }
        console.log(
          `[Researcher] Planning mode: maxSteps=50, tools=[${activeToolsList.join(', ')}]`
        )
        maxSteps = 50
        searchTool = originalSearchTool
        break

      case 'adaptive':
      default:
        systemPrompt = ADAPTIVE_MODE_PROMPT
        activeToolsList = ['search', 'fetch']
        if (writer && 'todoWrite' in todoTools) {
          activeToolsList.push('todoWrite', 'todoRead')
        }
        console.log(
          `[Researcher] Adaptive mode: maxSteps=50, tools=[${activeToolsList.join(', ')}]`
        )
        maxSteps = 50
        searchTool = originalSearchTool
        break
    }

    // Build tools object with proper typing
    const tools: ResearcherTools = {
      search: searchTool,
      fetch: fetchTool,
      askQuestion: askQuestionTool,
      ...todoTools
    } as ResearcherTools

    // Check if we should force todoWrite on first step
    const shouldForceTodoWrite =
      searchMode === 'planning' && writer && 'todoWrite' in todoTools

    // Create streamText-based agent with smoothStream support
    const agentConfig = {
      model: getModel(model),
      system: `${systemPrompt}\nCurrent date and time: ${currentDate}`,
      tools,
      activeTools: activeToolsList,
      stopWhen: stepCountIs(maxSteps),
      abortSignal,
      experimental_transform: smoothStream({ chunking: 'word' }), // Enable smooth streaming
      ...(modelConfig?.providerOptions && {
        providerOptions: modelConfig.providerOptions
      }),
      // Force todoWrite tool on first step for planning mode
      ...(shouldForceTodoWrite && {
        prepareStep: async ({ stepNumber }: { stepNumber: number }) => {
          if (stepNumber === 0) {
            return {
              toolChoice: { type: 'tool', toolName: 'todoWrite' } as const
            }
          }
          return undefined
        }
      }),
      experimental_telemetry: {
        isEnabled: isTracingEnabled(),
        functionId: 'research-agent',
        metadata: {
          modelId: model,
          agentType: 'researcher',
          searchMode,
          ...(parentTraceId && {
            langfuseTraceId: parentTraceId,
            langfuseUpdateParent: false
          })
        }
      }
    }

    // Create Agent-compatible wrapper with streamText
    const agent: ResearcherAgent = {
      tools,
      stream: ({ messages }: { messages: ModelMessage[] }) => {
        return streamText({
          ...agentConfig,
          messages
        })
      }
    }

    return agent
  } catch (error) {
    console.error('Error in createResearcher:', error)
    throw error
  }
}

// Helper function to access agent tools
export function getResearcherTools(agent: ResearcherAgent): ResearcherTools {
  return agent.tools
}

// Helper function to create a respond wrapper with type safety
export function createResearcherRespond(agent: ResearcherAgent) {
  return (options: ResearcherRespondOptions): ResearcherResponse => {
    if (!agent.respond) {
      throw new Error('respond method not available - use stream instead')
    }
    return agent.respond(options)
  }
}

// Export the legacy function name for backward compatibility
export const researcher = createResearcher
