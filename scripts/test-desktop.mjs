import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const app = process.env.DSH_DESKTOP_APP ?? '/Applications/DeepSeek Harness.app'
const executable = resolve(app, 'Contents/MacOS/DeepSeek Harness')
const runtime = resolve(app, 'Contents/Resources/app.asar/dsh')
const child = spawn(executable, [
  '--expose-internals', '--import', './scripts/desktop-test-hook.mjs',
  '--test', 'test/desktop.integration.mjs',
], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_RUNTIME: runtime },
  stdio: 'inherit',
})
child.on('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.on('exit', (code) => { process.exitCode = code ?? 1 })
