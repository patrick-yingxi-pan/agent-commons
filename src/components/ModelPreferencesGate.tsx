import type { ReactNode } from 'react'
import { useViewerModelPreferences } from '../api'
import { AccountSwitchedError } from '../api/client.ts'
import { retryModelPreferencesRead } from '../api/modelPreferences.ts'
import { AppBootstrapScreen } from './AppBootstrapScreen'

/** Do not seed a fresh draft from a guessed default while its personal setting
 * is still unread. This gate mounts only after authentication has resolved. */
export function ModelPreferencesGate({ children }: { children: ReactNode }) {
  const query = useViewerModelPreferences()
  if (!query.data) {
    if (query.error instanceof AccountSwitchedError) {
      return <AppBootstrapScreen status="account-changed" onRetry={() => window.location.reload()} />
    }
    return <AppBootstrapScreen status={query.status === 'error' ? 'error' : 'loading'} onRetry={retryModelPreferencesRead} />
  }
  return children
}
