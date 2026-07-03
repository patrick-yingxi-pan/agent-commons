/** The account chip + menu (multi-account §6.6; P7: real onboarding). The chip
 *  label is always `/v1/me` — the server's word for who it heard, so a switch,
 *  a signup, or a sign-in becomes VISIBLE TRUTH, never an optimistic label.
 *
 *  The menu's sections, top to bottom:
 *    • Your workspaces — the signed-in account's real memberships
 *      (`GET /v1/me/workspaces`); a pick re-mints the session for that tenant.
 *      Plus an inline "New workspace" form (`POST /v1/workspaces`).
 *    • Switch identity (dev) — the SEEDED directory (`GET /v1/identities`);
 *      real accounts never appear here (they sign in). Rows for the current
 *      user are elided (their workspaces section already covers them).
 *    • Sign in / Create account — the real onboarding flows (P7): inline forms,
 *      server-minted cookie, errors shown verbatim from the API.
 *    • Sign out — back to the backend's default principal.
 *
 *  All dismissal via useDismissable (the shared hook — design invariant). */
import { useState, type FormEvent, type ReactNode } from 'react'
import {
  signIn,
  signUp,
  createWorkspace,
  switchActiveAccount,
  useCapabilities,
  useIdentities,
  useMe,
  useMyWorkspaces,
} from '../api'
import { useDismissable } from '../lib/useDismissable'
import { SIDEBAR_HOVER } from '../lib/sidebar'

type Mode = 'menu' | 'signin' | 'signup' | 'workspace'

export function AccountChip() {
  const me = useMe().data
  const switchable = useCapabilities().data?.features.identitySwitch === true
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('menu')
  const menuRef = useDismissable<HTMLDivElement>(open, () => {
    setOpen(false)
    setMode('menu')
  })
  const name = me?.user.name ?? 'You'
  const workspace = me?.tenant.name ?? 'Personal'
  const initial = name.trim().charAt(0).toUpperCase() || 'Y'
  const identityRow = (
    <div className="flex items-center gap-2" title={me?.user.email}>
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">
        {initial}
      </div>
      <div className="leading-tight">
        <div className="text-xs font-medium text-ink">{name}</div>
        <div className="text-[11px] text-ink-faint">{workspace}</div>
      </div>
    </div>
  )
  if (!switchable) {
    return <div className="border-t border-line px-3 py-2.5">{identityRow}</div>
  }
  const close = () => {
    setOpen(false)
    setMode('menu')
  }
  return (
    <div className="relative border-t border-line px-3 py-2.5" ref={menuRef}>
      {open && (
        <div className="absolute bottom-full left-2 right-2 z-20 mb-1 rounded-lg border border-line bg-panel p-1 shadow-lg">
          {mode === 'menu' && <MenuBody me={me} onMode={setMode} onClose={close} />}
          {mode === 'signin' && (
            <AuthForm
              title="Sign in"
              fields={[
                { key: 'email', label: 'Email', type: 'email' },
                { key: 'password', label: 'Password', type: 'password' },
              ]}
              onBack={() => setMode('menu')}
              onSubmit={async (v) => {
                const r = await signIn(v.email, v.password)
                if (r.ok) close()
                else throw new Error(r.message)
                return true
              }}
            />
          )}
          {mode === 'signup' && (
            <AuthForm
              title="Create account"
              fields={[
                { key: 'name', label: 'Name', type: 'text' },
                { key: 'email', label: 'Email', type: 'email' },
                { key: 'password', label: 'Password (8+ characters)', type: 'password' },
              ]}
              onBack={() => setMode('menu')}
              onSubmit={async (v) => {
                const r = await signUp(v.name, v.email, v.password)
                if (r.ok) close()
                else throw new Error(r.message)
                return true
              }}
            />
          )}
          {mode === 'workspace' && (
            <AuthForm
              title="New workspace"
              fields={[{ key: 'name', label: 'Workspace name', type: 'text' }]}
              onBack={() => setMode('menu')}
              onSubmit={async (v) => {
                const r = await createWorkspace(v.name)
                if (r.ok) close()
                else throw new Error(r.message)
                return true
              }}
            />
          )}
        </div>
      )}
      <button
        data-testid="account-chip"
        onClick={() => setOpen((o) => !o)}
        className={`-mx-1 w-[calc(100%+0.5rem)] rounded-lg px-1 py-0.5 text-left transition ${SIDEBAR_HOVER}`}
        aria-label="Switch account"
      >
        {identityRow}
      </button>
    </div>
  )
}

