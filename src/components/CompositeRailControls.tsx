import { ChevronsDown, ChevronsUp, Plus, Search } from 'lucide-react'
import type { SectionId } from '../types'
import {
  COMPOSITE_FEATURES,
  requestCompositeFold,
  type CompositeCommandKind,
} from '../lib/compositeFeatures'
import { RowMenu, type RowMenuItem } from './RowMenu'
import { SECTION_META } from '../lib/sections'

/** The compact rail projection of a composite root's page capabilities.
 *
 * Density changes the form, not the feature: page-header actions and the local
 * search field become menu rows, while bulk disclosure publishes one request
 * consumed by both the active main page and this rail branch. Filter & sort
 * remains beside this menu because it already has one shared two-placement
 * component and one live value.
 */
export function CompositeRailControls({
  section,
  onCommand,
}: {
  section: SectionId
  onCommand: (kind: CompositeCommandKind) => void
}) {
  const spec = COMPOSITE_FEATURES[section]
  const items: RowMenuItem[] = []
  if (spec.primaryAction) {
    items.push({
      kind: 'action',
      key: 'primary-action',
      label: spec.primaryAction,
      icon: <Plus size={15} />,
      onSelect: () => onCommand('primary-action'),
    })
  }
  if (spec.search) {
    items.push({
      kind: 'action',
      key: 'focus-search',
      label: spec.search,
      icon: <Search size={15} />,
      onSelect: () => onCommand('focus-search'),
    })
  }
  if ((spec.primaryAction || spec.search) && spec.fold) {
    items.push({ kind: 'divider', key: 'view-divider' })
  }
  if (spec.fold) {
    items.push(
      {
        kind: 'action',
        key: 'fold-all',
        label: 'Fold all',
        icon: <ChevronsUp size={15} />,
        onSelect: () => requestCompositeFold(section, false),
      },
      {
        kind: 'action',
        key: 'unfold-all',
        label: 'Unfold all',
        icon: <ChevronsDown size={15} />,
        onSelect: () => requestCompositeFold(section, true),
      },
    )
  }
  if (items.length === 0) return null
  const label = SECTION_META[section].label

  return (
    <span data-composite-rail-controls={section}>
      <RowMenu ariaLabel={`Controls for ${label}`} items={items} />
    </span>
  )
}
