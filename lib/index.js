/**
 * dsh-subagent-tools-ui — per-session lock over official subagent tools.
 *
 * DeepSeek Harness 0.1.5 already owns spawn/fork, continuable jobs, and the
 * host-level child-model allowlist. This package no longer replaces those
 * tools. It patches the official definitions and `subagents.start*` so a
 * user-owned session lock can:
 *   - force future children onto a fixed LLM route, or
 *   - inherit the parent route (the default)
 * while still letting the parent AI choose reasoning effort per call.
 *
 * The lock applies to both `subagent` and `subagent_fork`. Official
 * `provider`/`model` arguments remain LLM-route fields; they are stripped
 * when the user owns the route so the parent model cannot invent one.
 * Optional extras (`backend`, `persona`, `toolFilter`) are applied on top of
 * the official start request.
 *
 * @module dsh-subagent-tools-ui
 */

import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import SubagentSelectionService from './selection-service.js'
import { resolvePersona } from './persona.js'
import {
  LOCK_MARK,
  applyLockToAgentOptions,
  callContext,
  extrasFromArgs,
  isDelegationToolName,
  officialDelegationArgs,
} from './lock.js'

export const name = 'dsh-subagent-tools-ui'
export const inject = ['tools', 'subagents', 'systemPrompt', 'agents', 'llm']

/** Prompt order just before the official TOOL_SUBAGENT background section. */
const ROUTING_SECTION_ORDER = 2799.5

export const Config = z.object({
  toolName: z.string().default('subagent'),
  presetHints: z.array(z.string()).default(undefined),
  multimodalModels: z.array(z.string()).default(undefined),
})

function extraParameterSchema(config) {
  const hints = config.presetHints !== undefined && config.presetHints.length > 0
    ? ` Available presets on this deployment: ${config.presetHints.map((preset) => preset.startsWith('@preset:') ? preset : `@preset:${preset}`).join(', ')}.`
    : ''
  return {
    backend: {
      type: 'string',
      description: 'Optional per-call subagent backend override (spawn, fork, or another registered subagent provider). This is not an LLM provider id.',
    },
    persona: {
      type: 'string',
      description: 'Optional per-call persona text that shadows the deployment/preset persona for this child, or an `@preset:<id>` reference (display name or directory id).' + hints,
    },
    toolFilter: {
      type: 'object',
      additionalProperties: false,
      properties: {
        allow: { type: 'array', items: { type: 'string' } },
        deny: { type: 'array', items: { type: 'string' } },
      },
      description: 'Optional per-call tool allow/deny filter applied to this child.',
    },
    reasoning_effort: {
      type: 'string',
      description: 'Per-call reasoning effort from the selected child model capability list. Omit to use its default.',
    },
    reasoningEffort: {
      type: 'string',
      description: 'Optional per-call reasoning effort. Prefer `reasoning_effort`; this older spelling remains accepted.',
    },
  }
}

function annotateRouteField(field, fallback) {
  if (field === undefined || typeof field !== 'object') return field
  const description = typeof field.description === 'string' ? field.description : fallback
  if (description.includes('conversation toolbar')) return field
  return {
    ...field,
    description: description + ' Ignored when the user has locked a child route from the conversation toolbar; the user-owned route always wins.',
  }
}

function patchSchema(definition, config, toolName) {
  const parameters = definition.parameters
  if (parameters !== undefined && typeof parameters === 'object') {
    const properties = parameters.properties !== undefined && typeof parameters.properties === 'object'
      ? parameters.properties
      : parameters
    try {
      if (properties.provider !== undefined) properties.provider = annotateRouteField(properties.provider, 'LLM provider route for the child.')
      if (properties.model !== undefined) properties.model = annotateRouteField(properties.model, 'Model id interpreted by provider.')
      Object.assign(properties, extraParameterSchema(config))
    } catch {
      // Official schemas may be frozen. Execute wrapping still applies the lock.
    }
  }
  const suffix = ' The user may lock the child LLM route from the conversation toolbar. When a route is locked, omit `provider` and `model`; those fields cannot override the user selection. You may still choose `reasoning_effort` for this call. `backend` optionally selects the subagent provider (spawn/fork); it is not an LLM provider id.'
    + (toolName === 'subagent_fork' ? ' A locked route also applies to forks, even when that prevents prefix reuse.' : '')
  if (typeof definition.description === 'string' && !definition.description.includes('conversation toolbar')) {
    definition.description += suffix
  }
}

