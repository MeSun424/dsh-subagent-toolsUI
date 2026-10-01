import { AsyncLocalStorage } from 'node:async_hooks'

export const LOCK_MARK = Symbol.for('dsh-subagent-tools-ui.lock')
export const callContext = new AsyncLocalStorage()

const DELEGATION_TOOLS = new Set(['subagent', 'subagent_fork'])

export function isDelegationToolName(name) {
  return DELEGATION_TOOLS.has(name)
}

export function stripRouteArgs(args) {
  if (args === undefined || args === null || typeof args !== 'object' || Array.isArray(args)) return {}
  const cleaned = { ...args }
  delete cleaned.provider
  delete cleaned.model
  delete cleaned.backend
  delete cleaned.persona
  delete cleaned.toolFilter
  const effort = cleaned.reasoning_effort ?? cleaned.reasoningEffort
  delete cleaned.reasoningEffort
  if (effort !== undefined) cleaned.reasoning_effort = effort
  else delete cleaned.reasoning_effort
  return cleaned
}

export function officialDelegationArgs(args) {
  const cleaned = stripRouteArgs(args)
  delete cleaned.provider
  delete cleaned.model
  delete cleaned.reasoning_effort
  return cleaned
}

export function extrasFromArgs(args) {
  if (args === undefined || args === null || typeof args !== 'object' || Array.isArray(args)) return {}
  return {
    ...(typeof args.backend === 'string' && args.backend.length > 0 ? { backend: args.backend } : {}),
    ...(typeof args.persona === 'string' ? { persona: args.persona } : {}),
    ...(args.toolFilter !== undefined ? { toolFilter: args.toolFilter } : {}),
    ...(typeof (args.reasoning_effort ?? args.reasoningEffort) === 'string'
      ? { reasoningEffort: args.reasoning_effort ?? args.reasoningEffort }
      : {}),
  }
}

/**
 * Apply the user-owned session lock to child Agent options.
 * Fixed mode always wins over parent-invented provider/model.
 * Inherit mode strips route fields so the child follows the parent.
 */
export function applyLockToAgentOptions(agentOptions, lock, extras = {}) {
  const next = { ...(agentOptions ?? {}) }
  if (lock?.mode === 'fixed' && typeof lock.provider === 'string' && typeof lock.model === 'string') {
    next.provider = lock.provider
    next.model = lock.model
  } else {
    delete next.provider
    delete next.model
  }
  const effort = extras.reasoningEffort ?? next.reasoningEffort
  if (effort !== undefined) next.reasoningEffort = effort
  else delete next.reasoningEffort
  return Object.keys(next).length === 0 ? undefined : next
}

export function routeKey(provider, model) {
  return provider + '/' + model
}

export function filterDirectoryGroups(groups, allowlist) {
  if (!Array.isArray(groups)) return []
  if (!allowlist?.enforced || !Array.isArray(allowlist.routes) || allowlist.routes.length === 0) return groups
  const allowed = new Set(allowlist.routes.map((route) => routeKey(route.provider, route.model)))
  return groups
    .map((group) => ({
      ...group,
      models: (group.models ?? []).filter((model) => allowed.has(routeKey(group.id, model.id))),
    }))
    .filter((group) => group.models.length > 0)
}

export function allowlistAllows(allowlist, provider, model) {
  if (!allowlist?.enforced) return true
  const routes = Array.isArray(allowlist.routes) ? allowlist.routes : []
  return routes.some((route) => route.provider === provider && route.model === model)
}

/** Read Desktop's pending choice, then the last request, before creation defaults. */
export function parentModelRoute(agent, ctx) {
  const pending = ctx?.get('sessionProjections')?.stateOf(agent.session, 'modelSelection')?.pending
  const logged = agent.session.requestHeader?.()?.config
  const defaults = ctx?.get('agentDefaultModel')?.currentSelection?.()
  const selected = pending ?? logged ?? defaults ?? agent.options
  return { provider: selected?.provider, model: selected?.model }
}
