import { PROJECT_SECTIONS, SCHEDULE_SECTIONS } from './compositeSections.ts'

/** ── The account resource ontology ──────────────────────────────────────────
 *
 * The rail and the main region are two projections of the same account world:
 * the rail is its forest; a canonical page is the honest face of one selected
 * node. A resource is COMPOSITE only when it contains other account resources
 * with canonical places of their own; `compositeSections.ts` preserves the
 * addressable section places between that parent and those children. Internal fields, workflow steps, posts,
 * and provider catalog rows do not turn their host into a composite — they are
 * the host's content, not independently addressable account resources.
 *
 * Keep this dependency-free. It is a design registry and a test oracle, not a
 * UI helper: rendering still belongs to the surfaces that hold the live data.
 */

export const ACCOUNT_RESOURCE_NATURE = {
  project: 'composite',
  schedule: 'composite',
  work: 'atomic',
  change: 'atomic',
  session: 'atomic',
  artifact: 'atomic',
  context: 'atomic',
  discussion: 'atomic',
  model: 'atomic',
  agent: 'atomic',
} as const

export type AccountResourceKind = keyof typeof ACCOUNT_RESOURCE_NATURE
export type ResourceNature = (typeof ACCOUNT_RESOURCE_NATURE)[AccountResourceKind]

const sectionChildKinds = (sections: readonly { childKinds: readonly string[] }[]) =>
  [...new Set(sections.flatMap((section) => section.childKinds))]

export const COMPOSITE_CHILD_KINDS = {
  project: sectionChildKinds(PROJECT_SECTIONS),
  schedule: sectionChildKinds(SCHEDULE_SECTIONS),
} as const satisfies Record<
  Extract<
    AccountResourceKind,
    { [K in AccountResourceKind]: (typeof ACCOUNT_RESOURCE_NATURE)[K] extends 'composite' ? K : never }[AccountResourceKind]
  >,
  readonly string[]
>

export function isCompositeResource(kind: AccountResourceKind): boolean {
  return ACCOUNT_RESOURCE_NATURE[kind] === 'composite'
}