// Each wrapper belongs to live plugin scopes. Shared service methods must keep
// the call-site receiver so Cordis can recover the caller's own fiber.
const RUNTIME_PATCH = Symbol.for('dsh-subagent-tools-ui.runtime-patch')
const TOOLS_PATCH = Symbol.for('dsh-subagent-tools-ui.tools-patch')
const definitionPatches = new WeakMap()

function onDispose(ctx, cleanup) {
  return ctx?.effect?.(() => cleanup)
}

function patchDefinition(definition, owner) {
  let patch = definitionPatches.get(definition)
  if (patch === undefined) {
    const original = {
      execute: definition.execute,
      parameters: definition.parameters,
      description: definition.description,
    }
    patch = { original, owners: new Map() }
    definitionPatches.set(definition, patch)
    // Restore the original schema object on release as well as the execute hook.
    try { definition.parameters = structuredClone(definition.parameters) } catch {}
    patchSchema(definition, owner.config, definition.name)
    patch.execute = async function (args, exec) {
      const active = patch.owners.values().next().value
      if (active === undefined) return Reflect.apply(original.execute, this, [args, exec])
      const parent = exec.agent
      if (!parent) throw new Error('subagent tool requires a calling agent (exec.agent was undefined)')
      const extras = extrasFromArgs(args)
      if (typeof extras.persona === 'string') extras.persona = await resolvePersona(extras.persona)
      const lock = await active.selectionService.lockFor(parent)
      const officialArgs = officialDelegationArgs(args)
      return callContext.run({ parentId: parent.id, lock, extras, [LOCK_MARK]: true },
        () => Reflect.apply(original.execute, this, [officialArgs, exec]))
    }
    definition.execute = patch.execute
    definition[LOCK_MARK] = true
  }
  patch.owners.set(owner, owner)
  const unregister = owner.selectionService.registerTool(definition.name, definition)
  return () => {
    unregister()
    patch.owners.delete(owner)
    if (patch.owners.size !== 0) return
    if (definition.execute === patch.execute) definition.execute = patch.original.execute
    definition.parameters = patch.original.parameters
    definition.description = patch.original.description
    delete definition[LOCK_MARK]
    definitionPatches.delete(definition)
  }
}

function visibleDefinitions(ctx, toolName) {
  const found = new Set()
  const direct = ctx.tools.get(toolName, scopeOf(ctx))
  if (direct !== undefined) found.add(direct)
  const agents = ctx.get('agents')
  if (agents !== undefined && typeof agents.list === 'function') {
    for (const agent of agents.list()) {
      const definition = ctx.tools.get(toolName, agent)
      if (definition !== undefined) found.add(definition)
    }
  }
  return found
}

export function wrapSubagents(ctx, selectionService) {
  const runtime = ctx.subagents
  if (runtime === undefined) return
  const target = runtime[Symbol.for('cordis.original')] ?? runtime
  let patch = target[RUNTIME_PATCH]
  if (patch === undefined) {
    const start = target.start
    const startContinuable = target.startContinuable
    patch = { owners: new Set(), start, startContinuable }
    patch.wrappedStart = async function (provider, request) {
      const owner = patch.owners.values().next().value
      const patched = owner === undefined ? { provider, request }
        : await owner.applyToStartRequest(request, provider)
      return Reflect.apply(start, this, [patched.provider, patched.request])
    }
    runtime.start = patch.wrappedStart
    if (typeof startContinuable === 'function') {
      patch.wrappedContinuable = async function (spec) {
        const owner = patch.owners.values().next().value
        const patched = owner === undefined ? spec
          : await owner.applyToStartRequest(spec.request, spec.provider)
        return Reflect.apply(startContinuable, this, [{ ...spec, provider: patched.provider, request: patched.request }])
      }
      runtime.startContinuable = patch.wrappedContinuable
    }
    runtime[RUNTIME_PATCH] = patch
    runtime[LOCK_MARK] = true
  }
  // Use a separate token for every scope even when two scopes share a service.
  const token = { applyToStartRequest: (...args) => selectionService.applyToStartRequest(...args) }
  patch.owners.add(token)
  onDispose(ctx, () => {
    patch.owners.delete(token)
    if (patch.owners.size !== 0) return
    if (target.start === patch.wrappedStart) target.start = patch.start
    if (target.startContinuable === patch.wrappedContinuable) target.startContinuable = patch.startContinuable
    delete runtime[RUNTIME_PATCH]
    delete runtime[LOCK_MARK]
  })
}

