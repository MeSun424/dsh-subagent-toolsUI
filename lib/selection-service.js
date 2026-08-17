import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

const DEFAULT_STATE = Object.freeze({
  mode: 'inherit',
  provider: undefined,
  model: undefined,
  modelName: '继承',
  reasoningEfforts: [],
  supportsMultimodal: false,
})

// The process-level Web service and preset-owned tool plugins can live in
// isolated Cordis scopes. They still load this module once, so this backend is
// the narrow bridge that keeps their per-agent routing and availability in
// sync without registering either contribution globally.
const SHARED = {
  states: new Map(),
  toolDefinitions: new Map(),
  multimodalModels: new Set(),
}

function copyState(state) {
  return {
    mode: state.mode,
    ...(state.provider === undefined ? {} : { provider: state.provider }),
    ...(state.model === undefined ? {} : { model: state.model }),
    modelName: state.modelName,
    reasoningEfforts: [...state.reasoningEfforts],
    supportsMultimodal: state.supportsMultimodal === true,
  }
}

function routeLabel(provider, model) {
  return provider === undefined || model === undefined ? '继承' : provider + '/' + model
}

function normalizeEfforts(info) {
  return Array.isArray(info?.reasoning?.efforts)
    ? info.reasoning.efforts
      .map((effort) => typeof effort?.id === 'string' ? effort.id : undefined)
      .filter((id) => id !== undefined)
    : []
}

function supportsImages(info) {
  // Missing modality metadata is deliberately treated as text-only.
  return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
}

function makeNotice(state, changed) {
  const model = state.mode === 'inherit'
    ? '继承主模型 ' + state.modelName + ' (' + state.provider + '/' + state.model + ')'
    : state.modelName + ' (' + state.provider + '/' + state.model + ')'
  const efforts = state.reasoningEfforts.length > 0 ? state.reasoningEfforts.join(', ') : '未提供可确认的档位'
  const modality = state.supportsMultimodal ? '支持图片输入' : '不支持图片输入（未知能力按不支持处理）'
  return (changed ? '子代理模型已更新。' : '子代理调度能力已就绪。')
    + ' 当前模型：' + model + '；支持思考档位：' + efforts + '；' + modality
    + '。需要视觉任务时，只派给明确标记支持图片输入的子代理，否则由主模型处理或拆分任务。'
}

/** Host-side per-parent selection state and model capability snapshot. */
export class SubagentSelectionService extends TypertRemoteService {
  static inject = ['agents', 'llm']

  constructor(ctx, config = {}) {
    super(ctx, 'subagentTools')
    this.states = SHARED.states
    this.toolDefinitions = SHARED.toolDefinitions
    this.multimodalModels = SHARED.multimodalModels
    this.addMultimodalModels(config.multimodalModels)
    ctx.on('agent/disposed', ({ agent }) => {
      this.states.delete(agent.id)
    })
    ctx.on('agent/session-start', ({ agent }) => {
      const announce = agent.session.header.origin !== 'subagent' && this.availableFor(agent)
      void this.refreshInherited(agent, announce)
    })
  }

  addMultimodalModels(models) {
    if (!Array.isArray(models)) return
    for (const model of models) {
      if (typeof model === 'string' && model.length > 0) this.multimodalModels.add(model)
    }
  }

  registerTool(name, definition) {
    let definitions = this.toolDefinitions.get(name)
    if (definitions === undefined) {
      definitions = new Set()
      this.toolDefinitions.set(name, definitions)
    }
    definitions.add(definition)
    return () => {
      definitions.delete(definition)
      if (definitions.size === 0) this.toolDefinitions.delete(name)
    }
  }

  availableFor(agent) {
    for (const [name, definitions] of this.toolDefinitions) {
      if (definitions.has(this.ctx.tools.get(name, agent))) return true
    }
    return false
  }

  /** Only one active enhanced tool should describe the shared model route. */
  ownsRoutingPrompt(name, definition, agent) {
    const names = [...this.toolDefinitions.keys()].sort()
    for (const candidateName of names) {
      const definitions = this.toolDefinitions.get(candidateName)
      const active = this.ctx.tools.get(candidateName, agent)
      if (definitions?.has(active)) {
        return candidateName === name && active === definition
      }
    }
    return false
  }

  defaultState() {
    return copyState(DEFAULT_STATE)
  }

  stateFor(agent) {
    const current = this.states.get(agent.id)
    return {
      ...(current === undefined ? this.defaultState() : copyState(current)),
      available: this.availableFor(agent),
    }
  }