function MenuBody({
  me,
  onMode,
  onClose,
}: {
  me: ReturnType<typeof useMe>['data']
  onMode: (m: Mode) => void
  onClose: () => void
}) {
  const workspaces = useMyWorkspaces().data ?? []
  const identities = useIdentities(true).data ?? []
  // The seed directory, minus the current user's rows — their real memberships
  // above already cover those (no duplicate switch targets).
  const seedRows = identities.filter((i) => i.userId !== me?.user.id)
  return (
    <>
      <SectionLabel>Your workspaces</SectionLabel>
      {workspaces.map((w) => {
        const active = w.tenant.id === me?.tenant.id
        return (
          <Row
            key={w.tenant.id}
            testid="workspace-option"
            active={active}
            onClick={() => {
              onClose()
              if (!active && me) void switchActiveAccount({ userId: me.user.id, tenantId: w.tenant.id })
            }}
          >
            <span className="flex-1">
              {w.tenant.name}
              <span className="ml-1 text-[10px] text-ink-faint">{w.role}</span>
            </span>
            {active && <span className="text-[10px] text-ink-faint">Active</span>}
          </Row>
        )
      })}
      <Row testid="workspace-new" onClick={() => onMode('workspace')}>
        + New workspace…
      </Row>
      {seedRows.length > 0 && (
        <>
          <SectionLabel>Switch identity (dev)</SectionLabel>
          {seedRows.map((i) => (
            <Row
              key={`${i.userId}:${i.tenantId}`}
              testid="account-option"
              onClick={() => {
                onClose()
                void switchActiveAccount({ userId: i.userId, tenantId: i.tenantId })
              }}
            >
              <span className="flex-1">
                {i.userLabel}
                <span className="ml-1 text-[10px] text-ink-faint">{i.tenantLabel}</span>
              </span>
            </Row>
          ))}
        </>
      )}
      <SectionLabel>Account</SectionLabel>
      <Row testid="auth-signin" onClick={() => onMode('signin')}>
        Sign in…
      </Row>
      <Row testid="auth-signup" onClick={() => onMode('signup')}>
        Create account…
      </Row>
      <Row
        testid="auth-signout"
        onClick={() => {
          onClose()
          void switchActiveAccount(null)
        }}
      >
        Sign out
      </Row>
    </>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">{children}</div>
}

function Row({
  children,
  onClick,
  active,
  testid,
}: {
  children: ReactNode
  onClick: () => void
  active?: boolean
  testid: string
}) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition ${
        active ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
      }`}
    >
      {children}
    </button>
  )
}

/** One small inline form for all three flows (sign in / create account / new
 *  workspace) — same primitive, same look, opposite payloads. Submits on
 *  Enter; the API's error message shows verbatim under the fields. */
function AuthForm({
  title,
  fields,
  onSubmit,
  onBack,
}: {
  title: string
  fields: Array<{ key: string; label: string; type: string }>
  onSubmit: (values: Record<string, string>) => Promise<boolean | undefined>
  onBack: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const closed = await onSubmit(values)
      if (!closed) setError('Check the details and try again.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-1.5 p-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ink">{title}</span>
        <button type="button" onClick={onBack} className="text-[11px] text-ink-faint hover:text-ink">
          Back
        </button>
      </div>
      {fields.map((f) => (
        <input
          key={f.key}
          data-testid={`auth-${f.key}`}
          type={f.type}
          placeholder={f.label}
          value={values[f.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:ring-1 focus:ring-accent"
        />
      ))}
      {error && (
        <p data-testid="auth-error" className="text-[11px] text-removed">
          {error}
        </p>
      )}
      <button
        type="submit"
        data-testid="auth-submit"
        disabled={busy}
        className="w-full rounded-md bg-accent px-2 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Working…' : title}
      </button>
    </form>
  )
}
