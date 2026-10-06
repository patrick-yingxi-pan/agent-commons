/** ── Composite-resource section registries ─────────────────────────────────
 *
 * A composite is not a bag of descendants. Its sections are structural places
 * in their own right: the rail projects parent → section → resource, while the
 * main region can show the parent overview, one section, or one resource. Keep
 * labels, order, viewer visibility, and child-resource kinds in this one
 * dependency-free registry so those projections cannot flatten independently.
 */

export type CompositeSectionVisibility = 'all' | 'owner'

export interface CompositeSectionSpec<Id extends string = string> {
  id: Id
  label: string
  visibility: CompositeSectionVisibility
  /** Independently addressable ACCOUNT resources contained by this section.
   * Internal fields, reservations, grants, policies, and workflow steps stay
   * section content; they are not invented as tree nodes. */
  childKinds: readonly string[]
}

export const PROJECT_SECTIONS = [
  { id: 'about', label: 'About', visibility: 'all', childKinds: [] },
  { id: 'attention', label: 'Attention', visibility: 'all', childKinds: ['change'] },
  { id: 'contributors', label: 'Contributors', visibility: 'all', childKinds: ['agent'] },
  { id: 'coordination', label: 'Coordination', visibility: 'all', childKinds: [] },
  { id: 'open-work', label: 'Open work', visibility: 'all', childKinds: ['work'] },
  { id: 'artifacts', label: 'Artifacts', visibility: 'all', childKinds: ['artifact'] },
  { id: 'instructions', label: 'Instructions', visibility: 'owner', childKinds: [] },
  { id: 'context', label: 'Context', visibility: 'owner', childKinds: ['context'] },
  { id: 'sharing', label: 'Sharing', visibility: 'owner', childKinds: [] },
  { id: 'delegation', label: 'Delegation', visibility: 'all', childKinds: [] },
  { id: 'scheduled', label: 'Routines', visibility: 'owner', childKinds: ['schedule'] },
  { id: 'changes', label: 'Changes', visibility: 'all', childKinds: ['change'] },
  { id: 'recent-sessions', label: 'Recent sessions', visibility: 'all', childKinds: ['session'] },
  { id: 'discussion', label: 'Discussion', visibility: 'all', childKinds: ['discussion'] },
] as const satisfies readonly CompositeSectionSpec[]

export const SCHEDULE_SECTIONS = [
  { id: 'instruction', label: 'Instruction', visibility: 'all', childKinds: [] },
  { id: 'workflow', label: 'Workflow', visibility: 'all', childKinds: [] },
  { id: 'sharing', label: 'Sharing', visibility: 'owner', childKinds: [] },
  { id: 'schedule', label: 'Schedule', visibility: 'owner', childKinds: [] },
  { id: 'delivery', label: 'Delivers to', visibility: 'owner', childKinds: [] },
  { id: 'context-tools', label: 'Context & tools', visibility: 'owner', childKinds: [] },
  { id: 'model', label: 'Agent & model', visibility: 'owner', childKinds: [] },
  { id: 'recent-runs', label: 'Recent runs', visibility: 'all', childKinds: ['session'] },
  { id: 'improvements', label: 'Improvements', visibility: 'all', childKinds: [] },
  { id: 'discussion', label: 'Discussion', visibility: 'all', childKinds: ['discussion'] },
] as const satisfies readonly CompositeSectionSpec[]

/** A namespace profile is a composite social resource, not an atomic card. Its
 * rail branch mirrors these main-page sections in this order. Organization is
 * viewer-relative and appears only when the profile response carries a seat. */
export const OWNER_PROFILE_SECTIONS = [
  { id: 'organization', label: 'Organization', visibility: 'all', childKinds: [] },
  { id: 'network', label: 'Network', visibility: 'all', childKinds: ['profile'] },
  { id: 'shared-projects', label: 'Shared projects', visibility: 'all', childKinds: ['project'] },
  { id: 'commons-activity', label: 'Commons activity', visibility: 'all', childKinds: [] },
  { id: 'published-agents', label: 'Published agents', visibility: 'all', childKinds: ['agent'] },
  { id: 'recent-public-activity', label: 'Recent public activity', visibility: 'all', childKinds: [] },
] as const satisfies readonly CompositeSectionSpec[]

export type ProjectSectionId = (typeof PROJECT_SECTIONS)[number]['id']
export type ScheduleSectionId = (typeof SCHEDULE_SECTIONS)[number]['id']
export type OwnerProfileSectionId = (typeof OWNER_PROFILE_SECTIONS)[number]['id']

export function projectSection(id: string | null | undefined) {
  return PROJECT_SECTIONS.find((section) => section.id === id)
}

export function scheduleSection(id: string | null | undefined) {
  return SCHEDULE_SECTIONS.find((section) => section.id === id)
}

export function ownerProfileSection(id: string | null | undefined) {
  return OWNER_PROFILE_SECTIONS.find((section) => section.id === id)
}

export function isProjectSectionId(id: string): id is ProjectSectionId {
  return projectSection(id) !== undefined
}

export function isScheduleSectionId(id: string): id is ScheduleSectionId {
  return scheduleSection(id) !== undefined
}

export function isOwnerProfileSectionId(id: string): id is OwnerProfileSectionId {
  return ownerProfileSection(id) !== undefined
}

export function visibleOwnerProfileSections(hasOrganization: boolean) {
  return OWNER_PROFILE_SECTIONS.filter((section) => section.id !== 'organization' || hasOrganization)
}

export function visibleCompositeSections<T extends CompositeSectionSpec>(sections: readonly T[], own: boolean): readonly T[] {
  return sections.filter((section) => section.visibility === 'all' || own)
}
