import { lazy, Suspense, useState } from 'react'
import { useCapabilities, useMe } from '../api'
import { isAccountTransitionHeld } from '../controller/accountTransitionMutations'
import { isOrgCreationHeld } from '../controller/orgCreationMutations'
import { accountSubtitle } from '../lib/accountFace'
import { useDismissable } from '../lib/useDismissable'
import { SIDEBAR_HOVER } from '../lib/sidebar'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'

const MenuContent = lazy(() => import('./AccountMenu').then((module) => ({ default: module.AccountMenuContent })))

function AccountMenuLoadState({ failed, onClose }: { failed: boolean; onClose: () => void }) {
  return (
    <div role={failed ? 'alert' : 'status'} data-account-menu-load={failed ? 'error' : 'loading'} className="p-3 text-[12px] text-ink-soft">
      {failed ? (
        <>
          <p>Couldn’t display account options.</p>
          <p className="mt-1 text-[11px] text-ink-faint">Reload to restore the account controls. Unsaved organization text may be lost.</p>
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="rounded-md px-2 py-1 text-[11px] text-ink-faint hover:bg-panel-2" onClick={onClose}>Close</button>
            <button type="button" className="rounded-md px-2 py-1 text-[11px] font-medium text-ink hover:bg-panel-2" onClick={() => window.location.reload()}>Reload account options</button>
          </div>
        </>
      ) : <p>Loading account options…</p>}
    </div>
  )
}

/** The identity chip stays in the shell; account controls load only on demand. */
export function AccountChip({ onOpenOwner }: { onOpenOwner?: (name: string) => void }) {
  const me = useMe().data
  const switchable = useCapabilities().data?.features.identitySwitch === true
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'menu' | 'neworg'>('menu')
  const close = () => {
    if (isOrgCreationHeld() || isAccountTransitionHeld()) return
    setOpen(false)
    setMode('menu')
  }
  const menuRef = useDismissable<HTMLDivElement>(open, close)
  const name = me?.user.name ?? 'You'
  const subtitle = me ? accountSubtitle(me.user, me.tenant) : 'Personal'
  const initial = name.trim().charAt(0).toUpperCase() || 'Y'
  const identityRow = (
    <div className="flex items-center gap-2" title={me?.user.email}>
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-solid text-[13px] font-semibold text-on-solid">{initial}</div>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[12px] font-medium text-ink">{name}</div>
        {subtitle && <div className="truncate text-[11px] text-ink-faint">{subtitle}</div>}
      </div>
    </div>
  )
  if (!switchable) return <div className="border-t border-line px-3 py-2.5">{identityRow}</div>

  return (
    <div className="relative border-t border-line px-3 py-2.5" ref={menuRef}>
      {open && <div className="absolute bottom-full left-2 right-2 z-20 mb-1 rounded-lg border border-line bg-panel p-1 shadow-lg">
        <DeferredLoadBoundary fallback={<AccountMenuLoadState failed onClose={close} />}>
          <Suspense fallback={<AccountMenuLoadState failed={false} onClose={close} />}>
            <MenuContent me={me} mode={mode} onClose={close} onNewOrg={() => setMode('neworg')} onBack={() => setMode('menu')} onOpenOwner={onOpenOwner} />
          </Suspense>
        </DeferredLoadBoundary>
      </div>}
      <button
        data-testid="account-chip"
        onClick={() => {
          if (isAccountTransitionHeld()) {
            setOpen(true)
            setMode('menu')
            return
          }
          if (isOrgCreationHeld()) {
            setOpen(true)
            setMode('neworg')
            return
          }
          setOpen((current) => !current)
        }}
        className={`-mx-1 w-[calc(100%+0.5rem)] rounded-lg px-1 py-0.5 text-left transition ${SIDEBAR_HOVER}`}
        aria-label="Switch account"
      >
        {identityRow}
      </button>
    </div>
  )
}
