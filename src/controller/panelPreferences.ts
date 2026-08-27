/** Durable panel-preference reconciliation.
 *
 * Local intent applies synchronously; writes serialize per session so rapid
 * focus changes cannot arrive out of order. A failed write remains dirty and
 * is retried by the next authoritative session read/push. Dependency injection
 * keeps the race rules node-testable without fetch or a DOM. */
import { patchSessionPreferences } from '../api/commands.ts'
import {
  acknowledgePanelPref,
  adoptServerPanelPref,
  getPanelPrefState,
  setPanelPref,
} from '../lib/panelPrefs.ts'
import { uiPrefScope } from '../lib/uiPrefs.ts'
import { createPanelPreferenceController } from './panelPreferencesCore.ts'

const panelPreferences = createPanelPreferenceController({
  scope: uiPrefScope,
  patch: (sessionId, panelFocus) => patchSessionPreferences(sessionId, { panelFocus }),
  getLocal: getPanelPrefState,
  setLocal: setPanelPref,
  acknowledge: acknowledgePanelPref,
  adopt: adoptServerPanelPref,
})

export const rememberPanelPreference = panelPreferences.remember
export const resolvePanelPreference = panelPreferences.resolve
