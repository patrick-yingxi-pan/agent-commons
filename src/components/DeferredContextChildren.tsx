import { lazy, type ComponentProps } from 'react'
import type { ContextChildren } from './ContextChildren.tsx'
import { DeferredRailChildrenBoundary } from './DeferredRailChildren.tsx'

const Children = lazy(() => import('./ContextChildren.tsx').then((module) => ({ default: module.ContextChildren })))
type Props = ComponentProps<typeof ContextChildren>

/** Context registry and native metadata projection stay out of the cold rail
 * graph; a rejected chunk leaves the rest of navigation usable. */
export function DeferredContextChildren(props: Props) {
  return <DeferredRailChildrenBoundary label="contexts"><Children {...props} /></DeferredRailChildrenBoundary>
}
