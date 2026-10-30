import { useEffect, useRef, useState } from 'react'
import type { DiscoverProviderModelsRequest } from '../../contract/providerDiscovery.ts'
import { onAccountSwitch } from '../api/account.ts'
import { discardDesktopCredential, provisionDesktopCredential } from '../api/desktopCredentials.ts'
import { discoverProviderModels } from '../api/providerModelDiscovery.ts'
import { assertProviderCreationSource, captureProviderCreationSource } from '../api/providerCreationRevision.ts'
import { createProviderModelDiscoveryCore, type ProviderModelDiscoveryState } from './providerModelDiscoveryCore.ts'

const initialState: ProviderModelDiscoveryState = { status: 'idle', models: [], error: null, hasCredential: false }

/** The form owns only an unsaved read. Once Create takes a key, the durable
 * creation queue owns its acknowledgement, retry and cleanup instead. */
export function useProviderModelDiscovery(tenantId: string | undefined, onProvisioned: () => void) {
  const [state, setState] = useState(initialState)
  const core = useRef<ReturnType<typeof createProviderModelDiscoveryCore> | null>(null)
  const retired = useRef(false)
  const provisioned = useRef(onProvisioned)
  provisioned.current = onProvisioned

  useEffect(() => {
    const unsubscribe = onAccountSwitch(() => {
      retired.current = true
      core.current?.dispose()
    })
    return () => {
      unsubscribe()
      core.current?.dispose()
      core.current = null
    }
  }, [])

  const getCore = () => {
    if (retired.current || !tenantId) throw new Error('This provider draft is no longer active.')
    if (!core.current) {
      const source = captureProviderCreationSource(tenantId)
      core.current = createProviderModelDiscoveryCore({
        discover: (request, signal) => discoverProviderModels(request, source, signal),
        provision: provisionDesktopCredential,
        discard: discardDesktopCredential,
        assertCurrentAccount: () => assertProviderCreationSource(source),
        publish: setState,
        onProvisioned: () => provisioned.current(),
      })
    }
    return core.current
  }

  return {
    ...state,
    load: async (request: DiscoverProviderModelsRequest, deviceSecret?: string) => {
      try { await getCore().load(request, deviceSecret) } catch {
        if (!retired.current) setState({ ...initialState, status: 'failed', error: 'Could not load models. Check your account and connection, then try again.' })
      }
    },
    reset: () => core.current?.reset(),
    takeCredential: () => core.current?.takeCredential(),
  }
}