function interceptRegister(ctx, owner) {
  const tools = ctx.tools
  const target = tools[Symbol.for('cordis.original')] ?? tools
  let patch = target[TOOLS_PATCH]
  if (patch === undefined) {
    const originalRegister = target.register
    patch = { originalRegister, owners: new Set(), syncing: false }
    patch.sync = () => {
      if (patch.syncing) return
      patch.syncing = true
      try {
        for (const active of patch.owners) {
          try { active.ctx.fiber?.assertActive() } catch { continue }
          if (active.ctx.fiber?.state === 5) continue
          active.sync()
          ensureAliasTools(patch, active)
        }
      } finally { patch.syncing = false }
    }
    patch.register = function (definition) {
      // Never bind the original to the installing scope. The caller owns both
      // the official registration and our cleanup when that scope is destroyed.
      const disposer = Reflect.apply(originalRegister, this, [definition])
      patch.sync()
      let disposed = false
      const cleanup = () => {
        if (disposed) return
        disposed = true
        disposer()
        patch.sync()
      }
      return onDispose(this.ctx, cleanup) ?? cleanup
    }
    tools.register = patch.register
    tools[TOOLS_PATCH] = patch
    tools[LOCK_MARK] = true
  }
  patch.owners.add(owner)
  onDispose(ctx, () => {
    patch.owners.delete(owner)
    for (const cleanup of owner.definitions.values()) cleanup()
    owner.definitions.clear()
    for (const dispose of owner.aliases.values()) dispose()
    owner.aliases.clear()
    if (patch.owners.size !== 0) {
      patch.sync()
      return
    }
    if (target.register === patch.register) target.register = patch.originalRegister
    delete tools[TOOLS_PATCH]
    delete tools[LOCK_MARK]
  })
  return patch.sync
}

/** Whether the Agent Teams domain service is visible from this context. */
function agentTeamsMounted(ctx) {
  return ctx.get('agentTeams') !== undefined
}

/** Live status of one child, mirroring the official `list_agents` projection. */
function childStatus(ctx, id) {
  const agent = ctx.agents.get(id)
  if (agent === undefined) return 'ready'
  return agent.status === 'running' ? 'running' : 'idle'
}

/**
 * Definitions for the legacy subagent controls that Agent Teams shadows.
 *
 * These are hand-written rather than cloned from the official tools. The official
 * `send_message` / `list_agents` / `interrupt_agent` are registered BEFORE this
 * plugin's interceptor exists, so they never pass through it and cannot be captured;
 * the team-scoped tools that shadow them do pass through, which is how this was
 * diagnosed. Reimplementing against the injected `subagents` service keeps the
 * capability independent of registration order entirely — the official tools are
 * themselves thin adapters over exactly these calls.
 *
 * @param ctx - plugin context carrying the injected `subagents` and `agents` services.
 * @returns tool definitions ready for `tools.register`.
 */
