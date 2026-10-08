import type { SearchHit, SearchHitType, SearchPage, SearchResponse } from '../../contract/search.ts'
import { artifactSearchTargetKey } from '../../contract/artifactSearch.ts'
import type { SectionId } from '../types.ts'
import { OWNER_SECTION } from './paneNav.ts'

/** Faint neutral ink is not guaranteed to read on a chromatic selection tint. */
export function searchResultSubtitleClass(active: boolean): string {
  return active ? 'text-accent-strong' : 'text-ink-faint'
}

/** Conversation and Artifact hits carry readable body context. */
export function searchResultHasTextPreview(type: SearchHitType): boolean {
  return type === 'session' || type === 'artifact' || type === 'artifactVersion'
}

export type SearchDestination =
  | { kind: 'session'; id: string; messageId?: string }
  | { kind: 'section'; section: SectionId; id: string; subId?: string }

/** Result identity is navigation identity, never a generic collection fallback. */
export function searchHitDestination(hit: SearchHit): SearchDestination | undefined {
  switch (hit.type) {
    case 'session': return { kind: 'session', id: hit.id, ...(hit.match ? { messageId: hit.match.messageId } : {}) }
    case 'project':
    case 'sharedProject': return { kind: 'section', section: 'projects', id: hit.id }
    case 'artifact': {
      let subId: string | undefined
      if (hit.match) {
        try { subId = `match/${artifactSearchTargetKey(hit.match)}` } catch { /* open the artifact without an invalid locator */ }
      }
      return { kind: 'section', section: 'artifacts', id: hit.id, ...(subId ? { subId } : {}) }
    }
    case 'artifactVersion': {
      if (!Number.isSafeInteger(hit.revision) || hit.revision < 0) return undefined
      let subId = `history/${hit.revision}`
      if (hit.match) {
        try {
          artifactSearchTargetKey(hit.match)
          if (hit.match.revision === hit.revision) subId += `/match/${hit.match.field}`
        } catch { /* preserve the exact version destination without a malformed locator */ }
      }
      return { kind: 'section', section: 'artifacts', id: hit.id, subId }
    }
    case 'schedule': return { kind: 'section', section: 'scheduled', id: hit.id }
    case 'agent':
    case 'publishedAgent': return { kind: 'section', section: 'agents', id: hit.id }
    case 'prompt': return { kind: 'section', section: 'agents', id: hit.id, subId: 'prompts' }
    case 'model': return { kind: 'section', section: 'models', id: hit.id }
    case 'context': return { kind: 'section', section: 'contexts', id: hit.id }
    case 'owner': return { kind: 'section', section: OWNER_SECTION, id: hit.id }
    case 'openWork': return hit.ref ? { kind: 'section', section: 'projects', id: hit.ref, subId: hit.id } : undefined
  }
}

export function searchHitKey(hit: SearchHit): string {
  return hit.type === 'artifactVersion' ? `${hit.type}-${hit.id}-${hit.revision}` : `${hit.type}-${hit.id}`
}

export function searchHitVersionLabel(hit: SearchHit): string | undefined {
  if (hit.type !== 'artifactVersion') return undefined
  const reason = hit.reason === 'restore' ? `Restored from version ${hit.restoredFromRevision}`
    : hit.reason === 'baseline' ? 'Baseline' : 'Edited'
  const time = hit.savedAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(hit.savedAt)) : 'time unknown'
  return `Version ${hit.revision} · ${reason} · ${time}${hit.trashed ? ' · In Trash' : ''}`
}

/** A late answer must match all of the currently requested coordinates. */
export function searchResponseMatches(data: SearchResponse | undefined, query: string, page?: SearchPage): boolean {
  return data?.query === query.trim().toLowerCase()
    && data?.page?.type === page?.type
    && data?.page?.offset === page?.offset
}
