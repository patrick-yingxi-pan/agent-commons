/** The only pre-application surface. It is deliberately identity-neutral: the
 * two bootstrap reads have not yet established which account or front door is
 * truthful, so this screen exposes neither until both agree. */
import { ClaudeMark } from './ClaudeMark'
import { Spinner } from './Spinner'
import { SOLID_BUTTON_CLASS } from '../lib/button'

export function AppBootstrapScreen({
  status,
  onRetry,
}: {
  status: 'loading' | 'error'
  onRetry: () => void
}) {
  return (
    <div
      data-testid="app-bootstrap"
      data-bootstrap-state={status}
      className="flex min-h-dvh w-full items-center justify-center overflow-y-auto bg-canvas px-6 py-8 text-ink"
    >
      <main className="flex w-full max-w-sm flex-col items-center text-center">
        <ClaudeMark size={40} />
        {status === 'loading' ? (
          <div role="status" aria-live="polite" aria-atomic="true" className="mt-5">
            <h1 className="font-serif text-xl font-semibold">Opening Agent Commons</h1>
            <p className="mt-3 inline-flex items-center gap-2 text-[12px] text-ink-faint">
              <Spinner size={13} />
              Loading your account…
            </p>
          </div>
        ) : (
          <div role="alert" className="mt-5">
            <h1 className="font-serif text-xl font-semibold">Couldn’t open Agent Commons</h1>
            <p className="mx-auto mt-2 max-w-[34ch] text-[13px] leading-relaxed text-ink-soft">
              We couldn’t reach the server. Check your connection, then try again.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className={`mt-5 inline-flex items-center justify-center ${SOLID_BUTTON_CLASS} px-4 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35`}
            >
              Try again
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
