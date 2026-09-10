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
  if (tools === undefined || tools[LOCK_MARK] === true) return
  // Keep the original UNBOUND. `ctx.tools.register` is a context-bound shadow
  // method: the harness recovers the calling agent's scope from the call-site
  // receiver, so binding it here would pin every later call to THIS context.
  // A child agent that registers its own tool (e.g. the workflow driver's
  // structured-output tool) would then build its effect on the wrong fiber and
  // fail with "cannot create effect on inactive context". Forwarding `this`
  // preserves each caller's own scope.
  const originalRegister = tools.register
  tools.register = function registerWithRoutePatch(definition) {
    patchDefinition(definition, selectionService, config)
    return Reflect.apply(originalRegister, this, [definition])
  }
  tools[LOCK_MARK] = true
}

function patchOfficialTool(ctx, selectionService, config, toolName) {
  interceptRegister(ctx, selectionService, config)

  const sync = () => {
    for (const definition of visibleDefinitions(ctx, toolName)) {
      patchDefinition(definition, selectionService, config)
    }
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
