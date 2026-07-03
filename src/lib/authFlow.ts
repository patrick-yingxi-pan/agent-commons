/** ── The auth flow's pure logic + styled primitives (multi-account §12) ──────
 *  Everything about the full-screen sign-in / sign-up surface that isn't JSX:
 *  the client-side mirrors of the server's validation rules (shape hints only —
 *  the SERVER remains the gate), the sign-up wizard's step machine, and the
 *  shared class tokens every auth form control wears (form follows function:
 *  the sidebar menu's inline workspace form and the full-screen flow are the
 *  same kind of form, so they draw from the same primitives).
 *
 *  A plain module (no JSX / React / import.meta.env) so the DOM-less Node test
 *  runner locks the step machine and the password rules directly —
 *  tests/auth-flow.test.ts. */

/** Mirrors the server's `EMAIL_SHAPE` (server/routes — signup validation). */
export const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Mirrors the server's password bounds (8–128; bounded above because scrypt
 *  cost scales with input length — see server/routes signup). */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

export interface PasswordCheck {
  id: 'min' | 'max'
  label: string
  ok: boolean
}

/** The live checklist the password step renders — each rule with its current
 *  verdict, so the UI can tick rules off as the user types (GitHub-style). */
export function passwordChecks(password: string): PasswordCheck[] {
  return [
    { id: 'min', label: `At least ${PASSWORD_MIN} characters`, ok: password.length >= PASSWORD_MIN },
    { id: 'max', label: `At most ${PASSWORD_MAX} characters`, ok: password.length <= PASSWORD_MAX },
  ]
}

export function passwordOk(password: string): boolean {
  return passwordChecks(password).every((c) => c.ok)
}

/* ── The sign-up wizard's step machine ──────────────────────────────────────── */

export const SIGNUP_STEPS = ['details', 'password', 'workspace'] as const
export type SignUpStep = (typeof SIGNUP_STEPS)[number]

/** What the wizard collects across its steps; ONE atomic signup submits at the
 *  end (the server's POST /auth/signup is all-or-nothing — no half-created
 *  account if the user abandons mid-wizard). */
export interface SignUpDraft {
  name: string
  email: string
  password: string
  /** Optional org workspace to create right after the account (the personal
   *  workspace is always created by signup itself). Empty = skip. */
  teamWorkspace: string
}

export const EMPTY_SIGNUP: SignUpDraft = { name: '', email: '', password: '', teamWorkspace: '' }

/** Whether a step's inputs allow advancing — the Continue button's gate. The
 *  workspace step is always passable (its input is optional). */
export function stepValid(step: SignUpStep, draft: SignUpDraft): boolean {
  switch (step) {
    case 'details':
      return draft.name.trim().length > 0 && EMAIL_SHAPE.test(draft.email.trim())
    case 'password':
      return passwordOk(draft.password)
    case 'workspace':
      return true
  }
}

export function stepAfter(step: SignUpStep): SignUpStep | null {
  const i = SIGNUP_STEPS.indexOf(step)
  return SIGNUP_STEPS[i + 1] ?? null
}

export function stepBefore(step: SignUpStep): SignUpStep | null {
  const i = SIGNUP_STEPS.indexOf(step)
  return i > 0 ? SIGNUP_STEPS[i - 1] : null
}

/* ── Shared styled primitives (form follows function) ───────────────────────
 * Every auth-flow form control — full-screen sign-in/sign-up AND the sidebar
 * menu's inline workspace form — wears these, so the two surfaces can't drift
 * apart. Locked by tests/auth-flow.test.ts (no component re-hardcodes them). */

export const AUTH_INPUT_CLASS =
  'w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30'

export const AUTH_LABEL_CLASS = 'mb-1 block text-[12px] font-medium text-ink-soft'

export const AUTH_PRIMARY_CLASS =
  'w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50'

export const AUTH_LINK_CLASS = 'font-medium text-accent-strong transition hover:underline'

export const AUTH_ERROR_CLASS = 'rounded-md border border-removed/40 bg-removed/10 px-3 py-2 text-[12px] text-removed'
