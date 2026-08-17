import React from 'react'
import {
  IconBranchOutline16,
  IconCheckOutline16,
  IconChevronDownOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import TYPERT_REMOTE from '../lib/typert.remote-client.js'

// Keep the original key so renaming the package does not reset session choices.
const STORAGE_PREFIX = 'dsh-subagent-tools.selection.v1:'
const CSS_ID = 'dsh-subagent-tools-ui/client'
const INHERIT = Object.freeze({ mode: 'inherit' })

const css = `
.dst-root{position:relative;min-width:0;font-family:var(--dsw-font-family);letter-spacing:0}
.dst-trigger{display:flex;align-items:center;gap:5px;min-width:0;max-width:190px;height:28px;padding:0 6px;color:var(--dsw-alias-label-secondary);font:500 13px/20px var(--dsw-font-family);letter-spacing:0;background:transparent;border:0;border-radius:24px;outline:0;cursor:pointer}
.dst-trigger:hover,.dst-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.dst-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.dst-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default;background:transparent}
.dst-icon,.dst-chevron{flex:none;color:var(--dsw-alias-label-caption)}
.dst-chevron{transition:transform .12s}
.dst-chevron-open{transform:rotate(180deg)}
.dst-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dst-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:30;display:flex;flex-direction:column;width:min(260px,calc(100vw - 32px));max-height:min(390px,calc(100vh - 96px));overflow:hidden;padding:4px;color:var(--dsw-alias-label-primary);background:var(--dsw-specific-menu);border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;box-shadow:var(--dsw-shadow-lv3);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.dst-title{flex:none;padding:6px 8px 5px;color:var(--dsw-alias-label-tertiary);font:500 12px/18px var(--dsw-font-family);letter-spacing:0}
.dst-inherit{flex:none;padding-bottom:4px;margin-bottom:1px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dst-groups{min-height:0;overflow-y:auto}
.dst-group+.dst-group{margin-top:4px}
.dst-group-title{position:sticky;top:0;z-index:1;padding:5px 8px 3px;color:var(--dsw-alias-label-tertiary);font:500 12px/18px var(--dsw-font-family);letter-spacing:0;background:var(--dsw-specific-menu)}
.dst-option{display:flex;align-items:center;gap:8px;width:100%;min-height:38px;padding:6px 8px;color:inherit;text-align:left;background:transparent;border:0;border-radius:10px;outline:0;cursor:pointer}
.dst-option:hover:not(:disabled),.dst-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dst-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.dst-copy{display:flex;flex:1;flex-direction:column;min-width:0}
.dst-name{overflow:hidden;color:inherit;font:500 14px/20px var(--dsw-font-family);letter-spacing:0;text-overflow:ellipsis;white-space:nowrap}
.dst-description{overflow:hidden;color:var(--dsw-alias-label-tertiary);font:400 12px/18px var(--dsw-font-family);letter-spacing:0;text-overflow:ellipsis;white-space:nowrap}
.dst-check{display:grid;place-items:center;flex:0 0 18px;color:var(--dsw-alias-label-primary)}
.dst-status{padding:10px;color:var(--dsw-alias-label-tertiary);font:400 13px/20px var(--dsw-font-family);letter-spacing:0}
.dst-error{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:7px 8px;margin-bottom:4px;color:var(--dsw-alias-state-error-primary);font:400 12px/18px var(--dsw-font-family);letter-spacing:0;background:var(--dsw-alias-interactive-bg-hover-danger);border-radius:8px}
.dst-retry{flex:none;padding:0;color:inherit;font:600 12px/18px var(--dsw-font-family);letter-spacing:0;background:transparent;border:0;cursor:pointer}
@media(max-width:620px){.dst-trigger{max-width:112px;padding-inline:5px}.dst-menu{right:-48px}}
`

function installStyles() {
  if (document.querySelector(`style[data-plugin-css="${CSS_ID}"]`) !== null) return
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-subagent-tools-ui'
  style.dataset.pluginCss = CSS_ID
  style.textContent = css
  document.head.appendChild(style)
}

function storageKey(sessionId) {
  return STORAGE_PREFIX + sessionId
}

function readStoredSelection(sessionId) {
  try {
    const raw = localStorage.getItem(storageKey(sessionId))
    if (raw === null) return undefined
    const value = JSON.parse(raw)
    if (value?.mode === 'inherit') return INHERIT
    if (value?.mode === 'fixed' && typeof value.provider === 'string' && value.provider.length > 0
      && typeof value.model === 'string' && value.model.length > 0) {
      return { mode: 'fixed', provider: value.provider, model: value.model }
    }
  } catch {
    // Storage is an optional browser-side restoration layer.
  }
  return undefined
}

function storeSelection(sessionId, selection) {
  try {
    localStorage.setItem(storageKey(sessionId), JSON.stringify(selection))
  } catch {
    // The live Host state remains authoritative when storage is unavailable.
  }
}

function sameSelection(state, selection) {
  if (state?.mode !== selection.mode) return false
  return selection.mode === 'inherit'
    || state.provider === selection.provider && state.model === selection.model
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function SubagentModelSelect({
  sessionId,
  visible,
  directory,
  loadDirectory,
  getSelection,
  setSelection,
  subscribeConnectionReset,
}) {
  const directoryState = React.useSyncExternalStore(
    (listener) => directory.subscribe(listener),
    () => directory.getSnapshot(),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = React.useState(false)
  const [selection, setLocalSelection] = React.useState({
    mode: 'inherit',
    modelName: '继承',
    reasoningEfforts: [],
    supportsMultimodal: false,
    available: false,
  })
  const [saving, setSaving] = React.useState(false)
  const [syncError, setSyncError] = React.useState(null)
  const rootRef = React.useRef(null)
  const generation = React.useRef(0)

  const synchronize = React.useCallback(async () => {
    const currentGeneration = ++generation.current
    setSyncError(null)
    try {
      const stored = readStoredSelection(sessionId)
      let state = await getSelection()
      if (stored !== undefined && !sameSelection(state, stored)) state = await setSelection(stored)
      if (currentGeneration !== generation.current) return
      setLocalSelection(state)
      storeSelection(sessionId, state.mode === 'fixed'
        ? { mode: 'fixed', provider: state.provider, model: state.model }
        : INHERIT)
    } catch (error) {
      if (currentGeneration === generation.current) setSyncError(errorText(error))
    }
  }, [getSelection, sessionId, setSelection])

  React.useEffect(() => {
    synchronize()
    const stop = subscribeConnectionReset(synchronize)
    return () => {
      generation.current += 1
      stop?.()
    }
  }, [subscribeConnectionReset, synchronize])

  React.useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const reload = React.useCallback(() => {
    setSyncError(null)
    loadDirectory().catch((error) => setSyncError(errorText(error)))
  }, [loadDirectory])

  const show = () => {
    setOpen(true)
    reload()
  }

  const choose = async (next) => {
    if (sameSelection(selection, next)) {
      setOpen(false)
      return
    }
    setSaving(true)
    setSyncError(null)
    try {
      const state = await setSelection(next)
      setLocalSelection(state)
      storeSelection(sessionId, next)
      setOpen(false)
    } catch (error) {
      setSyncError(errorText(error))
    } finally {
      setSaving(false)
    }
  }

  if (!visible) return null
  const label = selection.mode === 'inherit' ? '继承' : selection.modelName
  const busy = saving || directoryState.status === 'loading'
  const directoryError = syncError ?? directoryState.error
  const choices = directoryState.groups.reduce((count, group) => count + group.models.length, 0)

  return React.createElement('div', { className: 'dst-root', ref: rootRef },
    React.createElement('button', {
      type: 'button',
      className: 'dst-trigger',
      title: `子代理模型：${label}`,
      'aria-label': `子代理模型：${label}`,
      'aria-haspopup': 'menu',
      'aria-expanded': open,
      onClick: () => open ? setOpen(false) : show(),
    },
    React.createElement(IconBranchOutline16, { className: 'dst-icon', size: 12 }),
    React.createElement('span', { className: 'dst-label' }, label),
    React.createElement(IconChevronDownOutline14, {
      className: open ? 'dst-chevron dst-chevron-open' : 'dst-chevron',
    })),
    open && React.createElement('div', {
      className: 'dst-menu',
      role: 'menu',
      'aria-label': '子代理模型',
      'aria-busy': busy,
    },
    React.createElement('div', { className: 'dst-title' }, '子代理模型'),
    directoryError !== null && React.createElement('div', { className: 'dst-error', role: 'alert' },
      React.createElement('span', null, directoryError),
      React.createElement('button', { type: 'button', className: 'dst-retry', onClick: reload }, '重试')),
    React.createElement('div', { className: 'dst-inherit' },
      React.createElement('button', {
        type: 'button',
        role: 'menuitemradio',
        'aria-checked': selection.mode === 'inherit',
        className: 'dst-option',
        disabled: saving,
        onClick: () => choose(INHERIT),
      },
      React.createElement('span', { className: 'dst-copy' },
        React.createElement('span', { className: 'dst-name' }, '继承')),
      React.createElement('span', { className: 'dst-check' },
        selection.mode === 'inherit' ? React.createElement(IconCheckOutline16) : null))),
    React.createElement('div', { className: 'dst-groups scrollable' },
      directoryState.groups.map((group) => React.createElement('section', {
        key: group.id,
        className: 'dst-group',
        role: 'group',
        'aria-label': group.name,
      },
      React.createElement('div', { className: 'dst-group-title' }, group.name),
      group.models.map((model) => {
        const selected = selection.mode === 'fixed'
          && selection.provider === group.id && selection.model === model.id
        return React.createElement('button', {
          key: model.id,
          type: 'button',
          role: 'menuitemradio',
          'aria-checked': selected,
          className: 'dst-option',
          title: model.name,
          disabled: saving,
          onClick: () => choose({ mode: 'fixed', provider: group.id, model: model.id }),
        },
        React.createElement('span', { className: 'dst-copy' },
          React.createElement('span', { className: 'dst-name' }, model.name),
          model.description === undefined ? null
            : React.createElement('span', { className: 'dst-description' }, model.description)),
        React.createElement('span', { className: 'dst-check' },
          selected ? React.createElement(IconCheckOutline16) : null))
      }))),
      directoryState.status === 'loading' && choices === 0
        ? React.createElement('div', { className: 'dst-status' }, '正在加载模型...')
        : null,
      directoryState.status !== 'loading' && choices === 0
        ? React.createElement('div', { className: 'dst-status' }, '没有可用模型')
        : null)))
}

export const inject = ['remote', 'connection', 'slots', 'sessions', 'modelDirectories']

export async function apply(ctx) {
  installStyles()
  const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => disposeRemote, 'dsh-subagent-tools-ui: remote contribution')
  const invoke = (method, args) => ctx.connection.rpc.call('/api', `subagentTools/${method}`, { args })

  const registerSelector = () => ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'subagent-model',
    order: 10,
    inject: (sessionId) => {
      const directory = ctx.modelDirectories.directoryFor(sessionId)
      const unwrap = (method, answer) => {
        if (!answer.ok) throw new Error(`${method} failed: ${answer.error.code}: ${answer.error.message}`)
        return answer.value
      }
      return {
        sessionId,
        visible: true,
        directory: directory.store,
        loadDirectory: () => directory.load(),
        getSelection: async () => unwrap(
          'subagentTools.get',
          await invoke('get', { agentId: sessionId }),
        ),
        setSelection: async (request) => unwrap(
          'subagentTools.set',
          await invoke('set', { agentId: sessionId, request }),
        ),
        subscribeConnectionReset: (listener) => ctx.on('connection/reset', listener),
      }
    },
  }, SubagentModelSelect))

  ctx.effect(() => {
    let disposeSelector
    let mounted = false
    const sync = () => {
      const state = ctx.sessions.list.getSnapshot()
      const sessionId = state.current
      const summary = sessionId === undefined ? undefined : state.byId[sessionId]
      const shouldMount = sessionId !== undefined
        && summary?.origin !== 'subagent'
        && ctx.sessions.subagentAddress(sessionId) === undefined
      if (shouldMount === mounted) return
      mounted = shouldMount
      if (shouldMount) {
        disposeSelector = registerSelector()
      } else {
        disposeSelector?.()
        disposeSelector = undefined
      }
    }
    const unsubscribe = ctx.sessions.list.subscribe(sync)
    sync()
    return () => {
      unsubscribe()
      disposeSelector?.()
    }
  }, 'dsh-subagent-tools-ui: top-level selector visibility')
}
