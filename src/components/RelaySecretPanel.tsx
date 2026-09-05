import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, KeyRound } from 'lucide-react'
import type { ModelProvider } from '../../contract/index.ts'
import { API_BASE, invalidate, keys, useProviders } from '../api'
import { bootstrapPrompt } from '../lib/connectorInstall.ts'
import { SOFT_BUTTON_CLASS } from '../lib/button.ts'
import { DIALOG_SURFACE_CLASS } from '../lib/dialog.ts'
import { SCRIM_CLASS } from '../lib/scrim.ts'
import { useFocusTrap } from '../lib/useFocusTrap.ts'
import { CopyButton } from './CopyButton.tsx'
import { Spinner } from './Spinner.tsx'

/** Shared cue for Session providers: their model answers through a user-run relay. */
export function RelayBadge() {
  return (
    <span
      title="Your own AI session answers this provider’s turns over a rendezvous relay. Tool calls are relayed through it unexecuted — each proposal still lands here as a consent card."
      className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft"
    >
      Relay
    </span>
  )
}

function CodeRow({
  text,
  ariaLabel,
  className = '',
  onCopied,
}: {
  text: string
  ariaLabel: string
  className?: string
  onCopied?: () => void
}) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 ${className}`}>
      <code className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[12px] text-ink">
        {text}
      </code>
      <CopyButton text={text} ariaLabel={ariaLabel} onCopied={onCopied} />
    </div>
  )
}

/** The rendezvous-secret reveal shared by mint and exact rotation recovery.
 * The job is to bring the provider online: one bootstrap prompt works with any
 * agent harness, liveness proves success, and copying the prompt is the only
 * non-ceremonial close gate. */
export function RelaySecretPanel({
  provider,
  secret,
  onClose,
}: {
  provider: ModelProvider
  secret: string
  onClose: () => void
}) {
  const [tookLine, setTookLine] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const live = useProviders().data?.find((candidate) => candidate.id === provider.id)
  // A pre-rotation relay may still be cached as online for a render. It cannot
  // prove the NEW credential arrived until the list also represents this exact
  // connection revision.
  const connected = live?.online === true
    && (live.connectionRevision ?? 0) === (provider.connectionRevision ?? 0)
  useEffect(() => {
    if (connected) return
    const timer = setInterval(() => invalidate(keys.providers), 2000)
    return () => clearInterval(timer)
  }, [connected])
  const canClose = connected || tookLine
  const guardedClose = () => canClose && onClose()
  useFocusTrap(dialogRef, guardedClose)
  const relayUrl = new URL(API_BASE, window.location.origin).href.replace(/\/$/, '')
  const setupUrl = `${relayUrl}/connector/setup`
  const connectorUrl = `${relayUrl}/connector`
  const prompt = bootstrapPrompt(relayUrl, secret)
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-center px-4 pt-[14dvh]" onMouseDown={guardedClose} role="dialog" aria-modal="true" aria-label="Connect your session">
      <div className={`${SCRIM_CLASS} backdrop-blur-[1px]`} />
      <div
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
        className={`relative flex h-fit w-[520px] max-w-full flex-col ${DIALOG_SURFACE_CLASS}`}
      >
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <KeyRound size={18} className="text-ink-soft" />
          <span className="text-[15px] font-semibold text-ink">Connect your session</span>
          <RelayBadge />
        </div>
        <div className="p-5">
          <p className="text-[15px] font-semibold leading-snug text-ink">Paste into the session that will do the thinking</p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-soft">
            Works in any agent — it fetches the setup guide and installs itself (MCP), or drives the relay protocol directly.
          </p>
          <CodeRow className="mt-2" text={prompt} ariaLabel="Copy bootstrap prompt" onCopied={() => setTookLine(true)} />
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
            <span className="font-semibold text-ink">Shown only in this secure step</span> — this prompt carries your secret. Use a{' '}
            <span className="font-medium text-ink-soft">dedicated session without dangerous tools</span>: relayed prompts are untrusted text. Installing by hand instead? Open the{' '}
            <a href={setupUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
              setup guide
            </a>{' '}
            or{' '}
            <a href={connectorUrl} download="session-relay.mjs" className="font-medium text-accent hover:underline">
              download the connector
            </a>
            .
          </p>
          {connected ? (
            <p className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-added-bg px-3 py-2 text-[12px] font-medium text-added">
              <CheckCircle2 size={14} className="shrink-0" />
              Connected — “{provider.label}” is answering.
            </p>
          ) : (
            <p className="mt-4 flex items-center gap-1.5 text-[11px] text-ink-faint">
              <Spinner size={11} /> Waiting for your session…
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-panel px-5 py-3">
          <span className="text-[12px] text-ink-faint">{canClose ? '' : 'Copy the prompt to continue.'}</span>
          <button
            onClick={onClose}
            disabled={!canClose}
            className={`${SOFT_BUTTON_CLASS} px-3.5 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
