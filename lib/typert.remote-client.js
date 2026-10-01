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
const allowedRouteSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
}).strict()
const selectionStateSchema = z.object({
  mode: z.union([z.literal('inherit'), z.literal('fixed')]),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  modelName: z.string(),
  reasoningEfforts: z.array(z.string()),
  supportsMultimodal: z.boolean(),
  available: z.boolean(),
  allowlistEnforced: z.boolean(),
  allowedRoutes: z.array(allowedRouteSchema),
}).strict()
const codec = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, schema, create: () => schema })
const agentParameter = {
  name: 'agent',
  wire: 'agentId',
  source: 'lookup',
  lookup: 'agent',
  codec: codec('@deepseek-ai/dsh-session/types#SessionId', sessionIdSchema),
}

export const TYPERT_REMOTE = {
  package: 'dsh-subagent-tools-ui',
  descriptors: [
    {
      id: 'dsh-subagent-tools-ui#subagentTools/get',
      service: 'subagentTools',
      namespace: 'subagentTools',
      method: 'get',
      invocation: { kind: 'direct' },
      scope: { context: 'agent', wire: 'agentId' },
      parameters: [agentParameter],
      result: codec('dsh-subagent-tools-ui#SubagentModelState', selectionStateSchema),
    },
    {
      id: 'dsh-subagent-tools-ui#subagentTools/set',
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
          codec: codec('dsh-subagent-tools-ui#SubagentModelSelection', selectionRequestSchema),
        },
      ],
      result: codec('dsh-subagent-tools-ui#SubagentModelState', selectionStateSchema),
    },
  ],
}

export default TYPERT_REMOTE