  promptText(agent) {
    const state = this.stateFor(agent)
    const route = state.mode === 'inherit'
      ? 'inherit the parent route ' + state.modelName + ' (' + routeLabel(state.provider, state.model) + ')'
      : state.provider + '/' + state.model
    const efforts = state.reasoningEfforts.length > 0
      ? state.reasoningEfforts.join(', ')
      : 'no confirmed effort list; omit reasoningEffort unless the provider documents one'
    const modality = state.supportsMultimodal
      ? 'confirmed image input support'
      : 'no confirmed image input support'
    return 'User-controlled subagent scheduling state: model route = ' + route + '; supported reasoning efforts = ' + efforts
      + '; modality = ' + modality + '. This model route is locked for newly created subagents until the user changes it. '
      + 'Choose reasoningEffort independently for each delegation according to task difficulty and pass it in the subagent tool call. '
      + 'Never infer image support from a model name. Unknown capability means no image support: keep visual work in the parent '
      + 'or convert it to a complete text-only task. A later user model switch applies only to newly created subagents; running '
      + 'subagents continue with the route captured at creation.'
  }

  async refreshInherited(agent, announce) {
    const current = this.states.get(agent.id)
    if (current !== undefined && current.mode !== 'inherit') return this.stateFor(agent)
    const provider = agent.options?.provider
    const model = agent.options?.model
    let modelName = routeLabel(provider, model)
    let reasoningEfforts = []
    let supportsMultimodal = false
    if (provider !== undefined && model !== undefined) {
      try {
        const info = await this.ctx.llm.resolveModelInfo(provider, model)
        modelName = info.name || modelName
        reasoningEfforts = normalizeEfforts(info)
        supportsMultimodal = supportsImages(info) || this.multimodalModels.has(provider + '/' + model)
      } catch {
        // Model metadata is advisory. Routing still follows the parent's model.
      }
    }
    const state = {
      mode: 'inherit',
      provider,
      model,
      modelName,
      reasoningEfforts,
      supportsMultimodal,
    }
    this.states.set(agent.id, state)
    if (announce) agent.inject(createUserMessage({
      content: [{ type: 'text', text: makeNotice(state, false) }],
      source: { kind: 'plugin', plugin: 'dsh-subagent-tools-ui', form: 'notice', summary: '子代理模型能力信息已更新' },
    }))
    return this.stateFor(agent)
  }

  async get(agent) {
    const state = this.states.get(agent.id)
    if (state === undefined || state.mode === 'inherit') return this.refreshInherited(agent, false)
    return this.stateFor(agent)
  }

  async set(agent, request) {
    if (request?.mode === 'inherit') {
      const state = {
        mode: 'inherit',
        provider: agent.options?.provider,
        model: agent.options?.model,
        modelName: routeLabel(agent.options?.provider, agent.options?.model),
        reasoningEfforts: [],
        supportsMultimodal: false,
      }
      this.states.set(agent.id, state)
      const refreshed = await this.refreshInherited(agent, false)
      agent.inject(createUserMessage({
        content: [{ type: 'text', text: makeNotice(refreshed, true) }],
        source: { kind: 'plugin', plugin: 'dsh-subagent-tools-ui', form: 'notice', summary: '子代理模型已切换为继承主模型' },
      }))
      return refreshed
    }
    if (request?.mode !== 'fixed'
      || typeof request.provider !== 'string' || request.provider.length === 0
      || typeof request.model !== 'string' || request.model.length === 0) {
      throw new Error('dsh-subagent-tools-ui: fixed selection requires non-empty provider and model')
    }
    let info
    try {
      info = await this.ctx.llm.resolveModelInfo(request.provider, request.model)
    } catch {
      info = undefined
    }
    const state = {
      mode: 'fixed',
      provider: request.provider,
      model: request.model,
      modelName: info?.name || request.model,
      reasoningEfforts: normalizeEfforts(info),
      supportsMultimodal: supportsImages(info) || this.multimodalModels.has(request.provider + '/' + request.model),
    }
    this.states.set(agent.id, state)
    const result = this.stateFor(agent)
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: makeNotice(result, true) }],
      source: { kind: 'plugin', plugin: 'dsh-subagent-tools-ui', form: 'notice', summary: '子代理模型已切换为 ' + result.modelName },
    }))
    return result
  }

  /** Resolve the user-owned route without mutating already-created children. */
  async delegation(agent) {
    const state = await this.get(agent)
    if (state.provider === undefined || state.model === undefined) return undefined
    return { provider: state.provider, model: state.model }
  }
}

// Typert decorators use the standard ECMAScript decorator context. This keeps
// the package usable without requiring a TypeScript build during local edits.
const setRemote = Remote('set')
const getRemote = Remote('get')
function applyRemoteMarker(method, decorator) {
  let initializer
  const context = {
    kind: 'method',
    name: method,
    static: false,
    private: false,
    access: { has: (object) => method in object, get: (object) => object[method] },
    addInitializer(value) {
      initializer = value
    },
  }
  decorator(SubagentSelectionService.prototype[method], context)
  if (initializer === undefined) throw new Error('dsh-subagent-tools-ui: failed to mark Remote method ' + method)
  initializer.call(Object.create(SubagentSelectionService.prototype))
}

applyRemoteMarker('set', setRemote)
applyRemoteMarker('get', getRemote)

export default SubagentSelectionService
