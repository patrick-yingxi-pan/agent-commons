/** ── The full-screen auth flow (multi-account §12) ───────────────────────────
 *  A dedicated, GitHub-style onboarding surface — brand mark, one centered
 *  card, one primary action per screen — that REPLACES the workspace frame
 *  while open (App.tsx renders it instead of the app, not over it). Three
 *  views, navigable in place (useAuthScreen):
 *    • Sign in — email + password;
 *    • Create account — a stepped wizard (details → password with a live rule
 *      checklist) that submits ONE atomic signup at the end — the account is
 *      minted WITH its one namespace (FWD-5 Phase 2: no workspace step);
 *    • Choose an account — the remembered-accounts picker (the account stack):
 *      instant, credential-less hops for accounts that already signed in here.
 *  Every submit rides the SAME account-transition acknowledgement hold the
 *  sidebar menu uses — the server mints the session cookie and the world resets.
 *  This surface adds no new trust, only a
 *  front door; when `gated` (AUTH_GATE=require) the back-to-workspace escape is
 *  withheld and signing in is the only way through. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, Check } from 'lucide-react'
import { ClaudeMark } from '../ClaudeMark'
import { useAuthAccounts, useMe } from '../../api'
import {
  enqueueAccountTransition,
  enqueueCredentialAccountTransition,
  heldAccountTransition,
  useAccountTransitionStatus,
} from '../../controller/accountTransitionMutations'
import { closeAuthScreen, type AuthScreenView } from '../../controller/useAuthScreen'
import { AccountTransitionMutationNotice } from '../AccountTransitionMutationNotice'
import { accountSubtitle } from '../../lib/accountFace'
import {
  AUTH_ERROR_CLASS,
  AUTH_INPUT_CLASS,
  AUTH_LABEL_CLASS,
  AUTH_LINK_CLASS,
  AUTH_PRIMARY_CLASS,
  EMPTY_SIGNUP,
  SIGNUP_STEPS,
  passwordChecks,
  stepAfter,
  stepBefore,
  stepValid,
  type SignUpDraft,
  type SignUpStep,
} from '../../lib/authFlow'

export function AuthScreen({ view, gated }: { view: AuthScreenView; gated: boolean }) {
  // The view navigates in place (sign in ↔ create account ↔ picker) without
  // touching the store until something completes; a store-level change (a
  // fresh open) re-seeds it.
  const [mode, setMode] = useState<AuthScreenView>(view)
  useAccountTransitionStatus()
  const transitionHeld = heldAccountTransition() !== null
  useEffect(() => setMode(view), [view])
  return (
    <div data-testid="auth-screen" className="flex min-h-dvh flex-col overflow-y-auto bg-canvas text-ink">
      <AccountTransitionMutationNotice />
      <header className="flex flex-col items-center gap-3 pb-2 pt-14">
        <ClaudeMark size={40} />
      </header>
      <main className="mx-auto flex w-full max-w-sm flex-col items-center px-6 pb-10">
        {mode.kind === 'signin' && <SignIn addAccount={mode.addAccount === true} onMode={setMode} />}
        {mode.kind === 'signup' && <SignUpWizard onMode={setMode} />}
        {mode.kind === 'picker' && <AccountPicker onMode={setMode} />}
        {!gated && (
          <button
            data-testid="auth-close"
            onClick={closeAuthScreen}
            disabled={transitionHeld}
            className="mt-6 inline-flex items-center gap-1 text-[12px] text-ink-faint transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft size={12} />
            Back to the workspace
          </button>
        )}
        <p className="mt-8 max-w-[36ch] text-center text-[11px] leading-relaxed text-ink-faint">
          Demo accounts and state live in the local development backend.
        </p>
      </main>
    </div>
  )
}

/* ── Sign in ─────────────────────────────────────────────────────────────── */