function aliasToolDefinitions(ctx) {
  return [
    {
      name: 'steer_subagent',
      description: 'Send a message to a direct continuable subagent by its durable agent id. This is the official `send_message`, kept under a different name because Agent Teams shadows that name with a team-scoped tool for team members. If the target is still working the message steers its nearest step; if it is idle the message starts a turn. Use list_subagents to find ids.',
      parameters: {
        agent_id: {
          type: 'string',
          required: true,
          description: 'The agent id of your direct continuable child, or your direct parent when you are a resident continuable child.',
        },
        message: {
          type: 'string',
          required: true,
          description: 'The message to deliver to the agent.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { messageId: { type: 'string', required: true } },
        },
        render: (args) => [{ type: 'text', text: 'message delivered to agent ' + args.agent_id }],
      },
      async execute(args, exec) {
        const sender = exec.agent
        if (!sender) throw new Error('steer_subagent requires a calling agent (exec.agent was undefined)')
        const message = [{ type: 'text', text: args.message }]
        return { messageId: await ctx.subagents.sendMessage(sender, args.agent_id, message, { signal: exec.signal }) }
      },
    },
    {
      name: 'list_subagents',
      description: 'List your direct continuable subagents by durable id, label and live status. This is the official `list_agents`, kept under a different name because Agent Teams shadows that name with a team-scoped tool for team members. Use the returned ids with steer_subagent and stop_subagent.',
      parameters: {},
      output: {
        schema: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              label: { type: 'string' },
              status: { type: 'string', required: true },
              reason: { type: 'string' },
            },
          },
        },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(_args, exec) {
        const parent = exec.agent
        if (!parent) throw new Error('list_subagents requires a calling agent (exec.agent was undefined)')
        const entries = await ctx.subagents.listChildren(parent.id, exec.signal)
        const rows = []
        for (const entry of entries) {
          if (entry.kind === 'diagnostic') {
            rows.push({ id: entry.id, status: 'diagnostic', reason: entry.reason })
            continue
          }
          // One-shot children cannot be continued, so they are not steer candidates.
          if (entry.mode !== 'continuable') continue
          rows.push({ id: entry.id, label: entry.label, status: childStatus(ctx, entry.id) })
        }
        return rows
      },
    },
    {
      name: 'stop_subagent',
      description: 'Request cancellation of a background subagent\'s current turn by its agent id. This is the official `interrupt_agent`, kept under a different name because Agent Teams shadows that name with a team-scoped tool for team members. Only the current turn stops; messages already queued stay parked.',
      parameters: {
        agent_id: {
          type: 'string',
          required: true,
          description: 'The agent id whose current turn should stop. May be a direct child or a deeper agent created under you.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { accepted: { type: 'boolean', required: true } },
        },
        render: (args) => [{ type: 'text', text: 'interrupt requested for agent ' + args.agent_id }],
      },
      execute(args, exec) {
        const caller = exec.agent
        if (!caller) throw new Error('stop_subagent requires a calling agent (exec.agent was undefined)')
        ctx.subagents.interrupt(args.agent_id, { kind: 'ancestor', agent: caller })
        return Promise.resolve({ accepted: true })
      },
    },
  ]
}

/** Register controls in each live scope where Agent Teams shadows them. */
function ensureAliasTools(patch, owner) {
  const ctx = owner.ctx
  // Retain the inactive-fiber guard while tying registrations to their owner.
  try { ctx.fiber?.assertActive() } catch { return }
  if (!agentTeamsMounted(ctx) || ctx.subagents === undefined) return
  for (const definition of aliasToolDefinitions(ctx)) {
    if (owner.aliases.has(definition.name) || ctx.tools.get(definition.name, scopeOf(ctx)) !== undefined) continue
    try {
      const dispose = Reflect.apply(patch.originalRegister, ctx.tools, [defineTool(definition)])
      owner.aliases.set(definition.name, dispose)
    } catch {
      // A later registration retries without breaking unrelated tools.
    }
  }
}

function patchOfficialTool(ctx, selectionService, config, toolName) {
  const owner = { ctx, selectionService, config, definitions: new Map(), aliases: new Map() }
  owner.sync = () => {
    const visible = visibleDefinitions(ctx, toolName)
    for (const [definition, cleanup] of owner.definitions) {
      if (visible.has(definition)) continue
      cleanup()
      owner.definitions.delete(definition)
    }
    for (const definition of visible) {
      if (!isDelegationToolName(definition.name) || owner.definitions.has(definition)) continue
      owner.definitions.set(definition, patchDefinition(definition, owner))
    }
  }
  const sync = interceptRegister(ctx, owner)
  sync()
  ctx.on('tools/change', sync)
  ctx.systemPrompt.section({
    name: 'tool:' + toolName + ':model-routing',
    order: ROUTING_SECTION_ORDER,
    text: (context) => {
      if (context.agent === undefined) return ''
      const definition = ctx.tools.get(toolName, context.agent)
      if (definition === undefined || !selectionService.ownsRoutingPrompt(toolName, definition, context.agent)) return ''
      return selectionService.promptText(context.agent)
    },
  })
}

export function apply(ctx, config = {}) {
  let selectionService = ctx.get('subagentTools')
  if (selectionService === undefined) {
    selectionService = new SubagentSelectionService(ctx, { multimodalModels: config.multimodalModels })
  } else {
    selectionService.addMultimodalModels(config.multimodalModels)
  }

  wrapSubagents(ctx, selectionService)
  patchOfficialTool(ctx, selectionService, config, config.toolName ?? 'subagent')
}

export { applyLockToAgentOptions, callContext, isDelegationToolName }
