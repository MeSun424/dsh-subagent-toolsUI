import test from 'node:test'
import assert from 'node:assert/strict'
import { isTopLevelSession } from '../src/session-visibility.js'

test('Desktop catalog needs no current field for the toolbar to appear', () => {
  const sessions = {
    list: { getSnapshot: () => ({ byId: { root: { origin: 'user' }, child: { origin: 'subagent' } } }) },
    subagentAddress: (id) => id === 'addressed' ? {} : undefined,
  }
  assert.equal(isTopLevelSession(sessions, 'root'), true)
  assert.equal(isTopLevelSession(sessions, 'blank'), true)
  assert.equal(isTopLevelSession(sessions, 'child'), false)
  assert.equal(isTopLevelSession(sessions, 'addressed'), false)
  assert.equal(isTopLevelSession(sessions, undefined), false)
})
