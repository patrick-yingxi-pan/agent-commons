import { useEffect } from 'react'
import { useMe } from '../api'
import {
  acknowledgeProviderSecretRotation,
  cancelProviderSecretRotationRequest,
  providerSecretRotationReveal,
  resumeProviderSecretRotation,
  retryProviderSecretRotation,
  useProviderSecretRotationStatus,
} from '../controller/providerSecretRotationMutations.ts'
import { RelaySecretPanel } from './RelaySecretPanel.tsx'
import { RevisionedMutationNotice } from './RevisionedMutationNotice.tsx'

export function ProviderSecretRotationMutationNotice() {
  const me = useMe()
  const identityKey = me.data
    ? `${me.data.user.id}:${me.data.tenant.id}:${me.data.via ?? 'unsigned'}`
    : null
  const mutation = useProviderSecretRotationStatus()
  const reveal = providerSecretRotationReveal(identityKey)
  useEffect(() => {
    if (identityKey) resumeProviderSecretRotation(identityKey)
  }, [identityKey])
  return (
    <>
      <RevisionedMutationNotice
        kind="provider-secret-rotation"
        mutation={mutation}
        pendingLabel="Securing relay-secret rotation…"
        discardLabel="Cancel request"
        onRetry={retryProviderSecretRotation}
        onDiscard={cancelProviderSecretRotationRequest}
      />
      {reveal && (
        <RelaySecretPanel
          provider={reveal.provider}
          secret={reveal.secret}
          onClose={() => acknowledgeProviderSecretRotation(reveal.provider.id)}
        />
      )}
    </>
  )
}
