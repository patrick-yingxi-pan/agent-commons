/** ── The app's draft controller instance (universal split Phase 6) ───────────
 *  The thin wiring around the pure draft funnel (draftCore.ts): the real api
 *  commands, the panel-pref memory, the live provider registry, and the keyed
 *  conversation store. Every host of the draft — the singleton surface today,
 *  a ConversationPane hosting the draft after the primary dissolves — drives
 *  materialization ONLY through here (one funnel, no fork). */
import { attachContext, createSession, keys, patchSession, peek, persistWorkspace } from '../api'
import { DEFAULT_PROVIDER_ID, type ModelProvider } from '../../contract/index'
import { rememberPanelPreference } from './panelPreferences'
import { conversations } from './conversationStore'
import { createDraftController } from './draftCore'

export const draft = createDraftController({
  createSession,
  attachContext,
  persistWorkspace,
  patchSession: (sessionId, patch) => patchSession(sessionId, patch),
  setPanelPref: rememberPanelPreference,
  knownProviders: () => peek<ModelProvider[]>(keys.providers),
  defaultProviderId: DEFAULT_PROVIDER_ID,
  store: conversations,
})
