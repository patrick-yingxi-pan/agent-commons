import type { SectionId } from '../types'
import { HOVER_REVEAL } from '../lib/hoverReveal'
import {
  ALL_FACET,
  SECTION_FILTERS,
  facetLabel,
  isSectionFilterActive,
  sortLabel,
} from '../lib/sectionFilter'
import { SECTION_META } from '../lib/sections'
import { useSectionFilter } from '../lib/useSectionFilter'
import { FilterMenu, type FilterRowSpec } from './FilterMenu'

/** One section filter rendered in either projection of a composite resource.
 *
 * Both copies subscribe to the same per-account value. `placement` changes only
 * disclosure posture: a quiet rail-row action appears on hover unless active;
 * a page-toolbar action is always visible because no parent row supplies hover.
 */
export function SectionFilterMenu({
  section,
  placement = 'rail',
}: {
  section: SectionId
  placement?: 'rail' | 'page'
}) {
  const spec = SECTION_FILTERS[section]
  const [filter, setFilter] = useSectionFilter(section)
  if (!spec) return null
  const active = isSectionFilterActive(section, filter)
  const rows: FilterRowSpec[] = [
    {
      key: 'facet',
      label: spec.facetLabel,
      value: facetLabel(section, filter.facet),
      accent: filter.facet !== ALL_FACET,
      width: 224,
      options: [
        ...spec.facets.map((facet) => ({
          label: facet.label,
          selected: filter.facet === facet.id,
          onSelect: () => setFilter({ ...filter, facet: facet.id }),
        })),
        {
          label: spec.allLabel,
          dividerBefore: true,
          selected: filter.facet === ALL_FACET,
          onSelect: () => setFilter({ ...filter, facet: ALL_FACET }),
        },
      ],
    },
    {
      key: 'sort',
      label: 'Sort by',
      value: sortLabel(section, filter.sortBy),
      accent: filter.sortBy !== spec.defaultSort,
      width: 184,
      dividerBefore: true,
      options: spec.sorts.map((sort) => ({
        label: sort.label,
        selected: filter.sortBy === sort.id,
        onSelect: () => setFilter({ ...filter, sortBy: sort.id }),
      })),
    },
  ]
  const railReveal = placement === 'rail' && !active ? HOVER_REVEAL : ''
  return (
    <span
      data-filter-projection={placement}
      data-filter-active={active || undefined}
      className={`${railReveal} has-[[data-open=true]]:opacity-100 focus-within:opacity-100`}
    >
      <FilterMenu ariaLabel={`Filter & sort ${SECTION_META[section].label.toLowerCase()}`} rows={rows} />
    </span>
  )
}
