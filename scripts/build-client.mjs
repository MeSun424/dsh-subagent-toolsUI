import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const zodCandidates = [
  process.env.DSH_ZOD_ENTRY,
  process.env.DSH_ZOD_ROOT ? resolve(process.env.DSH_ZOD_ROOT, 'index.js') : undefined,
  resolve(root, 'node_modules/zod/index.js'),
].filter(Boolean)

let zodEntry
for (const candidate of zodCandidates) {
  try {
    await access(candidate)
    zodEntry = candidate
    break
  } catch {
    // Try the next local Harness installation.
  }
}
if (zodEntry === undefined) throw new Error('Unable to locate zod. Set DSH_ZOD_ENTRY or DSH_ZOD_ROOT.')

const args = [
  '--yes',
  'esbuild@0.25.0',
  'src/client.js',
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  '--target=es2022',
  '--external:react',
  `--alias:zod=${zodEntry}`,
  '--banner:js=window.__ModuleLoader__.load({id:"dsh-subagent-tools-ui",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  '--footer:js=return module.exports;}});',
  '--outfile=lib/client.js',
]

await new Promise((resolveBuild, rejectBuild) => {
  const child = spawn('npx', args, { cwd: root, stdio: 'inherit' })
  child.once('error', rejectBuild)
  child.once('exit', (code, signal) => {
    if (signal !== null) rejectBuild(new Error(`esbuild terminated by ${signal}`))
    else if (code === 0) resolveBuild()
    else rejectBuild(new Error(`esbuild exited with code ${code}`))
  })
})
