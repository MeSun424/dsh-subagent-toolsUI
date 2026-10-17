import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { apply as applyOfficial } from '@deepseek-ai/dsh-tool-subagent'
import * as Lock from '../lib/index.js'
import Selection from '../lib/selection-service.js'
import { callContext } from '../lib/lock.js'

async function harness(t, { preset = false } = {}) {
  const ctx = new Context()
  const calls = []
  const preflights = []
  const policies = new Map()
  const agent = {
    id: 'activation-parent', ctx, options: { provider: 'parent', model: 'original' },
    session: { header: { origin: 'user' }, requestHeader: () => ({ config: { provider: 'parent', model: 'latest' } }) },
    inject() {},
  }
  ctx.provide('agents', { list: () => [agent], get: id => id === agent.id ? agent : undefined })
  ctx.provide('workingDirectory', { ensure: async () => process.cwd() })
  ctx.provide('systemPrompt', {
    tools: () => ctx.effect(() => () => {}), section: () => ctx.effect(() => () => {}),
    context: () => ctx.effect(() => () => {}), getSectionOrder: () => 2800, getContextOrder: () => 100,
  })
  ctx.provide('sessionProjections', { register() {}, stateOf: (_session, name) => policies.get(name) })
  ctx.provide('llm', {
    resolveModelInfo: async (_provider, model) => ({ name: model, inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }),
    resolveCallConfig: async (config, signal) => {
      preflights.push({ config, signal })
      if (config.reasoningEffort && !['low', 'high'].includes(config.reasoningEffort)) throw new Error('Unsupported reasoning effort')
      return config
    },
  })
  ctx.provide('agentPresets', { readDocument: async id => ({ description: id }) })
  new ToolRuntime(ctx)
  const selection = new Selection(ctx)
  const runtime = new SubagentRuntime(ctx, { maxDepth: { get: () => 1 }, maxActiveSubagents: { get: () => 8 } })
  for (const name of ['spawn', 'fork']) runtime.registerProvider({
    name, inheritsParentContext: name === 'fork', capabilities: { agentOptions: true, depthLimit: true, agentPreset: name === 'spawn' },
    prepareContinuable() {},
  })
  const originalStart = runtime.startActivation
  const spawnLock = await ctx.plugin(Lock, { toolName: 'subagent' })
  const forkLock = await ctx.plugin(Lock, { toolName: 'subagent_fork' })
  runtime.manager = { startLocal: async spec => { calls.push(spec); return { childId: 'captured-child' } } }
  await applyOfficial(ctx, { provider: 'spawn', toolName: 'subagent', ...(preset ? { allowedAgentPresets: ['reviewer'] } : {}) }, agent.session)
  await applyOfficial(ctx, { provider: 'fork', toolName: 'subagent_fork' }, agent.session)
  t.after(async () => { await spawnLock.dispose(); await forkLock.dispose() })
  const execute = (name, args = {}, signal = new AbortController().signal) => ctx.tools.get(name).execute({ description: 'Activation regression', prompt: 'No real model request', ...args }, { agent, signal })
  return { ctx, runtime, originalStart, selection, agent, calls, preflights, policies, execute, spawnLock, forkLock }
}

for (const name of ['subagent', 'subagent_fork']) {
  test(`${name}: real runtime activation receives fixed model, effort and cancellation`, async t => {
    const h = await harness(t)
    await h.selection.set(h.agent, { mode: 'fixed', provider: 'selected', model: 'chosen' })
    const signal = new AbortController().signal
    assert.equal((await h.execute(name, { provider: 'invented', model: 'wrong', reasoning_effort: 'low' }, signal)).subagentId, 'captured-child')
    assert.deepEqual(h.calls[0].request.agentOptions, { provider: 'selected', model: 'chosen', reasoningEffort: 'low' })
    assert.equal(h.calls[0].signal, signal)
    assert.equal(h.calls[0].delivery, 'parent')
    assert.equal(h.preflights[0].signal, signal)
  })
}

test('activation backend override reaches the real runtime', async t => {
  const h = await harness(t)
  await h.execute('subagent', { backend: 'fork', reasoning_effort: 'high' })
  assert.equal(h.calls[0].provider, 'fork')
  assert.equal(h.calls[0].request.agentOptions.reasoningEffort, 'high')
  await assert.rejects(h.execute('subagent', { backend: 'missing' }), /unknown subagent backend/)
  assert.equal(h.calls.length, 1)
})

