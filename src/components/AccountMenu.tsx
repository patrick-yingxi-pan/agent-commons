/** Deferred account menu content (multi-account §6.6; §12: the switcher).
 *  The always-visible identity chip lives in AccountChip.tsx; only this
 *  low-frequency menu body waits for its first open.
 *
 *  The menu's sections, top to bottom:
 *    • Invitations — the caller's PENDING org invites (FWD-6 O-D3, the v1
 *      door): accept mints the seat and re-reads the world; decline closes.
 *    • Organizations — the caller's org SEATS. Every row is a DOOR to the
 *      org's namespace page (D21 — openOwner), NEVER a switch: an org is a
 *      namespace, not a world (FWD-6 O-D1; the deleted workspace rows re-minted
 *      the session — these navigate). Plus the inline "New organization…" form.
 *    • Accounts — every account SIGNED IN on this browser (the account stack,
 *      `GET /v1/auth/accounts`), in SIGN-IN ORDER — switching never reorders
 *      the rows (the server's stack merge is in-place, server/auth.ts). Each
 *      row is an instant, credential-less hop (GitHub-style) and carries a
 *      HOVER sign-out: on the active account it's the full sign-out (session
 *      clears, land on the picker); on any other it just forgets that account
 *      here (DELETE /v1/auth/accounts/:id). "Add account…" is the menu's last
 *      line — there is no separate "Account" section; when nothing is signed
 *      in, Sign in… / Create account… stand in its place (both open the
 *      dedicated full-screen flow, §12 — src/components/auth/AuthScreen.tsx).
 *
 *  The old "Your workspaces" section (workspace re-mints + the inline "New
 *  workspace" form) is gone — FWD-5 Phase 2, the workspace collapse: an account
 *  IS its one namespace, so the only thing to switch is the ACCOUNT
 *  (docs/design/principals-and-namespaces.md). All dismissal via useDismissable
 *  (the shared hook — design invariant) in the chip shell. */
import { lazy, Suspense, useState, type FormEvent, type ReactNode } from 'react'
import { LogOut } from 'lucide-react'
import {
  useAuthAccounts,
  useMe,
  useMyOrgs,
} from '../api'
import { openAuthScreen } from '../controller/useAuthScreen'
import {
  enqueueAccountTransition,
  heldAccountTransition,
  useAccountTransitionStatus,
} from '../controller/accountTransitionMutations'
import {
  enqueueOrgCreation,
  heldOrgCreationIntent,
  useOrgCreationStatus,
} from '../controller/orgCreationMutations'
import { accountSubtitle } from '../lib/accountFace'
import { AUTH_ERROR_CLASS, AUTH_INPUT_CLASS, AUTH_PRIMARY_CLASS } from '../lib/authFlow'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import { SIDEBAR_HOVER } from '../lib/sidebar'

const OrgInvitationMenuSection = lazy(() =>
  import('./OrgInvitationMenuSection').then((module) => ({ default: module.OrgInvitationMenuSection })),
)

export function AccountMenuContent({
  me,
  mode,
  onClose,
  onNewOrg,
  onBack,
  onOpenOwner,
}: {
  me: ReturnType<typeof useMe>['data']
  mode: 'menu' | 'neworg'
  onClose: () => void
  onNewOrg: () => void
  onBack: () => void
  onOpenOwner?: (name: string) => void
}) {
  return mode === 'menu'
    ? <MenuBody me={me} onClose={onClose} onNewOrg={onNewOrg} onOpenOwner={onOpenOwner} />
    : <NewOrgForm onBack={onBack} onDone={onClose} onOpenOwner={onOpenOwner} />
}

