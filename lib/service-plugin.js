import SubagentSelectionService from './selection-service.js'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import * as SubagentLock from './index.js'

export const name = 'dsh-subagent-tools-ui-service'
export const inject = ['agents', 'llm', 'tools', 'subagents', 'systemPrompt']

export function apply(ctx, config = {}) {
  const current = ctx.get('subagentTools')
  if (current === undefined) {
    new SubagentSelectionService(ctx, { multimodalModels: config.multimodalModels })
  } else {
    current.addMultimodalModels(config.multimodalModels)
  }

  const lockConfig = {
    ...(config.presetHints === undefined ? {} : { presetHints: config.presetHints }),
    ...(config.multimodalModels === undefined ? {} : { multimodalModels: config.multimodalModels }),
  }

  // Host wrap covers `subagents.start*` and any globally registered tools.
  ctx.plugin(SubagentLock, { ...lockConfig, toolName: 'subagent' })
  ctx.plugin(SubagentLock, { ...lockConfig, toolName: 'subagent_fork' })

  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.origin !== 'subagent') {
      // Official 0.1.5 tools are composed in the agent scope. Patch that
      // registry too; this still does not replace @deepseek-ai/dsh-tool-subagent.
      agent.ctx.plugin(SubagentLock, { ...lockConfig, toolName: 'subagent' })
      agent.ctx.plugin(SubagentLock, { ...lockConfig, toolName: 'subagent_fork' })
    }

    const { provider, model, reasoningEffort } = agent.options
    if (typeof provider !== 'string' || typeof model !== 'string' || typeof reasoningEffort !== 'string') return
    installModelSelection(agent.ctx, {
      current: { provider, model, reasoningEffort },
      assembled: undefined,
    })
  })
}
