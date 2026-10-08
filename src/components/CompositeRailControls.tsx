import { Plus, Search } from 'lucide-react'
import type { SectionId } from '../types'
import { COMPOSITE_FEATURES, type CompositeCommandKind } from '../lib/compositeFeatures'
import { RowMenu, type RowMenuItem } from './RowMenu'
import { SECTION_META } from '../lib/sections'
import { useCapabilities } from '../api'
import { dispatchAvailable } from '../lib/automationAvailability.ts'

/** The compact rail projection of a composite root's page capabilities.
 *
 * Density changes the form, not the feature: page-header actions and the local
 * search field become menu rows. Filter & sort remains beside this menu because
 * it already has one shared two-placement component and one live value. Bulk
 * disclosure belongs to the shell's focus-aware Organize pane control, so a
 * resource row does not repeat it in a second overflow menu.
 */
export function CompositeRailControls({
  section,
  onCommand,
}: {
  section: SectionId
  onCommand: (kind: CompositeCommandKind) => void
}) {
  const spec = COMPOSITE_FEATURES[section]
  const capabilities = useCapabilities()
  const canDispatch = dispatchAvailable(capabilities.status === 'error' ? undefined : capabilities.data?.features.dispatchExecution)
  const primaryUnavailable = section === 'dispatch' && !canDispatch
  const items: RowMenuItem[] = []
  if (spec.primaryAction) {
    items.push({
      kind: 'action',
      key: 'primary-action',
      label: primaryUnavailable ? `${spec.primaryAction} (unavailable)` : spec.primaryAction,
      icon: <Plus size={15} />,
      disabled: primaryUnavailable,
      onSelect: () => { if (!primaryUnavailable) onCommand('primary-action') },
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
  if (items.length === 0) return null
  const label = SECTION_META[section].label

  return (
    <span data-composite-rail-controls={section}>
      <RowMenu ariaLabel={`Controls for ${label}`} items={items} />
    </span>
  )
}
