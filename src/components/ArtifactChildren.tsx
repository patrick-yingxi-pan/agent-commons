import { useTrashedArtifacts } from '../api/artifactLifecycle'
import { heldArtifactLifecycles, useArtifactLifecycleStatus } from '../controller/artifactLifecycleMutations'
import { artifactTrashProjection } from '../lib/artifactTrashProjection'
import { useRelations } from '../controller/useRelations'
import { listArtifacts } from '../lib/sectionLists'
import { artifactCollectionSections } from '../lib/collectionSections'
import { useSectionFilter } from '../lib/useSectionFilter'
import { collectionEmptyCopy } from '../lib/collectionEmpty'
import type { RailFoldSignal } from '../lib/railSplit'
import type { ComponentType } from 'react'
import type { CollectionSectionRowsProps, InstanceChildProps } from './SectionTreeChildren.tsx'

/** Artifact lifecycle projection is only needed when its rail branch opens. */
export function ArtifactChildren({ renderRows: Rows, foldSignal, ...props }: InstanceChildProps & {
  foldSignal?: RailFoldSignal | null
  renderRows: ComponentType<CollectionSectionRowsProps>
}) {
  const [filter] = useSectionFilter('artifacts')
  const rel = useRelations()
  const trashQ = useTrashedArtifacts()
  useArtifactLifecycleStatus()
  const library = artifactTrashProjection(rel.allArtifacts(), trashQ.data ?? [], heldArtifactLifecycles().map(held => held.artifact))
  const artifacts = library.active
  const rows = listArtifacts(artifacts, filter)
  const allGroups = artifactCollectionSections(artifacts, rel.allProjects(), rel.artifactProjectId, library.trashed)
  const groups = artifactCollectionSections(rows, rel.allProjects(), rel.artifactProjectId, listArtifacts(library.trashed, filter))
  const activeGroup = props.activeSeed?.collectionSectionId
    ? allGroups.find((group) => group.id === props.activeSeed?.collectionSectionId)
    : undefined
  const visibleGroups = activeGroup && !groups.some((group) => group.id === activeGroup.id)
    ? [...groups, { ...activeGroup, items: [] }]
    : groups
  return (
    <Rows
      section="artifacts"
      groups={visibleGroups.map((group) => ({
        ...group,
        items: group.items.map((artifact) => ({ id: artifact.id, label: artifact.name, seed: { artifactId: artifact.id } })),
      }))}
      empty={collectionEmptyCopy('artifacts', artifacts.length)}
      foldSignal={foldSignal}
      {...props}
    />
  )
}
