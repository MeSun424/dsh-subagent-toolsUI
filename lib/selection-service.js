import { parentModelRoute } from './lock.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { resolvePersona } from './persona.js'
import { allowlistAllows, applyLockToAgentOptions, callContext } from './lock.js'

const DEFAULT_STATE = Object.freeze({
  mode: 'inherit',
  provider: undefined,
  model: undefined,
  modelName: '继承',
  reasoningEfforts: [],
  supportsMultimodal: false,
  allowlistEnforced: false,
  allowedRoutes: [],
})

// Preset and host scopes share state only within the same Harness root.
// Weak keys let an unloaded host release its entire registry.
const sharedRoots = new WeakMap()
function sharedFor(ctx) {
  const root = ctx.root
  let shared = sharedRoots.get(root)
  if (shared === undefined) {
    shared = { states: new Map(), toolDefinitions: new Map(), toolRefs: new WeakMap(),
      multimodalModels: new Set(), agents: new WeakMap(), liveServices: new Set() }
    sharedRoots.set(root, shared)
  }
  return shared
}

function copyState(state) {
  return {
    mode: state.mode,
    ...(state.provider === undefined ? {} : { provider: state.provider }),
    ...(state.model === undefined ? {} : { model: state.model }),
    modelName: state.modelName,
    reasoningEfforts: [...state.reasoningEfforts],
    supportsMultimodal: state.supportsMultimodal === true,
    allowlistEnforced: state.allowlistEnforced === true,
    allowedRoutes: Array.isArray(state.allowedRoutes)
      ? state.allowedRoutes.map((route) => ({ provider: route.provider, model: route.model }))
      : [],
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
  const allowlist = state.allowlistEnforced === true
    ? '；官方子代理模型白名单已启用，选择器只显示允许的路由'
    : ''
  return (changed ? '子代理模型已更新。' : '子代理调度能力已就绪。')
    + ' 当前模型：' + model + '；支持思考档位：' + efforts + '；' + modality
    + allowlist
    + '。需要视觉任务时，只派给明确标记支持图片输入的子代理，否则由主模型处理或拆分任务。'
}

/** Host-side per-parent selection state and model capability snapshot. */
export class SubagentSelectionService extends TypertRemoteService {
  static inject = ['agents', 'llm']

  constructor(ctx, config = {}) {
    super(ctx, 'subagentTools')
    this.shared = sharedFor(ctx)
    this.states = this.shared.states
    this.toolDefinitions = this.shared.toolDefinitions
    this.multimodalModels = this.shared.multimodalModels
    this.lifetime = { active: true }
    this.shared.liveServices.add(this.lifetime)
    ctx.effect(() => () => {
      this.lifetime.active = false
      this.shared.liveServices.delete(this.lifetime)
      if (this.shared.liveServices.size === 0) {
        this.states.clear()
        this.toolDefinitions.clear()
        this.multimodalModels.clear()
      }
    })
    this.addMultimodalModels(config.multimodalModels)
    ctx.on('agent/disposed', ({ agent }) => {
      this.agentRevision(agent).disposed = true
      this.states.delete(agent.id)
    })
    ctx.on('agent/session-start', ({ agent }) => {
      const announce = agent.session.header.origin !== 'subagent' && this.availableFor(agent)
      void this.refreshInherited(agent, announce).catch(() => {})
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
    const refs = this.shared.toolRefs
    refs.set(definition, (refs.get(definition) ?? 0) + 1)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      const count = refs.get(definition) - 1
      if (count > 0) { refs.set(definition, count); return }
      refs.delete(definition)
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

  allowlist() {
    const settings = this.ctx.get('subagentModelSelection')
    if (settings === undefined || typeof settings.current !== 'function') {
      return { enforced: false, routes: [] }
    }
    try {
      const current = settings.current()
      const routes = Array.isArray(current?.allowedModels)
        ? current.allowedModels
          .filter((route) => typeof route?.provider === 'string' && typeof route?.model === 'string')
          .map((route) => ({ provider: route.provider, model: route.model }))
        : []
      return {
        enforced: current?.enabled === true && routes.length > 0,
        routes,
      }
    } catch {
      return { enforced: false, routes: [] }
    }
  }

  withAllowlist(state) {
    const allowlist = this.allowlist()
    return {
      ...state,
      allowlistEnforced: allowlist.enforced,
      allowedRoutes: allowlist.routes,
    }
  }

  defaultState() {
    return this.withAllowlist(copyState(DEFAULT_STATE))
  }

  stateFor(agent) {
    const current = this.states.get(agent.id)
    return {
      ...(current === undefined ? this.defaultState() : this.withAllowlist(copyState(current))),
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
      : 'no confirmed effort list; omit reasoning_effort unless the provider documents one'
    const modality = state.supportsMultimodal
      ? 'confirmed image input support'
      : 'no confirmed image input support'
    const allowlist = state.allowlistEnforced === true
      ? ' Official host allowlist is enabled; the user selector only offers those routes.'
      : ''
    return 'User-controlled subagent scheduling state: model route = ' + route + '; supported reasoning efforts = ' + efforts
      + '; modality = ' + modality + '.' + allowlist
      + ' This model route is locked for newly created subagents, including forks, until the user changes it. '
      + 'Do not pass `provider` or `model` to invent a child route; the user-owned lock always wins over those fields. '
      + 'Choose reasoning_effort independently for each delegation according to task difficulty. '
      + 'Never infer image support from a model name. Unknown capability means no image support: keep visual work in the parent '
      + 'or convert it to a complete text-only task. A later user model switch applies only to newly created subagents; running '
      + 'subagents continue with the route captured at creation.'
  }

  agentRevision(agent) {
    let revision = this.shared.agents.get(agent)
    if (revision === undefined) {
      revision = { version: 0, refresh: 0, disposed: false }
      this.shared.agents.set(agent, revision)
    }
    return revision
  }

  isCurrent(revision, version) {
    return this.lifetime.active && !revision.disposed && revision.version === version
  }

  assertLive(agent) {
    const revision = this.agentRevision(agent)
    if (!this.isCurrent(revision, revision.version)) {
      throw new Error('dsh-subagent-tools-ui: session or plugin has been disposed')
    }
    return revision
  }

  async refreshInherited(agent, announce) {
    const revision = this.agentRevision(agent)
    const version = revision.version
    if (!this.isCurrent(revision, version)) return undefined
    const current = this.states.get(agent.id)
    if (current !== undefined && current.mode !== 'inherit') return this.stateFor(agent)
    const refresh = ++revision.refresh
    const { provider, model } = parentModelRoute(agent, this.ctx)
    let info
    if (provider !== undefined && model !== undefined) {
      try { info = await this.ctx.llm.resolveModelInfo(provider, model) } catch {
        // Model metadata is advisory. Routing still follows the parent's model.
      }
    }
    if (!this.isCurrent(revision, version)) {
      return this.lifetime.active && !revision.disposed ? this.stateFor(agent) : undefined
    }
    if (revision.refresh !== refresh) return this.stateFor(agent)
    const latest = parentModelRoute(agent, this.ctx)
    if (latest.provider !== provider || latest.model !== model) return this.refreshInherited(agent, announce)
    const state = this.withAllowlist({
      mode: 'inherit', provider, model,
      modelName: info?.name || routeLabel(provider, model),
      reasoningEfforts: normalizeEfforts(info),
      supportsMultimodal: supportsImages(info) || this.multimodalModels.has(provider + '/' + model),
    })
    this.states.set(agent.id, state)
    if (announce) this.notice(agent, state, false, '子代理模型能力信息已更新')
    return this.stateFor(agent)
  }

  notice(agent, state, changed, summary) {
    this.assertLive(agent)
    agent.inject(createUserMessage({
      content: [{ type: 'text', text: makeNotice(state, changed) }],
      source: { kind: 'plugin', plugin: 'dsh-subagent-tools-ui', form: 'notice', summary },
    }))
  }

  async get(agent) {
    const state = this.states.get(agent.id)
    if (state === undefined || state.mode === 'inherit') return this.refreshInherited(agent, false)
    this.assertLive(agent)
    return this.stateFor(agent)
  }

  async set(agent, request) {
    if (request?.mode !== 'inherit' && (request?.mode !== 'fixed'
      || typeof request.provider !== 'string' || request.provider.length === 0
      || typeof request.model !== 'string' || request.model.length === 0)) {
      throw new Error('dsh-subagent-tools-ui: fixed selection requires non-empty provider and model')
    }
    if (request.mode === 'fixed') this.assertAllowlist(request.provider, request.model)
    const revision = this.assertLive(agent)
    const version = ++revision.version
    const route = request.mode === 'inherit' ? parentModelRoute(agent, this.ctx) : request
    // Commit the user's intent before fetching advisory metadata. Later requests
    // can supersede this one, and older refreshes cannot restore an earlier mode.
    this.states.set(agent.id, this.withAllowlist({
      mode: request.mode, provider: route.provider, model: route.model,
      modelName: routeLabel(route.provider, route.model),
      reasoningEfforts: [], supportsMultimodal: false,
    }))
    if (request.mode === 'inherit') {
      await this.refreshInherited(agent, false)
    } else {
      let info
      try { info = await this.ctx.llm.resolveModelInfo(request.provider, request.model) } catch {}
      if (this.isCurrent(revision, version)) {
        this.states.set(agent.id, this.withAllowlist({
          mode: 'fixed', provider: request.provider, model: request.model,
          modelName: info?.name || request.model,
          reasoningEfforts: normalizeEfforts(info),
          supportsMultimodal: supportsImages(info) || this.multimodalModels.has(request.provider + '/' + request.model),
        }))
      }
    }
    if (!this.lifetime.active || revision.disposed) return undefined
    const result = this.stateFor(agent)
    if (this.isCurrent(revision, version)) {
      this.notice(agent, result, true, request.mode === 'inherit'
        ? '子代理模型已切换为继承主模型' : '子代理模型已切换为 ' + result.modelName)
    }
    return result
  }

  assertAllowlist(provider, model) {
    const allowlist = this.allowlist()
    if (!allowlistAllows(allowlist, provider, model)) {
      throw new Error(`dsh-subagent-tools-ui: route ${provider}/${model} is outside the official subagent allowlist`)
    }
  }

  /** Resolve the user-owned route without mutating already-created children. */
  async lockFor(agent) {
    const state = await this.get(agent)
    this.assertLive(agent)
    return {
      mode: state.mode,
      ...(state.provider === undefined ? {} : { provider: state.provider }),
      ...(state.model === undefined ? {} : { model: state.model }),
    }
  }

  async delegation(agent) {
    const lock = await this.lockFor(agent)
    if (lock.provider === undefined || lock.model === undefined) return undefined
    return { provider: lock.provider, model: lock.model }
  }

  async applyToStartRequest(request, provider) {
    if (request === undefined || request.parent === undefined) return { provider, request }
    if (this.shared !== undefined) this.assertLive(request.parent)
    const store = callContext.getStore()
    const lock = store?.lock ?? await this.lockFor(request.parent)
    const extras = store?.extras ?? {}
    if (lock.mode === 'fixed') this.assertAllowlist(lock.provider, lock.model)
    const agentOptions = applyLockToAgentOptions(request.agentOptions, lock, extras)
    let persona = extras.persona ?? request.persona
    if (typeof persona === 'string') persona = await resolvePersona(persona)
    const toolFilter = extras.toolFilter ?? request.toolFilter
    const backend = extras.backend ?? provider
    if (typeof extras.backend === 'string' && this.ctx.subagents?.getProvider?.(backend) === undefined) {
      throw new Error(`dsh-subagent-tools-ui: unknown subagent backend "${backend}"`)
    }
    const next = { ...request }
    if (agentOptions === undefined) delete next.agentOptions
    else next.agentOptions = agentOptions
    if (persona !== undefined) next.persona = persona
    if (toolFilter !== undefined) next.toolFilter = toolFilter
    if (agentOptions?.provider !== undefined && agentOptions?.model !== undefined && typeof this.ctx.llm?.resolveCallConfig === 'function') {
      await this.ctx.llm.resolveCallConfig({
        provider: agentOptions.provider,
        model: agentOptions.model,
        ...(agentOptions.reasoningEffort === undefined ? {} : { reasoningEffort: agentOptions.reasoningEffort }),
      }, request.signal)
    }
    if (this.shared !== undefined) this.assertLive(request.parent)
    return { provider: backend, request: next }
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
