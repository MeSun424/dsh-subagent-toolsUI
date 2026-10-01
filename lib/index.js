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

function patchExecute(definition, selectionService) {
  if (definition[LOCK_MARK] === true) return
  const originalExecute = definition.execute.bind(definition)
  definition.execute = async (args, exec) => {
    const parent = exec.agent
    if (!parent) throw new Error('subagent tool requires a calling agent (exec.agent was undefined)')
    const extras = extrasFromArgs(args)
    if (typeof extras.persona === 'string') extras.persona = await resolvePersona(extras.persona)
    const lock = await selectionService.lockFor(parent)
    const officialArgs = officialDelegationArgs(args)
    return callContext.run({
      parentId: parent.id,
      lock,
      extras,
      [LOCK_MARK]: true,
    }, () => originalExecute(officialArgs, exec))
  }
  definition[LOCK_MARK] = true
}

function patchDefinition(definition, selectionService, config) {
  if (definition === undefined || !isDelegationToolName(definition.name)) return
  patchSchema(definition, config, definition.name)
  patchExecute(definition, selectionService)
  selectionService.registerTool(definition.name, definition)
}

function visibleDefinitions(ctx, toolName) {
  const found = new Set()
  const direct = ctx.tools.get(toolName)
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
  if (runtime === undefined || runtime[LOCK_MARK] === true) return
  const originalStart = runtime.start.bind(runtime)
  const originalStartContinuable = typeof runtime.startContinuable === 'function'
    ? runtime.startContinuable.bind(runtime)
    : undefined

  runtime.start = async (provider, request) => {
    const patched = await selectionService.applyToStartRequest(request, provider)
    return originalStart(patched.provider, patched.request)
  }
  if (originalStartContinuable !== undefined) {
    runtime.startContinuable = async (spec) => {
      const patched = await selectionService.applyToStartRequest(spec.request, spec.provider)
      return originalStartContinuable({ ...spec, provider: patched.provider, request: patched.request })
    }
  }
  runtime[LOCK_MARK] = true
}

function interceptRegister(ctx, selectionService, config) {
  const tools = ctx.tools
  if (tools === undefined || tools[LOCK_MARK] === true) return undefined
  // Keep the original UNBOUND. `ctx.tools.register` is a context-bound shadow
  // method: the harness recovers the calling agent's scope from the call-site
  // receiver, so binding it here would pin every later call to THIS context.
  // A child agent that registers its own tool (e.g. the workflow driver's
  // structured-output tool) would then build its effect on the wrong fiber and
  // fail with "cannot create effect on inactive context". Forwarding `this`
  // preserves each caller's own scope.
  const originalRegister = tools.register
  const ensureAliases = () => ensureAliasTools(ctx, tools, originalRegister)
  tools.register = function registerWithRoutePatch(definition) {
    patchDefinition(definition, selectionService, config)
    const disposer = Reflect.apply(originalRegister, this, [definition])
    // Every registration is a retry opportunity: the Agent Teams service is not
    // visible yet when this plugin is composed, but agent-scope tools register later.
    ensureAliases()
    return disposer
  }
  tools[LOCK_MARK] = true
  return ensureAliases
}

/** Whether the Agent Teams domain service is visible from this context. */
function agentTeamsMounted(ctx) {
  return ctx.get('agentTeams') !== undefined
}

/** Alias tools already registered; a second copy in one layer would fail. */
const registeredAliasTools = new Set()

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

/**
 * Register the alias tools once, as soon as Agent Teams is actually present.
 * Called at load and after every tool registration, so it cannot miss the window in
 * which the Agent Teams service becomes visible.
 * @param ctx - plugin context carrying `subagents` and the team service lookup.
 * @param tools - tools proxy captured when the register interceptor was installed.
 * @param originalRegister - unbound original `tools.register`.
 */
function ensureAliasTools(ctx, tools, originalRegister) {
  if (registeredAliasTools.size >= 3) return
  if (ctx.subagents === undefined) return
  // Without Agent Teams the official names are never shadowed, so aliases would only
  // duplicate the official controls.
  if (!agentTeamsMounted(ctx)) return
  for (const definition of aliasToolDefinitions(ctx)) {
    if (registeredAliasTools.has(definition.name)) continue
    try {
      // `defineTool` compiles the spec form (inline `required: true`) into a JSON
      // Schema the registry accepts, exactly as the official tool packages do.
      Reflect.apply(originalRegister, tools, [defineTool(definition)])
      registeredAliasTools.add(definition.name)
    } catch {
      // Marked only on success, so a later registration retries. Swallowed on purpose:
      // throwing from inside the shared register interceptor would break every other
      // tool registration in the process.
    }
  }
}

function patchOfficialTool(ctx, selectionService, config, toolName) {
  const ensureAliases = interceptRegister(ctx, selectionService, config)

  const sync = () => {
    for (const definition of visibleDefinitions(ctx, toolName)) {
      patchDefinition(definition, selectionService, config)
    }
    if (ensureAliases !== undefined) ensureAliases()
  }

  sync()
  ctx.on('tools/change', sync)

  ctx.systemPrompt.section({
    name: 'tool:' + toolName + ':model-routing',
    order: ROUTING_SECTION_ORDER,
    text: (context) => {
      const definition = ctx.tools.get(toolName, context.agent)
      if (context.agent === undefined || definition === undefined || !selectionService.ownsRoutingPrompt(toolName, definition, context.agent)) return ''
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
