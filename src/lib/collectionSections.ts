import type { ArtifactItem, ModelProvider, Project, SavedContext, SavedContextKind, SectionId } from '../types.ts'
import type { LocalFolderConnection } from '../../contract/localFolderCapture.ts'
import type { SectionFilterValue } from './sectionFilter.ts'

/** Structural sections inside collection roots. A collection page is still a
 * composite place: its overview, the selected section, and each canonical row
 * are three honest levels in both the rail and the main region. */
export type CollectionSection<T> = {
  id: string
  label: string
  items: T[]
}

export const COLLECTION_SECTION_HOSTS = ['artifacts', 'contexts', 'models'] as const satisfies readonly SectionId[]
export type CollectionSectionHost = (typeof COLLECTION_SECTION_HOSTS)[number]

export function isCollectionSectionHost(section: SectionId): section is CollectionSectionHost {
  return (COLLECTION_SECTION_HOSTS as readonly SectionId[]).includes(section)
}

export const CONTEXT_COLLECTION_SECTIONS = [
  { id: 'connector', label: 'Connectors', kind: 'connector' },
  { id: 'mcp', label: 'MCP servers', kind: 'mcp' },
  { id: 'repo', label: 'Repositories', kind: 'repo' },
] as const satisfies readonly { id: string; label: string; kind: SavedContextKind }[]

export const ACCOUNT_MCP_SECTION = { id: 'account-mcp', label: 'This account is an MCP server' } as const
export const LOCAL_FOLDERS_SECTION = { id: 'local-folders', label: 'Local folders on this device' } as const
export type LocalFolderContextRow = LocalFolderConnection & { kind: 'local-folder'; label: string }

/** Native metadata projects into both navigation densities, never the server's
 * SavedContext registry. No fabricated availability or last-used timestamp. */
export function localFolderCollectionSection(rows: readonly LocalFolderConnection[], filter: SectionFilterValue, query = ''): CollectionSection<LocalFolderContextRow> {
  const needle = query.trim().toLowerCase()
  const selected = filter.facet === 'all' || filter.facet === 'local-folder'
    ? rows.filter(row => !needle || row.name.toLowerCase().includes(needle)) : []
  return { ...LOCAL_FOLDERS_SECTION, items: [...selected].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(row => ({ ...row, kind: 'local-folder', label: row.name })) }
}
export const PROVIDERS_SECTION = { id: 'providers', label: 'Providers' } as const
export const UNFILED_ARTIFACT_SECTION = { id: '__unfiled', label: 'Unfiled' } as const
export const ARTIFACT_TRASH_SECTION = { id: '__trash', label: 'Trash' } as const

/** Artifact sections follow project membership—the exact structure the gallery
 * draws. The relation resolver is injected so this pure module never learns the
 * graph store. Empty projects are omitted because they contain no artifact node. */
export function artifactCollectionSections(
  artifacts: readonly ArtifactItem[],
  projects: readonly Project[],
  projectIdOf: (artifact: ArtifactItem) => string | undefined,
  trashedArtifacts: readonly ArtifactItem[] = [],
): CollectionSection<ArtifactItem>[] {
  const knownProjectIds = new Set(projects.map((project) => project.id))
  return [
    ...projects.map((project) => ({
      id: project.id,
      label: project.name,
      items: artifacts.filter((artifact) => projectIdOf(artifact) === project.id),
    })),
    {
      id: UNFILED_ARTIFACT_SECTION.id,
      label: UNFILED_ARTIFACT_SECTION.label,
      items: artifacts.filter((artifact) => !knownProjectIds.has(projectIdOf(artifact) ?? '')),
    },
  ].filter((section) => section.items.length > 0).concat({ ...ARTIFACT_TRASH_SECTION, items: [...trashedArtifacts] })
}

export function contextCollectionSections(contexts: readonly SavedContext[]): CollectionSection<SavedContext>[] {
  return CONTEXT_COLLECTION_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    items: contexts.filter((context) => context.kind === section.kind),
  }))
}

export function modelCollectionSections(providers: readonly ModelProvider[]): CollectionSection<ModelProvider>[] {
  return [{ ...PROVIDERS_SECTION, items: [...providers] }]
}

/** Back-button copy for an intermediate collection section. Artifact section
 * ids are project ids, so their live names come from the same project registry
 * the gallery and rail read; fixed sections come from the registry above. */
export function collectionSectionLabel(
  host: SectionId,
  id: string,
  projectNames: Readonly<Record<string, string>> = {},
): string | undefined {
  if (host === 'artifacts')
    return id === ARTIFACT_TRASH_SECTION.id ? ARTIFACT_TRASH_SECTION.label
      : id === UNFILED_ARTIFACT_SECTION.id ? UNFILED_ARTIFACT_SECTION.label : projectNames[id]
  if (host === 'contexts')
    return id === LOCAL_FOLDERS_SECTION.id ? LOCAL_FOLDERS_SECTION.label : id === ACCOUNT_MCP_SECTION.id
      ? ACCOUNT_MCP_SECTION.label
      : CONTEXT_COLLECTION_SECTIONS.find((section) => section.id === id)?.label
  if (host === 'models') return id === PROVIDERS_SECTION.id ? PROVIDERS_SECTION.label : undefined
  return undefined
}
