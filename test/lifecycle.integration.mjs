import test from 'node:test'
import assert from 'node:assert/strict'
import { Context, Service } from '@deepseek-ai/cordis'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import * as HostPlugin from '../lib/service-plugin.js'
import * as Lock from '../lib/index.js'
import Selection from '../lib/selection-service.js'

class Tools extends Service {
  entries = new Map()
  constructor(ctx) { super(ctx, 'tools') }
  register(definition) {
    return this.ctx.effect(() => {
      this.entries.set(definition.name, definition)
      return () => { if (this.entries.get(definition.name) === definition) this.entries.delete(definition.name) }
    })
  }
  get(name) { return this.entries.get(name) }
}
class Subagents extends Service {
  constructor(ctx) { super(ctx, 'subagents') }
  async start(provider, request) {
    this.ctx.fiber.assertActive()
    return { provider, request, uid: this.ctx.fiber.uid }
  }
  async startContinuable(spec) { return this.start(spec.provider, spec.request) }
  async listChildren() { return [] }
}
class Agents extends Service {
  constructor(ctx) { super(ctx, 'agents') }
  list() { return [] }
  get() { return undefined }
}
class Llm extends Service {
  constructor(ctx) { super(ctx, 'llm') }
  resolveModelInfo() { return { name: 'Model', reasoning: { efforts: [] } } }
}
class Prompt extends Service {
  constructor(ctx) { super(ctx, 'systemPrompt') }
  section() { return this.ctx.effect(() => () => {}) }
  tools() { return this.ctx.effect(() => () => {}) }
}
function root() {
  const ctx = new Context()
  new Tools(ctx); new Subagents(ctx); new Agents(ctx); new Llm(ctx); new Prompt(ctx)
  new Selection(ctx)
  return ctx
}
const parent = { id: 'parent', options: { provider: 'p', model: 'm' }, session: { header: {}, requestHeader() {} } }

test('remount with Agent Teams should restore aliases', async () => {
  const ctx = root()
  ctx.provide('agentTeams', {})
  const first = await ctx.plugin(Lock, { toolName: 'subagent' })
  assert.ok(ctx.tools.get('list_subagents'))
  await first.dispose()
  assert.equal(ctx.tools.get('list_subagents'), undefined)
  const second = await ctx.plugin(Lock, { toolName: 'subagent' })
  assert.ok(ctx.tools.get('list_subagents'), 'aliases must return after remount')
  await second.dispose()
})

test('disposed tool definitions should leave the shared selection registry', async () => {
  const ctx = root()
  const plugin = await ctx.plugin(Lock, { toolName: 'subagent' })
  const definition = { name: 'subagent', description: 'Tool', parameters: {}, execute: async () => ({}) }
  const scope = await ctx.plugin({ inject: ['tools'], apply(scope) { scope.tools.register(definition) } })
  assert.equal(ctx.get('subagentTools').toolDefinitions.get('subagent').has(definition), true)
  await scope.dispose()
  assert.equal(ctx.tools.get('subagent'), undefined)
  assert.equal(ctx.get('subagentTools').toolDefinitions.get('subagent')?.has(definition) ?? false, false)
  await plugin.dispose()
})

test('actual Desktop starts use the replacement selection service after disposal', async () => {
  const ctx = new Context()
  new Tools(ctx); new Agents(ctx); new Llm(ctx); new Prompt(ctx)
  new SubagentRuntime(ctx, { maxDepth: { get: () => 1 }, maxActiveSubagents: { get: () => 8 } })
  ctx.subagents.registerProvider({
    name: 'spawn', capabilities: {},
    async start() { return { id: 'test-child', result: Promise.resolve({ stopReason: 'completed', output: [] }), dispose() {} } },
  })
  const SelectionOwner = { inject: HostPlugin.inject, apply(scope) { new Selection(scope) } }
  const owner = await ctx.plugin(SelectionOwner)
  const first = await ctx.plugin(Lock)
  ctx.tools.register({ name: 'subagent', description: 'Official root tool', parameters: {}, execute: async () => ({}) })
  assert.equal(ctx.subagents[Symbol.for('dsh-subagent-tools-ui.lock')], true)
  await first.dispose()
  await owner.dispose()
  const newOwner = await ctx.plugin(SelectionOwner)
  const second = await ctx.plugin(Lock)
  await ctx.subagents.start('spawn', { parent, prompt: [], signal: new AbortController().signal })
  await second.dispose()
  await newOwner.dispose()
})

