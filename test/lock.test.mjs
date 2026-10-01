import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyLockToAgentOptions,
  extrasFromArgs,
  filterDirectoryGroups,
  officialDelegationArgs,
  stripRouteArgs,
} from '../lib/lock.js'

test('fixed lock wins over parent-invented route and keeps effort', () => {
  const locked = applyLockToAgentOptions(
    { provider: 'openai', model: 'gpt-x', reasoningEffort: 'low', maxTokens: 1000 },
    { mode: 'fixed', provider: 'deepseek', model: 'deepseek-v4-flash' },
    { reasoningEffort: 'high' },
  )
  assert.deepEqual(locked, {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'high',
    maxTokens: 1000,
  })
})

test('inherit lock strips route fields so the child follows the parent', () => {
  const inherited = applyLockToAgentOptions(
    { provider: 'openai', model: 'gpt-x', reasoningEffort: 'max' },
    { mode: 'inherit' },
    {},
  )
  assert.deepEqual(inherited, { reasoningEffort: 'max' })
})

test('stripRouteArgs keeps official scheduling fields and effort spelling', () => {
  assert.deepEqual(stripRouteArgs({
    description: 'scan files',
    prompt: 'do the work',
    provider: 'openai',
    model: 'gpt-x',
    backend: 'fork',
    persona: 'strict',
    toolFilter: { deny: ['bash'] },
    reasoningEffort: 'high',
    run_in_background: true,
  }), {
    description: 'scan files',
    prompt: 'do the work',
    reasoning_effort: 'high',
    run_in_background: true,
  })
})

test('extrasFromArgs reads backend, persona, filter, and either effort spelling', () => {
  assert.deepEqual(extrasFromArgs({
    backend: 'fork',
    persona: '@preset:reviewer',
    toolFilter: { allow: ['read'] },
    reasoning_effort: 'max',
  }), {
    backend: 'fork',
    persona: '@preset:reviewer',
    toolFilter: { allow: ['read'] },
    reasoningEffort: 'max',
  })
})

test('directory groups honor an official allowlist when it is enforced', () => {
  const groups = filterDirectoryGroups([
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'flash' }, { id: 'pro' }] },
    { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-x' }] },
  ], { enforced: true, routes: [{ provider: 'deepseek', model: 'flash' }] })
  assert.deepEqual(groups, [
    { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'flash' }] },
  ])
})

test('official tool args never carry locked route or effort fields', () => {
  assert.deepEqual(officialDelegationArgs({
    description: 'scan files',
    prompt: 'do the work',
    provider: 'openai',
    model: 'gpt-x',
    reasoning_effort: 'high',
    run_in_background: true,
  }), {
    description: 'scan files',
    prompt: 'do the work',
    run_in_background: true,
  })
})

test('inherit route follows Desktop pending selection and last request', async () => {
  const { parentModelRoute } = await import('../lib/lock.js')
  const agent = {
    options: { provider: 'old', model: 'created' },
    session: { requestHeader: () => ({ config: { provider: 'live', model: 'used' } }) },
  }
  assert.deepEqual(parentModelRoute(agent), { provider: 'live', model: 'used' })
  const ctx = { get: (name) => name === 'sessionProjections'
    ? { stateOf: () => ({ pending: { provider: 'new', model: 'picked' } }) }
    : undefined }
  assert.deepEqual(parentModelRoute(agent, ctx), { provider: 'new', model: 'picked' })
})

test('blank Desktop chat inherits configured default model', async () => {
  const { parentModelRoute } = await import('../lib/lock.js')
  const agent = { options: {}, session: {} }
  const ctx = { get: (name) => name === 'agentDefaultModel'
    ? { currentSelection: () => ({ provider: 'default', model: 'chat' }) }
    : undefined }
  assert.deepEqual(parentModelRoute(agent, ctx), { provider: 'default', model: 'chat' })
})
