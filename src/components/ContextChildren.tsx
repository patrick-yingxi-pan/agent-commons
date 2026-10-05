import { useContextRegistryProjection } from '../controller/useContextRegistryProjection.ts'
import { useLocalFolderConnections } from '../controller/localFolderConnections.ts'
import { listContexts } from '../lib/sectionLists'
import {
  ACCOUNT_MCP_SECTION,
  contextCollectionSections,
  localFolderCollectionSection,
} from '../lib/collectionSections'
import { useSectionFilter } from '../lib/useSectionFilter'
import type { RailFoldSignal } from '../lib/railSplit'
import type { ComponentType } from 'react'
import type { CollectionSectionRowsProps, InstanceChildProps } from './SectionTreeChildren.tsx'

/** Context registry and native folder metadata are only read when the Contexts
 * rail branch is expanded. This component does not browse or capture sources. */
export function ContextChildren({ renderRows: Rows, foldSignal, ...props }: InstanceChildProps & {
  foldSignal?: RailFoldSignal | null
  renderRows: ComponentType<CollectionSectionRowsProps>
}) {
  const [filter] = useSectionFilter('contexts')
  const localFolders = useLocalFolderConnections()
  const nativeGroup = localFolderCollectionSection(localFolders.rows, filter)
  const rows = listContexts(useContextRegistryProjection().data?.contexts ?? [], filter)
  const activeGroupId = props.activeSeed?.collectionSectionId
  const groups = [
    ...contextCollectionSections(rows).filter((group) => group.items.length > 0 || group.id === activeGroupId).map((group) => ({
      ...group,
      items: group.items.map((context) => ({ id: context.id, label: context.label, seed: { contextId: context.id } })),
    })),
    ...(localFolders.available ? [{ ...nativeGroup, items: nativeGroup.items.map(connection => ({ id: connection.id, label: connection.name, seed: { contextId: connection.id } })) }] : []),
    { ...ACCOUNT_MCP_SECTION, items: [] },
  ]
  return (
    <Rows
      section="contexts"
      groups={groups}
      empty="No contexts here yet."
      foldSignal={foldSignal}
      {...props}
    />
  )
}
