/** The one pre-application surface. It is deliberately resource-neutral: the
 * app exposes neither workspace nor auth chrome until account, code, or a
 * capability-bearing entry has reached an honest next state. */
import { ClaudeMark } from './ClaudeMark'
import { Spinner } from './Spinner'
import { SECONDARY_BUTTON_CLASS, SOLID_BUTTON_CLASS } from '../lib/button'

type AppBootstrapScreenProps =
  | { status: 'loading' | 'error' | 'asset-error' | 'account-changed'; onRetry: () => void }
  | { status: 'shared-loading' }
  | { status: 'shared-error'; onRetry: () => void; onExit: () => void }
  | { status: 'shared-unavailable'; onExit: () => void }
  | { status: 'shared-account-changed'; onRetry: () => void }

export function AppBootstrapScreen(props: AppBootstrapScreenProps) {
  const { status } = props
  const loading = status === 'loading' || status === 'shared-loading'
  const accountChanged = status === 'account-changed' || status === 'shared-account-changed'
  return (
    <div
      data-testid="app-bootstrap"
      data-bootstrap-state={status}
      className="flex min-h-dvh w-full items-center justify-center overflow-y-auto bg-canvas px-6 py-8 text-ink"
    >
      <main className="flex w-full max-w-sm flex-col items-center text-center">
        <ClaudeMark size={40} />
        {loading ? (
          <div role="status" aria-live="polite" aria-atomic="true" className="mt-5">
            <h1 className="font-serif text-xl font-semibold">
              {status === 'shared-loading' ? 'Opening shared item' : 'Opening Agent Commons'}
            </h1>
            <p className="mt-3 inline-flex items-center gap-2 text-[12px] text-ink-faint">
              <Spinner size={13} />
              {status === 'shared-loading' ? 'Checking access…' : 'Loading your account…'}
            </p>
          </div>
        ) : (
          <div role="alert" className="mt-5">
            <h1 className="font-serif text-xl font-semibold">
              {status === 'asset-error'
                ? 'Couldn’t load sign in'
                : status === 'shared-error'
                  ? 'Couldn’t open shared item'
                  : status === 'shared-unavailable'
                    ? 'This share link is no longer available'
                    : accountChanged
                      ? 'Your signed-in account changed'
                      : 'Couldn’t open Agent Commons'}
            </h1>
            <p className="mx-auto mt-2 max-w-[34ch] text-[13px] leading-relaxed text-ink-soft">
              {status === 'asset-error'
                ? 'The app may have updated, or the connection was interrupted. Reload to continue.'
                : status === 'shared-error'
                  ? 'The connection was interrupted. Your link is still here—try opening it again.'
                  : status === 'shared-unavailable'
                    ? 'It may have been replaced, removed, or typed incorrectly.'
                    : status === 'shared-account-changed'
                      ? 'Reload to open this link with the account that is signed in now.'
                    : status === 'account-changed'
                      ? 'Reload to continue with the account that is signed in now.'
                : 'We couldn’t reach the server. Check your connection, then try again.'}
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
              {'onRetry' in props && (
                <button
                  type="button"
                  onClick={props.onRetry}
                  className={`inline-flex items-center justify-center ${SOLID_BUTTON_CLASS} px-4 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35`}
                >
                  {status === 'asset-error' || accountChanged ? 'Reload' : 'Try again'}
                </button>
              )}
              {'onExit' in props && (
                <button
                  type="button"
                  onClick={props.onExit}
                  className={`inline-flex items-center justify-center ${status === 'shared-unavailable' ? SOLID_BUTTON_CLASS : SECONDARY_BUTTON_CLASS} px-4 py-2 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35`}
                >
                  Go to Agent Commons
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
