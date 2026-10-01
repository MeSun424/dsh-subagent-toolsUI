import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/**
 * Resolve a per-call persona argument. A plain string is used as-is; a
 * `@preset:<id>` value loads the named agent preset's persona text.
 */
export async function resolvePersona(persona) {
  if (typeof persona !== 'string' || !persona.startsWith('@preset:')) return persona
  const id = persona.slice('@preset:'.length).trim()
  if (id.length === 0) throw new Error('dsh-subagent-tools-ui: empty preset id after `@preset:`')
  const presetsRoot = dshHomePath('.agent-presets')
  let file = join(presetsRoot, id, 'agent.cordis.yml')
  try {
    await readFile(file, 'utf8')
  } catch {
    file = await resolvePresetByDisplayName(presetsRoot, id)
  }
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    throw new Error(`dsh-subagent-tools-ui: cannot read agent preset "${id}" (${file}): ${String(error)}`)
  }
  const doc = parseYaml(raw)
  const entry = Array.isArray(doc)
    ? doc.find((row) => row !== null && typeof row === 'object' && row.id === 'persona')
    : undefined
  const config = entry?.config
  const text = typeof config?.prefix === 'string'
    ? config.prefix + (typeof config.suffix === 'string' && config.suffix.length > 0 ? '\n\n' + config.suffix : '')
    : config?.text
  if (typeof text !== 'string') {
    throw new Error(`dsh-subagent-tools-ui: agent preset "${id}" has no persona prefix or legacy text`)
  }
  return text
}

async function resolvePresetByDisplayName(presetsRoot, displayName) {
  let dirs
  try {
    dirs = await readdir(presetsRoot, { withFileTypes: true })
  } catch (error) {
    throw new Error(`dsh-subagent-tools-ui: cannot list agent presets (${presetsRoot}): ${String(error)}`)
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const metaFile = join(presetsRoot, dir.name, 'preset.yml')
    let metaRaw
    try {
      metaRaw = await readFile(metaFile, 'utf8')
    } catch {
      continue
    }
    const meta = parseYaml(metaRaw)
    if (meta !== null && typeof meta === 'object' && meta.name === displayName) {
      return join(presetsRoot, dir.name, 'agent.cordis.yml')
    }
  }
  throw new Error(`dsh-subagent-tools-ui: agent preset "${displayName}" not found under ${presetsRoot} (checked directory id and preset.yml display name)`)
}
