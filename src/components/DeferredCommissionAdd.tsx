import { lazy, Suspense, type ComponentProps } from 'react'
import { Plus } from 'lucide-react'
import type { CommissionAdd } from './CommissionAdd.tsx'
import { DeferredLoadBoundary } from './DeferredLoadBoundary.tsx'
import { SectionAction } from './SectionAction.tsx'

const Picker = lazy(() => import('./CommissionAdd.tsx').then((module) => ({ default: module.CommissionAdd })))

export function DeferredCommissionAdd(props: ComponentProps<typeof CommissionAdd>) {
  return <DeferredLoadBoundary fallback={<span role="alert" className="text-[11px] text-danger-text">Contributor picker unavailable. Copy unsent text before reloading the app.</span>}>
    <Suspense fallback={<SectionAction label="Commission an agent" icon={<Plus size={14} />} onClick={() => {}} disabled disabledReason="Loading contributor picker" />}>
      <Picker {...props} />
    </Suspense>
  </DeferredLoadBoundary>
}