test('a delayed inheritance refresh must not overwrite a newer fixed choice', async () => {
  const ctx = root()
  let release
  const slow = new Promise((resolve) => { release = resolve })
  ctx.get('llm').resolveModelInfo = async (_provider, model) => model === 'm' ? slow : { name: 'Chosen', reasoning: { efforts: [] } }
  const agent = { ...parent, id: 'race-parent', inject() {} }
  const service = ctx.get('subagentTools')
  const refresh = service.get(agent)
  await service.set(agent, { mode: 'fixed', provider: 'q', model: 'chosen' })
  release({ name: 'Parent', reasoning: { efforts: [] } })
  await refresh
  assert.equal(service.states.get(agent.id).mode, 'fixed')
})

test('an outstanding model refresh must not recreate disposed session state', async () => {
  const ctx = root()
  let release
  ctx.get('llm').resolveModelInfo = () => new Promise((resolve) => { release = resolve })
  const agent = { ...parent, id: 'disposed-race-parent', inject() {} }
  const service = ctx.get('subagentTools')
  const refresh = service.get(agent)
  ctx.emit('agent/disposed', { agent })
  assert.equal(service.states.has(agent.id), false)
  release({ name: 'Parent', reasoning: { efforts: [] } })
  await refresh
  assert.equal(service.states.has(agent.id), false)
})

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function testAgent(id) {
  const notices = []
  return { ...parent, id, notices, inject(message) { notices.push(message) } }
}

test('the last disposed scope restores original shared methods and schemas', async () => {
  const ctx = root()
  const raw = (service) => service[Symbol.for('cordis.original')]
  const start = raw(ctx.subagents).start
  const continuable = raw(ctx.subagents).startContinuable
  const register = raw(ctx.tools).register
  const execute = async () => ({})
  const parameters = { provider: { type: 'string' } }
  const definition = { name: 'subagent', description: 'Original', parameters, execute }
  ctx.tools.register(definition)
  const one = await ctx.plugin(Lock)
  const two = await ctx.plugin(Lock, { toolName: 'subagent_fork' })
  await one.dispose()
  assert.notEqual(raw(ctx.subagents).start, start)
  await two.dispose()
  assert.equal(raw(ctx.subagents).start, start)
  assert.equal(raw(ctx.subagents).startContinuable, continuable)
  assert.equal(raw(ctx.tools).register, register)
  assert.equal(definition.execute, execute)
  assert.equal(definition.parameters, parameters)
  assert.equal(definition.description, 'Original')
  assert.equal(ctx.get('subagentTools').toolDefinitions.size, 0)
})

test('shared wrappers preserve the active registration and start caller', async () => {
  const ctx = root()
  const lock = await ctx.plugin(Lock)
  let callerId
  let disposer
  const scope = await ctx.plugin({ inject: ['tools', 'subagents'], async apply(scope) {
    callerId = scope.fiber.uid
    disposer = scope.tools.register({ name: 'caller-tool' })
    assert.equal((await scope.subagents.start('spawn', { parent })).uid, callerId)
  } })
  await lock.dispose()
  assert.ok(ctx.tools.get('caller-tool'))
  await scope.dispose()
  assert.equal(ctx.tools.get('caller-tool'), undefined)
  assert.doesNotThrow(disposer)
})

test('repeated registration cleanup does not accumulate tool definitions', async () => {
  const ctx = root()
  const lock = await ctx.plugin(Lock)
  for (let count = 0; count < 20; count++) {
    const definition = { name: 'subagent', description: 'Tool', parameters: {}, execute: async () => ({}) }
    const dispose = ctx.tools.register(definition)
    assert.equal(ctx.get('subagentTools').toolDefinitions.get('subagent').size, 1)
    dispose()
    assert.equal(ctx.get('subagentTools').toolDefinitions.size, 0)
    assert.equal(definition[Symbol.for('dsh-subagent-tools-ui.lock')], undefined)
  }
  await lock.dispose()
})

test('alias ownership survives disposal of one of multiple live scopes', async () => {
  const ctx = root()
  ctx.provide('agentTeams', {})
  const first = await ctx.plugin(Lock)
  const second = await ctx.plugin(Lock, { toolName: 'subagent_fork' })
  await first.dispose()
  const tool = ctx.tools.get('list_subagents')
  assert.ok(tool)
  assert.deepEqual(await tool.execute({}, { agent: parent }), [])
  await second.dispose()
  assert.equal(ctx.tools.get('list_subagents'), undefined)
})

