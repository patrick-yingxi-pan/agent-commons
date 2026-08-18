import type { SectionId } from '../types'

/** One runtime row shared by the main and rail projections of a collection.
 * `value` keeps the resource-specific payload out of the templates; `key` and
 * `label` are the common identity both densities need. */
export type CollectionProjectionItem<T> = {
  key: string
  label: string
  value: T
}

type CollectionProjectionGroupBase<T> = {
  key: string
  items: readonly CollectionProjectionItem<T>[]
  /** Optional explanatory copy rendered by the main template in its one style. */
  description?: string
  /** The selected canonical group may remain visible while a facet empties it. */
  keepEmpty?: boolean
  /** A quiet de-emphasis of the row list, never a locally supplied class. */
  tone?: 'muted'
  /** A group-local empty answer. The projection-level answer is the fallback. */
  empty?: string
}

/** The discriminated group grammar prevents impossible visual combinations:
 * a flat list has no heading; a static named list is a view partition; and a
 * foldable heading declares whether it is a non-canonical partition or an
 * addressable structural section. */
export type CollectionProjectionGroup<T> =
  | (CollectionProjectionGroupBase<T> & {
      presentation: 'flat'
      role: 'partition'
      label: ''
    })
  | (CollectionProjectionGroupBase<T> & {
      presentation: 'static'
      role: 'partition'
      label: string
    })
  | (CollectionProjectionGroupBase<T> & {
      presentation: 'foldable'
      role: 'partition' | 'section'
      label: string
      summary: string
    })

export type CollectionProjection<T> = {
  section: SectionId
  fallbackLabel: string
  empty: string
  /** Instance heads share one cap; structural sections cap their own children. */
  railCap: 'global' | 'per-group'
  groups: readonly CollectionProjectionGroup<T>[]
}

/** An identity function with a named call site: every collection instance is
 * visibly declared as data for the two templates instead of assembling page or
 * rail markup locally. */
export function defineCollectionProjection<T>(
  projection: CollectionProjection<T>,
): CollectionProjection<T> {
  return projection
}

export function collectionProjectionItems<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  labelOf: (row: T) => string,
): CollectionProjectionItem<T>[] {
  return rows.map((value) => ({ key: keyOf(value), label: labelOf(value), value }))
}

export function collectionProjectionCount<T>(projection: CollectionProjection<T>): number {
  return projection.groups.reduce((total, group) => total + group.items.length, 0)
}

type ProjectionGroupInput<T> = {
  key: string
  label: string
  items: readonly CollectionProjectionItem<T>[]
  summary?: string
  description?: string
  keepEmpty?: boolean
  tone?: 'muted'
  empty?: string
}

const countSummary = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`

export function flatCollectionProjection<T>({
  section,
  fallbackLabel,
  empty,
  items,
}: {
  section: SectionId
  fallbackLabel: string
  empty: string
  items: readonly CollectionProjectionItem<T>[]
}): CollectionProjection<T> {
  return defineCollectionProjection({
    section,
    fallbackLabel,
    empty,
    railCap: 'global',
    groups: [{ key: 'all', label: '', role: 'partition', presentation: 'flat', items }],
  })
}

export function partitionedCollectionProjection<T>({
  section,
  fallbackLabel,
  empty,
  itemNoun,
  presentation,
  groups,
}: {
  section: SectionId
  fallbackLabel: string
  empty: string
  itemNoun: string
  presentation: 'static' | 'foldable'
  groups: readonly ProjectionGroupInput<T>[]
}): CollectionProjection<T> {
  return defineCollectionProjection({
    section,
    fallbackLabel,
    empty,
    railCap: 'global',
    groups: groups.map((group) => presentation === 'static'
      ? group.label === ''
        ? { ...group, label: '' as const, role: 'partition' as const, presentation: 'flat' as const }
        : { ...group, role: 'partition' as const, presentation: 'static' as const }
      : {
          ...group,
          role: 'partition' as const,
          presentation: 'foldable' as const,
          summary: group.summary ?? countSummary(group.items.length, itemNoun),
        }),
  })
}

export function structuralCollectionProjection<T>({
  section,
  fallbackLabel,
  empty,
  itemNoun,
  groups,
}: {
  section: SectionId
  fallbackLabel: string
  empty: string
  itemNoun: string
  groups: readonly ProjectionGroupInput<T>[]
}): CollectionProjection<T> {
  return defineCollectionProjection({
    section,
    fallbackLabel,
    empty,
    railCap: 'per-group',
    groups: groups.map((group) => ({
      ...group,
      role: 'section' as const,
      presentation: 'foldable' as const,
      summary: group.summary ?? countSummary(group.items.length, itemNoun),
    })),
  })
}

export type CappedCollectionProjection<T> = {
  groups: CollectionProjectionGroup<T>[]
  hidden: number
}

/** The one rail-density reduction. It preserves the current/rooted item even
 * when it falls beyond the cap, and it never mutates the main projection. */
export function capCollectionProjection<T>(
  projection: CollectionProjection<T>,
  cap: number,
  showAll: boolean,
  retain: (item: CollectionProjectionItem<T>, group: CollectionProjectionGroup<T>) => boolean,
): CappedCollectionProjection<T> {
  if (showAll) return { groups: [...projection.groups], hidden: 0 }

  const namedMinimum = projection.railCap === 'global'
    ? projection.groups.filter(
        (group) => group.presentation !== 'flat' && group.items.length > 0,
      ).length
    : 0
  let remaining = projection.railCap === 'global'
    ? Math.max(0, cap - namedMinimum)
    : Number.POSITIVE_INFINITY
  const groups = projection.groups
    .map((group) => {
      const groupMinimum = projection.railCap === 'global' &&
        group.presentation !== 'flat' && group.items.length > 0
        ? 1
        : 0
      const groupCap = projection.railCap === 'per-group'
        ? cap
        : groupMinimum + Math.max(0, remaining)
      const head = group.items.slice(0, groupCap)
      if (projection.railCap === 'global') {
        remaining -= Math.max(0, head.length - groupMinimum)
      }
      const held = group.items.filter(
        (item) => retain(item, group) && !head.some((candidate) => candidate.key === item.key),
      )
      return { ...group, items: [...head, ...held] } as CollectionProjectionGroup<T>
    })
    .filter((group) =>
      group.presentation !== 'flat' || group.keepEmpty === true || group.items.length > 0,
    )

  const visible = groups.reduce((total, group) => total + group.items.length, 0)
  return {
    groups,
    hidden: Math.max(0, collectionProjectionCount(projection) - visible),
  }
}
