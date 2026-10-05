import { lazy, type ComponentProps } from 'react'
import type { ArtifactChildren } from './ArtifactChildren.tsx'
import { DeferredRailChildrenBoundary } from './DeferredRailChildren.tsx'

const Children = lazy(() => import('./ArtifactChildren.tsx').then((module) => ({ default: module.ArtifactChildren })))
type Props = ComponentProps<typeof ArtifactChildren>

export function DeferredArtifactChildren(props: Props) {
  return <DeferredRailChildrenBoundary label="artifacts"><Children {...props} /></DeferredRailChildrenBoundary>
}
