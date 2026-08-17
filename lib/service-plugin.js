import SubagentSelectionService from './selection-service.js'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import * as EnhancedSubagentTools from './index.js'

export const name = 'dsh-subagent-tools-ui-service'
export const inject = ['agents', 'llm', 'tools', 'subagents', 'systemPrompt']

const ROOT_TOOL_CONFIGS = [
  {
    provider: 'spawn',
    toolName: 'subagent',
    enableRunInBackground: true,
    backgroundMode: 'continuable',
    maxDepth: 3,
  },
  {
    provider: 'fork',
    toolName: 'subagent_fork',
    enableRunInBackground: true,
    backgroundMode: 'continuable',
    maxDepth: 3,
  },
]

export function apply(ctx, config = {}) {
  const current = ctx.get('subagentTools')
  if (current === undefined) {
    new SubagentSelectionService(ctx, { multimodalModels: config.multimodalModels })
  } else {
    current.addMultimodalModels(config.multimodalModels)
  }

  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.origin !== 'subagent') {
      for (const toolConfig of ROOT_TOOL_CONFIGS) {
        agent.ctx.plugin(EnhancedSubagentTools, toolConfig)
      }
    }

    const { provider, model, reasoningEffort } = agent.options
    if (typeof provider !== 'string' || typeof model !== 'string' || typeof reasoningEffort !== 'string') return
    installModelSelection(agent.ctx, {
      current: { provider, model, reasoningEffort },
      assembled: undefined,
    })
  })
}
