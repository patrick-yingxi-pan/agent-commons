import type { ReactNode } from 'react'
import type { SharedLinkAddress } from '../lib/sharedLink.ts'
import { useSharedLinkRedemption } from '../controller/useSharedLinkRedemption.ts'
import { AppBootstrapScreen } from './AppBootstrapScreen.tsx'

/** Share-link entry owns the whole pre-workspace frame so boot navigation cannot
 * mint a draft or overwrite the capability address while redemption is pending. */
export function SharedLinkGate({
  address,
  expectedSessionUserId,
  children,
}: {
  address: SharedLinkAddress
  expectedSessionUserId?: string
  children: ReactNode
}) {
  const redemption = useSharedLinkRedemption(address, expectedSessionUserId)

  if (redemption.phase === 'idle' || redemption.phase === 'complete') return children
  if (redemption.phase === 'pending') return <AppBootstrapScreen status="shared-loading" />
  if (redemption.phase === 'retryable') {
    return (
      <AppBootstrapScreen
        status="shared-error"
        onRetry={redemption.retry}
        onExit={redemption.dismiss}
      />
    )
  }
  if (redemption.phase === 'identity-changed') {
    return <AppBootstrapScreen status="shared-account-changed" onRetry={() => window.location.reload()} />
  }
  return <AppBootstrapScreen status="shared-unavailable" onExit={redemption.dismiss} />
}