function MenuBody({
  me,
  onClose,
  onNewOrg,
  onOpenOwner,
}: {
  me: ReturnType<typeof useMe>['data']
  onClose: () => void
  onNewOrg: () => void
  onOpenOwner?: (name: string) => void
}) {
  const stacked = useAuthAccounts().data ?? []
  const orgs = useMyOrgs().data ?? []
  const signedIn = me?.via === 'session'
  const sourceUserId = signedIn ? me.user.id : null
  const held = heldAccountTransition()
  const transition = useAccountTransitionStatus()
  const transitionLabel = (userId: string): string | null => {
    if (!held) return null
    if (held.kind === 'sign-out' && held.sourceUserId === userId) {
      return transition.error ? 'Waiting for Retry' : 'Signing out…'
    }
    if ('targetUserId' in held && held.targetUserId === userId) {
      if (transition.error) return 'Waiting for Retry'
      return held.kind === 'switch-account' ? 'Switching…' : 'Forgetting…'
    }
    return null
  }
  return (
    <fieldset disabled={held !== null} aria-busy={held ? 'true' : undefined} className="contents">
      <Suspense fallback={null}>
        <OrgInvitationMenuSection />
      </Suspense>
      {/* Always offered — founding needs only an identity (the desktop's
          credential-less default included); JOINING still needs a signed-in
          email for the invite to land. */}
      <SectionLabel>Organizations</SectionLabel>
      {orgs.map((o) => (
        <Row
          key={o.tenant.id}
          testid="org-option"
          onClick={() => {
            onClose()
            onOpenOwner?.(o.tenant.name) // a DOOR to the org's page — never a switch
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {o.tenant.name}
            <span className="ml-1 text-[10px] text-ink-faint">{o.role}</span>
          </span>
        </Row>
      ))}
      <Row testid="org-new" onClick={onNewOrg}>
        + New organization…
      </Row>
      {stacked.length > 0 && (
        <>
          <SectionLabel>Accounts</SectionLabel>
          {/* SIGN-IN ORDER, straight from the server (the stack merge is
              in-place) — never re-sorted here, active-first included: the rows
              must not shuffle under the pointer when a switch lands. */}
          {stacked.map((a) => (
            <div key={a.user.id} data-testid="account-stack-row" className="group relative">
              <button
                data-testid="account-stack-option"
                onClick={() => {
                  if (a.current) {
                    onClose()
                  } else {
                    void enqueueAccountTransition({
                      kind: 'switch-account',
                      sourceUserId,
                      targetUserId: a.user.id,
                      targetName: a.user.name,
                    })
                  }
                }}
                className={`${rowClass(a.current)} pr-8`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {a.user.name}
                  <span className="ml-1 text-[10px] text-ink-faint">{accountSubtitle(a.user, a.tenant)}</span>
                </span>
                <span className="text-[10px] text-ink-faint">
                  {transitionLabel(a.user.id) ?? (a.current ? 'Active' : '')}
                </span>
              </button>
              {/* The per-row sign-out — a real control, so HOVER_REVEAL (UI-7:
                  persistent on touch tiers; focus reveals it for the keyboard
                  path, WCAG 2.1.1). Active account: the full sign-out (session
                  clears, land on the picker). Any other: just forget it on
                  this browser — the menu stays put and re-reads. */}
              <button
                data-testid={a.current ? 'auth-signout' : 'account-stack-signout'}
                aria-label={a.current ? `Sign out of ${a.user.name}` : `Forget ${a.user.name} on this browser`}
                title={a.current ? 'Sign out' : 'Sign out of this account here'}
                onClick={() => {
                  void enqueueAccountTransition(a.current
                    ? { kind: 'sign-out', sourceUserId: sourceUserId ?? a.user.id, sourceName: a.user.name, all: false }
                    : {
                        kind: 'forget-account',
                        sourceUserId,
                        targetUserId: a.user.id,
                        targetName: a.user.name,
                      })
                }}
                className={`absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:bg-panel-2 hover:text-ink focus-visible:opacity-100 ${HOVER_REVEAL}`}
              >
                <LogOut size={12} aria-hidden />
              </button>
            </div>
          ))}
        </>
      )}
      {/* The menu's last line: adding is the one account-level act left down
          here (per-account sign-out lives on the rows above — no "Account"
          section). Signed out entirely, the same slot offers the doors in. */}
      {signedIn || stacked.length > 0 ? (
        <Row
          testid="auth-add-account"
          onClick={() => {
            onClose()
            openAuthScreen({ kind: 'signin', addAccount: true })
          }}
        >
          + Add account…
        </Row>
      ) : (
        <>
          <Row
            testid="auth-signin"
            onClick={() => {
              onClose()
              openAuthScreen({ kind: 'signin' })
            }}
          >
            Sign in…
          </Row>
          <Row
            testid="auth-signup"
            onClick={() => {
              onClose()
              openAuthScreen({ kind: 'signup' })
            }}
          >
            Create account…
          </Row>
        </>
      )}
    </fieldset>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">{children}</div>
}

/** The one menu-row look — Row and the stacked-account button (which needs a
 *  wrapper for its hover sign-out, so it can't BE a Row) share it verbatim. */
function rowClass(active?: boolean): string {
  return `flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition ${
    active ? 'bg-panel-2 font-medium text-ink' : `text-ink-soft ${SIDEBAR_HOVER} hover:text-ink`
  }`
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
    <button data-testid={testid} onClick={onClick} className={rowClass(active)}>
      {children}
    </button>
  )
}

/** The inline "New organization" form (FWD-6 O3). Wears the shared auth-form
 *  primitives (authFlow.ts) like every auth-adjacent form; on success the menu
 *  closes through the new org's DOOR (its namespace page). */
function NewOrgForm({
  onBack,
  onDone,
  onOpenOwner,
}: {
  onBack: () => void
  onDone: () => void
  onOpenOwner?: (name: string) => void
}) {
  const tenantId = useMe().data?.tenant.id
  const held = heldOrgCreationIntent()
  const mutation = useOrgCreationStatus()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const frozen = held !== null
  const visibleName = held?.request.name ?? name
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!tenantId || frozen) return
    setError('')
    try {
      const result = await enqueueOrgCreation({ tenantId, request: { name } })
      if (result.outcome === 'applied') {
        onDone()
        onOpenOwner?.(result.tenant.name)
      } else {
        setError('Your organization name is still here. Review it, then create again when ready.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare organization recovery.')
    }
  }
  return (
    <form onSubmit={submit} aria-busy={frozen ? 'true' : undefined} className="space-y-1.5 p-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-ink">New organization</span>
        <button type="button" onClick={onBack} disabled={frozen} className="text-[11px] text-ink-faint hover:text-ink disabled:opacity-45">
          Back
        </button>
      </div>
      <input
        data-testid="org-name"
        type="text"
        maxLength={120}
        placeholder="Organization name"
        value={visibleName}
        onChange={(e) => setName(e.target.value)}
        disabled={frozen}
        className={AUTH_INPUT_CLASS}
      />
      {error && (
        <p data-testid="org-error" className={AUTH_ERROR_CLASS}>
          {error}
        </p>
      )}
      <button type="submit" data-testid="org-submit" disabled={frozen || !name.trim()} className={AUTH_PRIMARY_CLASS}>
        {frozen ? (mutation.error ? 'Awaiting recovery' : 'Creating…') : 'Create organization'}
      </button>
    </form>
  )
}
