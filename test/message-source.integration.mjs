import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { assertV4RowAdmission, releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import Selection from '../lib/selection-service.js'

function harness() {
  const ctx = new Context()
  const session = Session.create('model-notice-test')
  const encoded = []
  const definition = { name: 'subagent' }
  const agent = {
    id: session.id, session, options: { provider: 'main', model: 'parent' },
    inject(message) {
      // Admit the actual plugin message through native Session validation and
      // the real V4 storage codec, rather than merely recording a mock call.
      const event = session.append('user/message', message, { surfaceOp: 'append' })
      encoded.push(releasedV4SessionFormatCodec.encodeEvent(event))
    },
  }
  ctx.provide('agents', { get: id => id === agent.id ? agent : undefined })
  ctx.provide('tools', { get: () => definition })
  ctx.provide('llm', { resolveModelInfo: async (_provider, model) => ({
    name: model, inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'high' }] },
  }) })
  const selection = new Selection(ctx)
  selection.registerTool('subagent', definition)
  return { ctx, agent, selection, session, encoded }
}

function assertNotice(h, count) {
  assert.equal(h.encoded.length, count)
  for (const event of h.session.snapshotEvents()) {
    if (event.type !== 'user/message') continue
    assert.equal(event.data.source.kind, 'plugin:dsh-subagent-tools-ui')
    assert.equal(event.data.source.plugin, undefined)
    assert.equal(event.data.source.form, 'notice')
    assert.equal(typeof event.data.source.summary, 'string')
    assert.ok(event.data.content[0].text.includes('当前模型'))
    assert.doesNotThrow(() => assertV4RowAdmission(event))
  }
}

test('official V4 admission reproduces the retired plugin source error', () => {
  const message = createUserMessage({ content: [{ type: 'text', text: 'legacy notice' }],
    source: { kind: 'plugin', plugin: 'dsh-subagent-tools-ui', form: 'notice' } })
  assert.throws(() => assertV4RowAdmission({ type: 'user/message', data: message }),
    /format v4 message requires a producer-owned source kind/)
})

test('session-start capability notice can be committed and encoded as V4', async () => {
  const h = harness()
  assert.equal(h.session.header.version, 4)
  await h.selection.refreshInherited(h.agent, true)
  assertNotice(h, 1)
})

test('fixed and inherited model changes produce valid V4 notices', async () => {
  const h = harness()
  await h.selection.set(h.agent, { mode: 'fixed', provider: 'child', model: 'chosen' })
  await h.selection.set(h.agent, { mode: 'inherit' })
  assertNotice(h, 2)
  assert.equal(h.selection.stateFor(h.agent).mode, 'inherit')
})

test('the actual session-start listener emits a valid V4 capability notice', async () => {
  const h = harness()
  let pending
  const refresh = h.selection.refreshInherited.bind(h.selection)
  h.selection.refreshInherited = (...args) => (pending = refresh(...args))
  h.ctx.emit('agent/session-start', { agent: h.agent })
  await pending
  assertNotice(h, 1)
})