function SignIn({ addAccount, onMode }: { addAccount: boolean; onMode: (m: AuthScreenView) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const frozen = busy || heldAccountTransition() !== null
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (frozen) return
    setBusy(true)
    setError('')
    const r = await enqueueCredentialAccountTransition({
      kind: 'credential-sign-in',
      email: email.trim(),
      password,
    })
    setBusy(false)
    if (!r.ok && r.message) setError(r.message)
  }
  return (
    <>
      <Title>{addAccount ? 'Add another account' : 'Sign in to Agent Commons'}</Title>
      {addAccount && (
        <Subtitle>Your current account stays signed in — you can switch between them from the sidebar.</Subtitle>
      )}
      <Card as="form" onSubmit={submit}>
        <Field label="Email" testid="auth-email">
          <input
            data-testid="auth-email"
            type="email"
            autoFocus
            autoComplete="email"
            disabled={frozen}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </Field>
        <Field label="Password" testid="auth-password">
          <input
            data-testid="auth-password"
            type="password"
            autoComplete="current-password"
            disabled={frozen}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT_CLASS}
          />
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <button type="submit" data-testid="auth-submit" disabled={frozen || !email || !password} className={AUTH_PRIMARY_CLASS}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </Card>
      <AltCard>
        New to Agent Commons?{' '}
        <button disabled={frozen} data-testid="auth-open-signup" onClick={() => onMode({ kind: 'signup' })} className={`${AUTH_LINK_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}>
          Create an account
        </button>
      </AltCard>
    </>
  )
}

/* ── Create account — the stepped wizard ─────────────────────────────────── */

function SignUpWizard({ onMode }: { onMode: (m: AuthScreenView) => void }) {
  const [step, setStep] = useState<SignUpStep>('details')
  const [draft, setDraft] = useState<SignUpDraft>(EMPTY_SIGNUP)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const frozen = busy || heldAccountTransition() !== null
  const set = (patch: Partial<SignUpDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const canAdvance = stepValid(step, draft)

  const advance = (e: FormEvent) => {
    e.preventDefault()
    if (!canAdvance || frozen) return
    const next = stepAfter(step)
    if (next) setStep(next)
  }

  // ONE atomic submit at the wizard's end: signup mints the account WITH its
  // one namespace (FWD-5 Phase 2 — there is no separate workspace to set up).
  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!canAdvance || frozen) return
    setBusy(true)
    setError('')
    const r = await enqueueCredentialAccountTransition({
      kind: 'credential-sign-up',
      name: draft.name.trim(),
      email: draft.email.trim(),
      password: draft.password,
    })
    setBusy(false)
    if (!r.ok && r.message) setError(r.message)
  }

  const stepIndex = SIGNUP_STEPS.indexOf(step)
  const titles: Record<SignUpStep, string> = {
    details: 'Create your account',
    password: 'Choose a password',
  }
  return (
    <>
      <Title>{titles[step]}</Title>
      <div className="mt-3 flex w-full items-center gap-2" aria-label={`Step ${stepIndex + 1} of ${SIGNUP_STEPS.length}`}>
        {SIGNUP_STEPS.map((s, i) => (
          <span
            key={s}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= stepIndex ? 'bg-accent' : 'bg-line'}`}
          />
        ))}
      </div>
      <p data-testid="auth-step" className="mt-2 self-start text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        Step {stepIndex + 1} of {SIGNUP_STEPS.length}
      </p>

      {step === 'details' && (
        <Card as="form" onSubmit={advance}>
          <Field label="Name" testid="auth-name">
            <input
              data-testid="auth-name"
              type="text"
              autoFocus
              autoComplete="name"
              disabled={frozen}
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              className={AUTH_INPUT_CLASS}
            />
          </Field>
          <Field label="Email" testid="auth-email">
            <input
              data-testid="auth-email"
              type="email"
              autoComplete="email"
              disabled={frozen}
              value={draft.email}
              onChange={(e) => set({ email: e.target.value })}
              className={AUTH_INPUT_CLASS}
            />
          </Field>
          <button type="submit" data-testid="auth-continue" disabled={frozen || !canAdvance} className={AUTH_PRIMARY_CLASS}>
            Continue
          </button>
        </Card>
      )}

      {step === 'password' && (
        <Card as="form" onSubmit={create}>
          <Field label="Password" testid="auth-password">
            <input
              data-testid="auth-password"
              type="password"
              autoFocus
              autoComplete="new-password"
              disabled={frozen}
              value={draft.password}
              onChange={(e) => set({ password: e.target.value })}
              className={AUTH_INPUT_CLASS}
            />
          </Field>
          <ul className="space-y-1" aria-label="Password requirements">
            {passwordChecks(draft.password).map((c) => (
              <li
                key={c.id}
                data-testid={`auth-rule-${c.id}`}
                data-ok={c.ok}
                className={`flex items-center gap-1.5 text-[12px] ${c.ok ? 'text-added' : 'text-ink-faint'}`}
              >
                <Check size={13} className={c.ok ? '' : 'opacity-30'} />
                {c.label}
              </li>
            ))}
          </ul>
          {error && <ErrorNote>{error}</ErrorNote>}
          <button type="submit" data-testid="auth-submit" disabled={frozen || !canAdvance} className={AUTH_PRIMARY_CLASS}>
            {busy ? 'Creating your account…' : 'Create account'}
          </button>
          <BackLink disabled={frozen} onClick={() => setStep(stepBefore(step)!)} />
        </Card>
      )}

      <AltCard>
        Already have an account?{' '}
        <button disabled={frozen} data-testid="auth-open-signin" onClick={() => onMode({ kind: 'signin' })} className={`${AUTH_LINK_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}>
          Sign in
        </button>
      </AltCard>
    </>
  )
}

/* ── Choose an account — the remembered-accounts picker ──────────────────── */

function AccountPicker({ onMode }: { onMode: (m: AuthScreenView) => void }) {
  const accounts = useAuthAccounts()
  const me = useMe().data
  const rows = accounts.data ?? []
  const held = heldAccountTransition()
  const mutation = useAccountTransitionStatus()
  // Nothing remembered on this browser → the picker has nothing to offer.
  // Render the sign-in form directly once truth settles; routing through an
  // effect creates an avoidable intermediate state after sign-out recovery.
  const credentialHeld = held?.kind === 'credential-sign-in' || held?.kind === 'credential-sign-up'
  if ((!held || credentialHeld) && accounts.data?.length === 0) {
    return <SignIn addAccount={false} onMode={onMode} />
  }
  return (
    <>
      <Title>Choose an account</Title>
      <Card>
        {rows.map((a) => (
          <button
            key={a.user.id}
            data-testid="auth-picker-account"
            disabled={held !== null}
            onClick={() => {
              void enqueueAccountTransition({
                kind: 'switch-account',
                sourceUserId: me?.via === 'session' ? me.user.id : null,
                targetUserId: a.user.id,
                targetName: a.user.name,
              })
            }}
            className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-solid text-[13px] font-semibold text-on-solid">
              {(a.user.name.trim().charAt(0) || '?').toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-medium text-ink">{a.user.name}</span>
              <span className="block truncate text-[11px] text-ink-faint">{accountSubtitle(a.user, a.tenant)}</span>
            </span>
            {held?.kind === 'switch-account' && held.targetUserId === a.user.id ? (
              <span className="text-[10px] font-medium text-ink-faint">
                {mutation.error ? 'Waiting for Retry' : 'Switching…'}
              </span>
            ) : a.current && <span className="text-[10px] font-medium uppercase tracking-wide text-ink-faint">Current</span>}
          </button>
        ))}
      </Card>
      <AltCard>
        <button disabled={held !== null} data-testid="auth-open-signin" onClick={() => onMode({ kind: 'signin' })} className={`${AUTH_LINK_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}>
          Sign in to another account
        </button>{' '}
        ·{' '}
        <button disabled={held !== null} data-testid="auth-open-signup" onClick={() => onMode({ kind: 'signup' })} className={`${AUTH_LINK_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}>
          Create an account
        </button>
      </AltCard>
    </>
  )
}

/* ── Local layout primitives (the GitHub-page anatomy) ───────────────────── */

function Title({ children }: { children: ReactNode }) {
  return <h1 className="text-center font-serif text-xl font-semibold text-ink">{children}</h1>
}

function Subtitle({ children }: { children: ReactNode }) {
  return <p className="mt-2 max-w-[38ch] text-center text-[12px] leading-relaxed text-ink-soft">{children}</p>
}

/** The one centered card. `as="form"` gives Enter-to-submit for free. */
function Card({ children, as, onSubmit }: { children: ReactNode; as?: 'form'; onSubmit?: (e: FormEvent) => void }) {
  const cls = 'mt-5 w-full space-y-3 rounded-xl border border-line bg-surface p-5'
  if (as === 'form') {
    return (
      <form onSubmit={onSubmit} className={cls}>
        {children}
      </form>
    )
  }
  return <div className={cls}>{children}</div>
}

/** The bordered "alternative action" strip under the card (GitHub's anatomy). */
function AltCard({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 w-full rounded-xl border border-line px-5 py-3 text-center text-[13px] text-ink-soft">
      {children}
    </div>
  )
}

function Field({ label, testid, children }: { label: string; testid: string; children: ReactNode }) {
  return (
    <label className="block" data-field={testid}>
      <span className={AUTH_LABEL_CLASS}>{label}</span>
      {children}
    </label>
  )
}

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p data-testid="auth-error" className={AUTH_ERROR_CLASS}>
      {children}
    </p>
  )
}

function BackLink({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      data-testid="auth-back"
      onClick={onClick}
      disabled={disabled}
      className="mx-auto block text-[12px] text-ink-faint transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
    >
      Back
    </button>
  )
}