test('independent Harness roots do not share aliases or selections', async () => {
  const first = root()
  const second = root()
  first.provide('agentTeams', {}); second.provide('agentTeams', {})
  const one = await first.plugin(Lock)
  const two = await second.plugin(Lock)
  assert.ok(first.tools.get('list_subagents'))
  assert.ok(second.tools.get('list_subagents'))
  const agent = testAgent('same-session-id')
  await first.get('subagentTools').set(agent, { mode: 'fixed', provider: 'q', model: 'chosen' })
  assert.equal((await second.get('subagentTools').get(agent)).mode, 'inherit')
  await one.dispose(); await two.dispose()
})

test('newer fixed selections win when metadata resolves out of order', async () => {
  const ctx = root()
  const slow = deferred()
  ctx.llm.resolveModelInfo = (_provider, model) => model === 'slow' ? slow.promise : { name: 'Newer' }
  const agent = testAgent('fixed-race')
  const service = ctx.get('subagentTools')
  const first = service.set(agent, { mode: 'fixed', provider: 'p', model: 'slow' })
  await service.set(agent, { mode: 'fixed', provider: 'p', model: 'newer' })
  slow.resolve({ name: 'Older' })
  await first
  assert.equal(service.states.get(agent.id).model, 'newer')
  assert.equal(agent.notices.length, 1)
})

test('a newer inheritance choice supersedes pending fixed metadata', async () => {
  const ctx = root()
  const slow = deferred()
  ctx.llm.resolveModelInfo = (_provider, model) => model === 'slow' ? slow.promise : { name: 'Parent' }
  const agent = testAgent('inherit-race')
  const service = ctx.get('subagentTools')
  const first = service.set(agent, { mode: 'fixed', provider: 'q', model: 'slow' })
  await service.set(agent, { mode: 'inherit' })
  slow.resolve({ name: 'Older' })
  await first
  assert.equal(service.states.get(agent.id).mode, 'inherit')
  assert.equal(agent.notices.length, 1)
})

test('disposed sessions suppress pending selection state and notices', async () => {
  const ctx = root()
  const slow = deferred()
  ctx.llm.resolveModelInfo = () => slow.promise
  const agent = testAgent('disposed-fixed')
  const service = ctx.get('subagentTools')
  const pending = service.set(agent, { mode: 'fixed', provider: 'q', model: 'slow' })
  ctx.emit('agent/disposed', { agent })
  slow.resolve({ name: 'Older' })
  assert.equal(await pending, undefined)
  assert.equal(service.states.has(agent.id), false)
  assert.equal(agent.notices.length, 0)
  await assert.rejects(service.set(agent, { mode: 'inherit' }), /disposed/)
})

test('plugin unload invalidates pending model metadata work', async () => {
  const ctx = new Context()
  new Tools(ctx); new Subagents(ctx); new Agents(ctx); new Llm(ctx); new Prompt(ctx)
  const slow = deferred()
  ctx.llm.resolveModelInfo = () => slow.promise
  const owner = await ctx.plugin({ apply(scope) { new Selection(scope) } })
  const service = ctx.get('subagentTools')
  const agent = testAgent('plugin-unload')
  const pending = service.get(agent)
  await owner.dispose()
  slow.resolve({ name: 'Late' })
  assert.equal(await pending, undefined)
  assert.equal(service.states.has(agent.id), false)
  assert.equal(agent.notices.length, 0)
})

test('host startup mounts consumers after the selection service is ready', async () => {
  const ctx = new Context()
  new Tools(ctx); new Subagents(ctx); new Agents(ctx); new Llm(ctx); new Prompt(ctx)
  const host = await ctx.plugin(HostPlugin)
  // Child plugin activation is asynchronous. Settle all consumers before checking.
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) await fiber.await()
  }
  assert.ok(ctx.get('subagentTools'))
  assert.equal(ctx.subagents[Symbol.for('dsh-subagent-tools-ui.lock')], true)
  await host.dispose()
  assert.equal(ctx.subagents[Symbol.for('dsh-subagent-tools-ui.lock')], undefined)
})

