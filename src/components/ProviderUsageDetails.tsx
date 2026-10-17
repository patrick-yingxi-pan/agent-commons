import { useEffect, useRef, useState } from 'react'
import type { ProviderBalance, ProviderRateLimit } from '../../contract/providerUsage.ts'
import type { UsageModelRef } from '../../contract/usage.ts'
import { invalidate, keys, refreshProviderBalance, useProviderUsage } from '../api'

const RATE_LABELS: Record<ProviderRateLimit['key'], string> = {
  requests: 'Requests',
  tokens: 'Tokens',
  'input-tokens': 'Input tokens',
  'output-tokens': 'Output tokens',
  'project-tokens': 'Project tokens',
}

const BALANCE_ERRORS: Record<Extract<ProviderBalance, { status: 'error' }>['reason'], string> = {
  authentication: 'Balance check failed: check this connection’s API credentials in Models.',
  'rate-limited': 'Balance check was rate-limited. Try again later.',
  unavailable: 'Balance is temporarily unavailable. Try again later.',
  'invalid-response': 'The provider returned an unreadable balance response. Try again later.',
}

function ObservedTime({ at }: { at: number }) {
  return <time dateTime={new Date(at).toISOString()}>{new Date(at).toLocaleString()}</time>
}

/** Reads observations only. Balance checks are explicit; no model turn is sent. */
export function ProviderUsageDetails({ model }: { model: UsageModelRef }) {
  const query = useProviderUsage(model.providerId, model.modelId)
  const [checkingBalance, setCheckingBalance] = useState(false)
  const [balanceReadFailed, setBalanceReadFailed] = useState(false)
  const [now, setNow] = useState(Date.now)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // A reset only expires the observation; it never refills a counter or polls.
  useEffect(() => {
    const nextReset = query.data?.rateLimits
      .map(rate => rate.resetAt)
      .filter((at): at is number => at !== undefined && at > now)
      .sort((a, b) => a - b)[0]
    if (nextReset === undefined) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, Math.max(0, nextReset - Date.now()) + 1))
    return () => window.clearTimeout(timer)
  }, [query.data, now])

  async function checkBalance() {
    if (checkingBalance) return
    setCheckingBalance(true)
    setBalanceReadFailed(false)
    try {
      await refreshProviderBalance(model.providerId, model.modelId)
    } catch {
      if (mounted.current) setBalanceReadFailed(true)
    } finally {
      if (mounted.current) setCheckingBalance(false)
    }
  }

  const snapshot = query.status === 'success' ? query.data : undefined
  const phase = query.status === 'error' ? 'error' : snapshot?.availability ?? 'loading'
  return (
    <section aria-label="Provider usage & quota" data-provider-usage={phase} className="space-y-1.5 text-[11px] leading-snug text-ink-soft">
      <h3 className="text-[12px] font-medium text-ink">Provider usage &amp; quota</h3>
      {phase === 'loading' && <p role="status">Loading provider usage…</p>}
      {phase === 'error' && <>
        <p role="alert">Couldn’t load provider usage.</p>
        <button type="button" onClick={() => invalidate(keys.providerUsage(model.providerId, model.modelId))} className="rounded-md px-2 py-1 text-ink hover:bg-panel-2">Retry provider usage</button>
      </>}
      {snapshot && <>
        {snapshot.availability === 'shared' && <p>Provider usage is private to the connection owner. Add your own connection in Models to see readings; shared connections do not expose private usage.</p>}
        {snapshot.availability === 'unconfigured' && <p>Configure this connection in Models to read provider usage.</p>}
        {snapshot.availability === 'unsupported' && <p>Provider usage readings are unavailable for this connection.</p>}
        {snapshot.availability === 'available' && <>
          <div>
            <h4 className="font-medium text-ink">Last observed request</h4>
            {snapshot.lastRequest ? <>
              <p className="tabular-nums">{snapshot.lastRequest.inputTokens.toLocaleString()} input · {snapshot.lastRequest.outputTokens.toLocaleString()} output tokens</p>
              <p>Observed <ObservedTime at={snapshot.lastRequest.observedAt} /></p>
              <p>Latest completed request for this connection and model; not an account total.</p>
            </> : <p>No completed request observed for this model.</p>}
          </div>
          <div>
            <h4 className="font-medium text-ink">Last observed rates</h4>
            {snapshot.rateLimits.length === 0 ? <p>No rate-limit headers observed for this model.</p> : <>
              <p>Provider response headers; historical readings, not a live balance.</p>
              <div className="mt-1 space-y-1.5">
                {snapshot.rateLimits.map(rate => <div key={rate.key} data-provider-rate={rate.key}>
                  <p className="flex flex-wrap justify-between gap-x-2 tabular-nums">
                    <span>{RATE_LABELS[rate.key]}</span>
                    <span>{rate.remaining.toLocaleString()} / {rate.limit.toLocaleString()} remaining observed</span>
                  </p>
                  <p>Observed <ObservedTime at={rate.observedAt} /></p>
                  {rate.resetAt !== undefined && <p>
                    {rate.resetAt <= now ? 'Expired observation · reset reported ' : 'Reset reported '}
                    <ObservedTime at={rate.resetAt} />
                  </p>}
                </div>)}
              </div>
            </>}
          </div>
          <div>
            <h4 className="font-medium text-ink">API balance</h4>
            {snapshot.provider === 'deepseek' && snapshot.balance.status !== 'unsupported' ? <>
              {snapshot.balance.status === 'not-requested' && <p>Balance has not been checked. Check explicitly to contact the provider.</p>}
              {snapshot.balance.status === 'available' && <>
                {snapshot.balance.amounts.map(amount => <div key={amount.currency} className="tabular-nums">
                  <p className="font-medium text-ink">{amount.currency} {amount.total}</p>
                  <p>Granted {amount.granted} · topped up {amount.toppedUp}</p>
                </div>)}
                {!snapshot.balance.isAvailable && <p role="status" className="text-ink">The provider reports insufficient balance.</p>}
                <p>Observed <ObservedTime at={snapshot.balance.observedAt} /></p>
              </>}
              {snapshot.balance.status === 'error' && <p role="alert">{BALANCE_ERRORS[snapshot.balance.reason]}</p>}
              {balanceReadFailed && <p role="alert">Couldn’t check provider balance. Try again later.</p>}
              <button type="button" disabled={checkingBalance} onClick={() => { void checkBalance() }} className="mt-1 rounded-md px-2 py-1 text-ink hover:bg-panel-2 disabled:opacity-50">
                {checkingBalance ? 'Checking balance…' : snapshot.balance.status === 'not-requested' ? 'Check balance' : 'Refresh balance'}
              </button>
              <p>Reads balance only, never generates a reply. Checks are cached for one minute.</p>
              {checkingBalance && <p role="status">Checking provider balance…</p>}
            </> : <p>Account balance is unavailable through this connection.</p>}
          </div>
        </>}
      </>}
      <p>Billing history and subscription allowance are unavailable here.</p>
    </section>
  )
}
