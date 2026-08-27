/** Pure, dependency-injected panel-preference write queue. */
import type { PanelFocus, SessionPreferences } from '../../contract/index.ts'
import type { PanelPreferenceScope } from '../lib/panelPrefs.ts'

export interface PanelPreferenceLocalState {
  focus: PanelFocus | null
  dirty: boolean
}

export interface PanelPreferenceDeps {
  scope: () => PanelPreferenceScope
  patch: (sessionId: string, focus: PanelFocus | null) => Promise<SessionPreferences>
  getLocal: (sessionId: string, scope: PanelPreferenceScope) => PanelPreferenceLocalState | undefined
  setLocal: (sessionId: string, focus: PanelFocus | null, scope: PanelPreferenceScope) => void
  acknowledge: (sessionId: string, expected: PanelFocus | null, returned: SessionPreferences, scope: PanelPreferenceScope) => void
  adopt: (sessionId: string, returned: SessionPreferences | undefined, scope: PanelPreferenceScope) => PanelFocus | null | undefined
}

const sameFocus = (a: PanelFocus | null, b: PanelFocus | null): boolean =>
  a === null || b === null ? a === b : a.kind === b.kind && a.id === b.id

export function createPanelPreferenceController(deps: PanelPreferenceDeps) {
  const desired = new Map<string, PanelFocus | null>()
  const chains = new Map<string, Promise<void>>()
  const gates = new Map<string, Promise<unknown>>()
  const keyFor = (scope: PanelPreferenceScope, sessionId: string) => `${scope ?? ''}\u0000${sessionId}`

  const enqueue = (scope: PanelPreferenceScope, sessionId: string): void => {
    const key = keyFor(scope, sessionId)
    if (chains.has(key) || gates.has(key)) return
    const local = deps.getLocal(sessionId, scope)
    if (!desired.has(key) && !local?.dirty) return
    const expected = desired.has(key) ? desired.get(key)! : local!.focus
    let succeeded = false
    const run = deps
      .patch(sessionId, expected)
      .then((returned) => {
        succeeded = true
        // Account switches may happen while the request is in flight. Always
        // acknowledge against the scope captured when the write began.
        deps.acknowledge(sessionId, expected, returned, scope)
        const current = desired.get(key)
        if (current !== undefined && sameFocus(current, expected)) desired.delete(key)
      })
      .catch(() => {
        // Offline/server failure: keep desired + dirty. The next session read
        // or local act retries; never spin a hot retry loop.
      })
      .finally(() => {
        if (chains.get(key) !== run) return
        chains.delete(key)
        if (succeeded && desired.has(key)) enqueue(scope, sessionId)
      })
    chains.set(key, run)
  }

  const remember = (sessionId: string, focus: PanelFocus | null, ready?: Promise<unknown>): void => {
    const scope = deps.scope()
    const key = keyFor(scope, sessionId)
    deps.setLocal(sessionId, focus, scope)
    desired.set(key, focus)
    if (ready) {
      // A just-attached focus is not valid server-side until its workspace
      // write lands. Keep the UI/local mirror immediate, but gate every queue
      // entry (including an authoritative-read retry) on that prerequisite.
      const gate = ready.catch(() => undefined)
      gates.set(key, gate)
      void gate.finally(() => {
        if (gates.get(key) !== gate) return
        gates.delete(key)
        enqueue(scope, sessionId)
      })
      return
    }
    enqueue(scope, sessionId)
  }

  const resolve = (
    sessionId: string,
    serverPreferences: SessionPreferences | undefined,
  ): PanelFocus | null | undefined => {
    const scope = deps.scope()
    const key = keyFor(scope, sessionId)
    if (desired.has(key)) {
      enqueue(scope, sessionId)
      return desired.get(key)!
    }
    const local = deps.getLocal(sessionId, scope)
    if (local?.dirty) {
      desired.set(key, local.focus)
      enqueue(scope, sessionId)
      return local.focus
    }
    return deps.adopt(sessionId, serverPreferences, scope)
  }

  return { remember, resolve }
}