test('inheritance follows the live parent route and does not change parent options', async t => {
  const h = await harness(t)
  const before = { ...h.agent.options }
  await h.execute('subagent', { provider: 'invented', model: 'wrong' })
  assert.equal(h.calls[0].request.agentOptions, undefined)
  assert.deepEqual(h.agent.options, before)
  await h.selection.set(h.agent, { mode: 'fixed', provider: 'selected', model: 'chosen' })
  await h.selection.set(h.agent, { mode: 'inherit' })
  await h.execute('subagent_fork')
  assert.equal(h.calls[1].request.agentOptions, undefined)
})

test('official Agent Preset is preserved; incompatible fork selection still rejects', async t => {
  const h = await harness(t, { preset: true })
  await h.execute('subagent', { agent_preset: 'reviewer' })
  assert.equal(h.calls[0].request.agentPreset, 'reviewer')
  await assert.rejects(h.execute('subagent', { agent_preset: 'unknown' }), /agent_preset.*must be one of/)
  await assert.rejects(h.execute('subagent', { agent_preset: 'reviewer', backend: 'fork' }), /does not support independent agent preset/)
  assert.equal(h.calls.length, 1)
})

test('unsupported legacy composition arguments fail instead of disappearing', async t => {
  const h = await harness(t)
  for (const args of [{ persona: 'review' }, { toolFilter: { deny: ['bash'] } }]) {
    await assert.rejects(h.execute('subagent', args), /Agent Preset/)
  }
  await assert.rejects(h.runtime.startActivation({ provider: 'spawn', request: { parent: h.agent, persona: 'legacy' }, signal: new AbortController().signal }), /Agent Preset/)
  assert.equal(h.calls.length, 0)
})

test('invalid effort and cancelled preflight cannot reach activation creation', async t => {
  const h = await harness(t)
  await assert.rejects(h.execute('subagent', { reasoning_effort: 'invented' }), /Unsupported reasoning effort/)
  await h.selection.set(h.agent, { mode: 'fixed', provider: 'selected', model: 'chosen' })
  await assert.rejects(h.execute('subagent', { reasoning_effort: 'invented' }), /Unsupported reasoning effort/)
  h.ctx.llm.resolveCallConfig = async (_config, signal) => { signal.throwIfAborted() }
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(h.execute('subagent', {}, controller.signal), { name: 'AbortError' })
  assert.equal(h.calls.length, 0)
})

test('activation restores only its own wrappers after the last owner unloads', async t => {
  const h = await harness(t)
  assert.equal(typeof h.runtime.start, 'undefined')
  assert.equal(typeof h.runtime.startContinuable, 'undefined')
  await h.spawnLock.dispose()
  await h.execute('subagent_fork')
  await h.forkLock.dispose()
  assert.equal(h.runtime.startActivation, h.originalStart)
})

test('session model policy takes precedence over later global settings', async t => {
  const h = await harness(t)
  h.ctx.provide('subagentModelSelection', { current: () => ({ enabled: true, allowedModels: [{ provider: 'global', model: 'other' }] }) })
  h.policies.set('subagentModelSelectionPolicy', [{ provider: 'session', model: 'allowed' }])
  await h.selection.set(h.agent, { mode: 'fixed', provider: 'session', model: 'allowed' })
  await h.execute('subagent')
  assert.equal(h.calls[0].request.agentOptions.provider, 'session')
  assert.deepEqual(h.selection.stateFor(h.agent).allowedRoutes, [{ provider: 'session', model: 'allowed' }])
  await assert.rejects(h.selection.set(h.agent, { mode: 'fixed', provider: 'global', model: 'other' }), /outside the official subagent allowlist/)
  h.policies.set('subagentModelSelectionPolicy', null)
  assert.equal(h.selection.stateFor(h.agent).allowlistEnforced, false)
})

test('a nested parent cannot inherit another parent’s per-call lock or extras', async t => {
  const h = await harness(t)
  await callContext.run({ parentId: 'another-parent', lock: { mode: 'fixed', provider: 'wrong', model: 'wrong' }, extras: { backend: 'missing', reasoningEffort: 'invented' } }, () => h.runtime.startActivation({ provider: 'spawn', request: { parent: h.agent }, signal: new AbortController().signal }))
  assert.equal(h.calls[0].provider, 'spawn')
  assert.equal(h.calls[0].request.agentOptions, undefined)
})