test('actual Desktop registry keeps independent agent scopes and cleans both', async () => {
  const ctx = new Context()
  new Subagents(ctx); new Llm(ctx); new Prompt(ctx)
  const agents = new Agents(ctx)
  new ToolRuntime(ctx)
  new Selection(ctx)
  ctx.provide('agentTeams', {})
  const firstAgent = testAgent('actual-registry-one')
  const secondAgent = testAgent('actual-registry-two')
  agents.list = () => [firstAgent, secondAgent]
  const one = createScope(ctx, firstAgent)
  const two = createScope(ctx, secondAgent)
  const first = await one.ctx.plugin(Lock)
  const second = await two.ctx.plugin(Lock)
  const makeTool = () => defineTool({
    name: 'subagent', description: 'Official tool', parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    execute: async () => ({}),
  })
  const firstTool = makeTool()
  const secondTool = makeTool()
  one.ctx.tools.register(firstTool)
  two.ctx.tools.register(secondTool)
  assert.equal(ctx.tools.get('subagent'), undefined)
  assert.equal(ctx.tools.get('subagent', firstAgent), firstTool)
  assert.equal(ctx.tools.get('subagent', secondAgent), secondTool)
  assert.ok(ctx.tools.get('list_subagents', firstAgent))
  assert.ok(ctx.tools.get('list_subagents', secondAgent))
  assert.equal(ctx.get('subagentTools').toolDefinitions.get('subagent').size, 2)
  await one.dispose()
  assert.equal(ctx.tools.get('list_subagents', firstAgent), undefined)
  assert.ok(ctx.tools.get('list_subagents', secondAgent))
  assert.equal(ctx.get('subagentTools').toolDefinitions.get('subagent').size, 1)
  await two.dispose()
  assert.equal(ctx.get('subagentTools').toolDefinitions.size, 0)
  assert.equal(ctx.tools.get('list_subagents', secondAgent), undefined)
  assert.equal(firstTool[Symbol.for('dsh-subagent-tools-ui.lock')], undefined)
  assert.equal(secondTool[Symbol.for('dsh-subagent-tools-ui.lock')], undefined)
})

test('host unload releases patches mounted into still-live root chats', async () => {
  const ctx = new Context()
  new Tools(ctx); new Subagents(ctx); new Agents(ctx); new Llm(ctx); new Prompt(ctx)
  const host = await ctx.plugin(HostPlugin)
  const agent = testAgent('host-owned-root')
  const scope = createScope(ctx, agent)
  agent.ctx = scope.ctx
  ctx.emit('agent/created', { agent })
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) await fiber.await()
  }
  const definition = { name: 'subagent', description: 'Tool', parameters: {}, execute: async () => ({}) }
  scope.ctx.tools.register(definition)
  assert.equal(definition[Symbol.for('dsh-subagent-tools-ui.lock')], true)
  const service = ctx.get('subagentTools')
  await service.set(agent, { mode: 'fixed', provider: 'q', model: 'chosen' })
  await host.dispose()
  assert.equal(definition[Symbol.for('dsh-subagent-tools-ui.lock')], undefined)
  assert.equal(ctx.subagents[Symbol.for('dsh-subagent-tools-ui.lock')], undefined)
  assert.equal(service.states.size, 0)
  await scope.dispose()
})

test('inheritance refresh observes a parent model changed during metadata lookup', async () => {
  const ctx = root()
  const slow = deferred()
  ctx.llm.resolveModelInfo = (_provider, model) => model === 'm' ? slow.promise : { name: 'Latest' }
  let route = { provider: 'p', model: 'm' }
  const agent = testAgent('changed-parent')
  agent.session = { header: {}, requestHeader: () => ({ config: route }) }
  const service = ctx.get('subagentTools')
  const pending = service.get(agent)
  route = { provider: 'q', model: 'latest' }
  slow.resolve({ name: 'Previous' })
  assert.equal((await pending).model, 'latest')
  assert.equal(service.states.get(agent.id).modelName, 'Latest')
})

test('session disposal releases host-owned root patches before host unload', async () => {
  const ctx = new Context()
  new Tools(ctx); new Subagents(ctx); new Agents(ctx); new Llm(ctx); new Prompt(ctx)
  const host = await ctx.plugin(HostPlugin)
  const agent = testAgent('early-root-disposal')
  const scope = createScope(ctx, agent)
  agent.ctx = scope.ctx
  ctx.emit('agent/created', { agent })
  for (const runtime of ctx.registry.values()) {
    for (const fiber of runtime.fibers) await fiber.await()
  }
  const runtime = ctx.registry.get(Lock)
  assert.equal(runtime.fibers.length, 4)
  await ctx.parallel('agent/disposed', { agent })
  assert.equal(runtime.fibers.length, 2)
  await scope.dispose()
  await host.dispose()
})
