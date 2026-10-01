export function isTopLevelSession(sessions, sessionId) {
  if (sessionId === undefined) return false
  const summary = sessions.list.getSnapshot().byId[sessionId]
  return summary?.origin !== 'subagent' && sessions.subagentAddress(sessionId) === undefined
}
