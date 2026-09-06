/** Pre-workspace share-link redemption. The capability token stays in one
 * private ref; public render state carries only the recovery phase. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { AccountSwitchedError, ApiRequestError, redeemShareLink } from '../api'
import {
  sharedLinkFailurePhase,
  sharedSubjectPath,
  type SharedLinkAddress,
  type SharedLinkFailurePhase,
} from '../lib/sharedLink.ts'

export type SharedLinkRedemptionPhase =
  | 'idle'
  | 'pending'
  | SharedLinkFailurePhase
  | 'complete'

export interface SharedLinkRedemption {
  phase: SharedLinkRedemptionPhase
  retry: () => void
  dismiss: () => void
}

export function useSharedLinkRedemption(
  address: SharedLinkAddress,
  expectedSessionUserId?: string,
): SharedLinkRedemption {
  const token = useRef(address.kind === 'token' ? address.token : null)
  const sourceUserId = useRef(expectedSessionUserId)
  const started = useRef(false)
  const running = useRef(false)
  const live = useRef(false)
  const [phase, setPhase] = useState<SharedLinkRedemptionPhase>(() => {
    if (address.kind === 'none') return 'idle'
    if (address.kind === 'invalid') return 'unavailable'
    return 'pending'
  })

  const attempt = useCallback(() => {
    if (!token.current || running.current) return
    running.current = true
    setPhase('pending')
    void redeemShareLink(token.current, sourceUserId.current)
      .then(({ subject }) => {
        if (!live.current) return
        window.history.replaceState(null, '', sharedSubjectPath(subject))
        token.current = null
        setPhase('complete')
      })
      .catch((error: unknown) => {
        if (!live.current) return
        const failure = sharedLinkFailurePhase(
          error instanceof ApiRequestError ? error.status : null,
          error instanceof AccountSwitchedError,
        )
        if (failure === 'unavailable') window.history.replaceState(null, '', '/')
        setPhase(failure)
      })
      .finally(() => {
        running.current = false
      })
  }, [])

  useEffect(() => {
    live.current = true
    if (address.kind === 'invalid') window.history.replaceState(null, '', '/')
    if (address.kind === 'token' && !started.current) {
      started.current = true
      attempt()
    }
    return () => {
      live.current = false
    }
  }, [address.kind, attempt])

  const retry = useCallback(() => {
    if (phase === 'retryable') attempt()
  }, [attempt, phase])

  const dismiss = useCallback(() => {
    if (phase !== 'retryable' && phase !== 'unavailable') return
    token.current = null
    window.history.replaceState(null, '', '/')
    setPhase('idle')
  }, [phase])

  return { phase, retry, dismiss }
}
