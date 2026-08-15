/** The Agents composite, shared by the rail and every Agents main page.
 *
 * The root is not a disguised default tab. It is an overview of five structural
 * sections; the two composite sections expose their own child pages. Runtime
 * agents, prompts, and tools sit below these declarations as resource leaves.
 */
export const AGENT_SECTION = 'agents' as const

export const AGENT_SECTIONS = [
  {
    id: 'ready-agents',
    label: 'Ready agents',
    summary: 'Built-in and custom agents that are ready to run and commission.',
    children: [],
  },
  {
    id: 'building-blocks',
    label: 'Building blocks',
    summary: 'Reusable materials injected into an agent’s model context.',
    children: [
      { id: 'prompts', label: 'Prompts', summary: 'Reusable system prompts and their model-family fit.' },
      { id: 'tools', label: 'Tools', summary: 'The callable workspace capabilities an agent may be granted.' },
    ],
  },
  {
    id: 'coordination',
    label: 'Coordination',
    summary: 'Work agents participate in and the projects where they are commissioned.',
    children: [
      { id: 'work', label: 'Your work', summary: 'Work and proposals you are waiting on.' },
      { id: 'commissions', label: 'Commissions', summary: 'Agent assignments across projects.' },
    ],
  },
  {
    id: 'discover',
    label: 'Discover',
    summary: 'Published agent definitions you can inspect and fork.',
    children: [],
  },
  {
    id: 'audit',
    label: 'Audit',
    summary: 'The cross-user effect trail for agent activity.',
    children: [],
  },
] as const

export type AgentSectionId = (typeof AGENT_SECTIONS)[number]['id']
export type AgentChildId = (typeof AGENT_SECTIONS)[number]['children'][number]['id']
export type AgentSubviewId = AgentSectionId | AgentChildId

/** Reserved `/agents/:subview` addresses, derived from the visible hierarchy. */
export const AGENT_SUBVIEWS: { id: AgentSubviewId; label: string }[] = AGENT_SECTIONS.flatMap((section) => [
  { id: section.id, label: section.label },
  ...section.children.map((child) => ({ id: child.id, label: child.label })),
])

export function agentSection(id?: string | null) {
  return AGENT_SECTIONS.find((section) => section.id === id)
}

export function agentSectionForSubview(id?: string | null) {
  return AGENT_SECTIONS.find(
    (section) => section.id === id || section.children.some((child) => child.id === id),
  )
}

export function agentToolLabel(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ')
}
