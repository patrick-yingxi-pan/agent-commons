import { useEffect, useRef, useState } from 'react'
import { ApiRequestError } from '../api/client'
import { peek } from '../api/cache'
import { keys } from '../api/keys'
import type { Identity } from '../../contract/identity'

/** Persist the key, never the payload. An interrupted acknowledgement can be retried
 * from the same browser tab without issuing another command for this account. */
export function usePartnerAction() {
  const retryKeys = useRef(new Map<string, string>())
  const busy = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [signInRequired, setSignInRequired] = useState(false)
  const [notice, setNotice] = useState('')
  async function run<T>(
    intent: unknown,
    perform: (key: string) => Promise<T>,
    acknowledge?: (result: T) => void,
  ) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setSignInRequired(false)
    setError('')
    setNotice('')
    let storageKey: string | undefined
    const discard = () => {
      if (!storageKey) return
      retryKeys.current.delete(storageKey)
      try {
        sessionStorage.removeItem(storageKey)
      } catch {
        /* Storage can be disabled. */
      }
    }
    try {
      const actor = peek<Identity>(keys.me)
      if (!actor || actor.via !== 'session') {
        setSignInRequired(true)
        throw new Error('Sign in to continue.')
      }
      const bytes = new TextEncoder().encode(JSON.stringify([actor.tenant.id, actor.user.id, intent]))
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      storageKey =
        'ac.task-partner.retry.' + Array.from(hash, (byte) => byte.toString(16).padStart(2, '0')).join('')
      let key = retryKeys.current.get(storageKey)
      try {
        key ??= sessionStorage.getItem(storageKey) ?? undefined
      } catch {
        /* Use the mounted session's key. */
      }
      key ??= crypto.randomUUID()
      retryKeys.current.set(storageKey, key)
      try {
        sessionStorage.setItem(storageKey, key)
      } catch {
        /* The mounted session retains the key. */
      }
      const current = peek<Identity>(keys.me)
      if (current?.user.id !== actor.user.id || current?.tenant.id !== actor.tenant.id)
        throw new Error('The active account changed. Review this action again.')
      const result = await perform(key)
      discard()
      const active = peek<Identity>(keys.me)
      if (mounted.current && active?.user.id === actor.user.id && active?.tenant.id === actor.tenant.id)
        acknowledge?.(result)
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setSignInRequired(err.status === 401 || err.reason === 'fresh_auth_required')
        if (err.status >= 400 && err.status < 500 && err.status !== 429) discard()
      }
      setError(err instanceof Error ? err.message : 'The request could not be completed. Try again.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return { pending, error, notice, setNotice, signInRequired, run }
}
