import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent'
import TYPERT from '../lib/typert.host.js'
import TYPERT_REMOTE from '../lib/typert.remote-client.js'
import { SubagentSelectionService } from '../lib/selection-service.js'
import { wrapSubagents } from '../lib/index.js'
import { apply as applyService } from '../lib/service-plugin.js'
import { callContext } from '../lib/lock.js'

const parent = {
  id: 'desktop-parent',
  options: { provider: 'old', model: 'created', reasoningEffort: 'max' },
  session: {
    header: { origin: 'user' },
    requestHeader: () => ({ config: { provider: 'live', model: 'chat', reasoningEffort: 'high' } }),
  },
}

test('Desktop Typert registers both host and remote contributions', async () => {
  const ctx = new Context()
  const registry = new TypertRegistry(ctx)
  const stopHost = registry.register(TYPERT)
  const stopRemote = registry.remotes.register(TYPERT_REMOTE)
  assert.equal(registry.local.list().length, 2)
  assert.equal(registry.remotes.list().length, 2)
  for (const descriptor of TYPERT.invocations) {
    assert.equal(descriptor.parameters[0].codec.create().parse(parent.id), parent.id)
  }
  await stopRemote()
  await stopHost()
})

function selectionHarness(lock) {
  const requests = []
  const runtime = {
    start: async (provider, request) => { requests.push({ provider, request }); return {} },
    startContinuable: async (spec) => { requests.push(spec); return { childId: 'child' } },
    getProvider: () => ({}),
  }
  const service = Object.create(SubagentSelectionService.prototype)
  Object.defineProperty(service, 'ctx', { value: {
    get: () => undefined,
    llm: { resolveCallConfig: async () => ({}) },
    subagents: runtime,
  } })
  service.lockFor = async () => lock
  wrapSubagents({ subagents: runtime }, service)
  return { runtime, requests }
}

for (const backend of ['spawn', 'fork']) {
  test(`Desktop ${backend} and continuable children honor the same fixed route`, async () => {
    const { runtime, requests } = selectionHarness({ mode: 'fixed', provider: 'child', model: 'chosen' })
    await callContext.run({ extras: { reasoningEffort: 'low' } }, async () => {
      await runtime.start(backend, { parent })
      await runtime.startContinuable({ provider: backend, request: { parent } })
    })
    for (const entry of requests) {
      const options = resolveChildAgentOptions(parent, entry.request.agentOptions, 1)
      assert.equal(options.provider, 'child')
      assert.equal(options.model, 'chosen')
      assert.equal(options.reasoningEffort, 'low')
      assert.equal(entry.provider, backend)
    }
  })
}

test('Desktop inheritance uses the latest parent request and preserves parent options', async () => {
  const before = { ...parent.options }
  const { runtime, requests } = selectionHarness({ mode: 'inherit' })
  await runtime.start('spawn', { parent, agentOptions: { provider: 'invented', model: 'bad' } })
  const options = resolveChildAgentOptions(parent, requests[0].request.agentOptions, 1)
  assert.equal(options.provider, 'live')
  assert.equal(options.model, 'chat')
  assert.deepEqual(parent.options, before)
})

test('Desktop route changes clear inherited effort when no effort is requested', async () => {
  const { runtime, requests } = selectionHarness({ mode: 'fixed', provider: 'child', model: 'chosen' })
  await runtime.start('fork', { parent })
  assert.equal(resolveChildAgentOptions(parent, requests[0].request.agentOptions, 1).reasoningEffort, undefined)
})

test('plugin leaves Desktop root model selection owned by the host', () => {
  let onCreated
  let modelHooks = 0
  const selection = { addMultimodalModels() {} }
  applyService({
    get: () => selection,
    plugin() {},
    inject(_services, callback) { callback(this) },
    effect(callback) { callback() },
    on: (name, callback) => { if (name === 'agent/created') onCreated = callback },
  })
  onCreated({ agent: { ...parent, ctx: { plugin() {}, on() { modelHooks++; return () => {} } } } })
  assert.equal(modelHooks, 0)
})

for (const backend of ['spawn', 'fork']) {
  test(`official Desktop ${backend} tool keeps extras and the user route through execute validation`, async () => {
    const { apply: applyOfficial } = await import('@deepseek-ai/dsh-tool-subagent')
    const { apply: applyLock } = await import('../lib/index.js')
    const requests = []
    const definitions = new Map()
    const provider = { name: backend, capabilities: { agentOptions: true }, prepareContinuable() {} }
    const runtime = {
      getProvider: () => provider,
      resolveMaxDepth: () => undefined,
      startContinuable: async (spec) => { requests.push(spec); return { childId: 'child' } },
      start: async (kind, request) => { requests.push({ provider: kind, request }); return {} },
    }
    const selection = Object.create(SubagentSelectionService.prototype)
    const ctx = {
      tools: {
        register: (definition) => { definitions.set(definition.name, definition); return () => {} },
        get: (name) => definitions.get(name),
      },
      subagents: runtime,
      agents: { list: () => [] },
      llm: { resolveCallConfig: async () => ({}) },
      sessionProjections: { register() {} },
      systemPrompt: { section() {}, getSectionOrder: () => 2800 },
      on() {},
      get(name) { return name === 'subagentTools' ? selection : this[name] },
    }
    Object.defineProperty(selection, 'ctx', { value: ctx })
    selection.lockFor = async () => ({ mode: 'fixed', provider: 'locked', model: 'chosen' })
    selection.registerTool = () => () => {}
    selection.addMultimodalModels = () => {}
    const toolName = backend === 'spawn' ? 'subagent' : 'subagent_fork'
    applyLock(ctx, { toolName })
    applyOfficial(ctx, { provider: backend, toolName, backgroundMode: 'continuable' })
    const tool = definitions.get(toolName)
    assert.ok(tool.parameters.properties.reasoning_effort)
    const result = await tool.execute({
      description: 'compatibility test', prompt: 'no model request',
      reasoning_effort: 'low', persona: 'review carefully', toolFilter: { deny: ['bash'] },
    }, { agent: parent, signal: new AbortController().signal })
    assert.equal(result.subagentId, 'child')
    assert.deepEqual(requests[0].request.agentOptions, { provider: 'locked', model: 'chosen', reasoningEffort: 'low' })
    assert.equal(requests[0].request.persona, 'review carefully')
    assert.deepEqual(requests[0].request.toolFilter, { deny: ['bash'] })
  })
}

test('Desktop persona presets accept prefix/suffix and legacy text', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { resolvePersona } = await import('../lib/persona.js')
  const home = await mkdtemp(join(tmpdir(), 'dsh-subagent-persona-'))
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = home
    const directory = join(home, '.agent-presets', 'reviewer')
    await mkdir(directory, { recursive: true })
    const file = join(directory, 'agent.cordis.yml')
    await writeFile(file, '- id: persona\n  config:\n    prefix: Review carefully\n    suffix: Summarize findings\n')
    assert.equal(await resolvePersona('@preset:reviewer'), 'Review carefully\n\nSummarize findings')
    await writeFile(file, '- id: persona\n  config:\n    text: Legacy reviewer\n')
    assert.equal(await resolvePersona('@preset:reviewer'), 'Legacy reviewer')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})
