import { z } from 'zod'

const sessionIdSchema = z.string().min(1)
const selectionRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }).strict(),
  z.object({
    mode: z.literal('fixed'),
    provider: z.string().min(1),
    model: z.string().min(1),
  }).strict(),
])
const selectionStateSchema = z.object({
  mode: z.union([z.literal('inherit'), z.literal('fixed')]),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  modelName: z.string(),
  reasoningEfforts: z.array(z.string()),
  supportsMultimodal: z.boolean(),
  available: z.boolean(),
}).strict()

const codec = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, schema })
const agentParameter = {
  name: 'agent',
  wire: 'agentId',
  source: 'lookup',
  lookup: 'agent',
  codec: codec('@deepseek-ai/dsh-session/types#SessionId', sessionIdSchema),
}

export const TYPERT = {
  package: 'dsh-subagent-tools',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-subagent-tools#subagentTools/get',
      service: 'subagentTools',
      namespace: 'subagentTools',
      method: 'get',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [agentParameter],
      result: codec('dsh-subagent-tools#SubagentModelState', selectionStateSchema),
    },
    {
      id: 'dsh-subagent-tools#subagentTools/set',
      service: 'subagentTools',
      namespace: 'subagentTools',
      method: 'set',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [
        agentParameter,
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: codec('dsh-subagent-tools#SubagentModelSelection', selectionRequestSchema),
        },
      ],
      result: codec('dsh-subagent-tools#SubagentModelState', selectionStateSchema),
    },
  ],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}

export default TYPERT
