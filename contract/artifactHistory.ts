import type { ArtifactContent, DocBlock } from './content.ts'
import { MAX_ARTIFACT_BLOCK_CHARS, MAX_AUTHORED_DOCUMENT_BLOCKS } from './content.ts'
import { parseStructuredArtifactBody, type StructuredArtifactBody } from './artifactAuthoring.ts'

export const MAX_ARTIFACT_HISTORY_PAGE_SIZE = 50
const MAX_HISTORY_DOC_BODY_CHARS = MAX_ARTIFACT_BLOCK_CHARS * MAX_AUTHORED_DOCUMENT_BLOCKS

export type ArtifactHistoryBody =
  | { type: 'doc'; title: string; blocks: DocBlock[] }
  | StructuredArtifactBody

export type ArtifactHistoryReason = 'baseline' | 'edit' | 'restore'

export interface ArtifactHistoryVersionMetadata {
  revision: number
  /** Null only for a rollout baseline whose original save time was not retained. */
  savedAt: string | null
  reason: ArtifactHistoryReason
  restoredFromRevision?: number
}

export interface ArtifactHistoryVersion extends ArtifactHistoryVersionMetadata {
  body: ArtifactHistoryBody
}

export interface ArtifactHistoryPage {
  artifactId: string
  currentRevision: number
  versions: ArtifactHistoryVersionMetadata[]
  nextBeforeRevision?: number
}

export interface ArtifactHistoryVersionResult {
  artifactId: string
  currentRevision: number
  version: ArtifactHistoryVersion
}

export interface RestoreArtifactHistoryRequest {
  expectedRevision: number
}

export type RestoreArtifactHistoryResult = ArtifactHistoryVersionResult
export type ArtifactHistoryEntries = Array<[string, ArtifactHistoryVersion[]]>

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function fields(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
}

function parseDocBody(value: unknown): Extract<ArtifactHistoryBody, { type: 'doc' }> | undefined {
  if (!record(value) || !fields(value, ['type', 'title', 'blocks']) || value.type !== 'doc' ||
    typeof value.title !== 'string' || !value.title.trim() || value.title.length > 240 ||
    !Array.isArray(value.blocks) || value.blocks.length < 1 || value.blocks.length > MAX_AUTHORED_DOCUMENT_BLOCKS) return undefined
  let characters = 0
  const blocks: DocBlock[] = []
  for (const item of value.blocks) {
    if (!record(item)) return undefined
    if (fields(item, ['h']) && typeof item.h === 'string') {
      characters += item.h.length
      blocks.push({ h: item.h })
    } else if (fields(item, ['p']) && typeof item.p === 'string') {
      characters += item.p.length
      blocks.push({ p: item.p })
    } else if (fields(item, ['ul']) && Array.isArray(item.ul) && item.ul.every((line) => typeof line === 'string')) {
      if ((item.ul as string[]).length > MAX_AUTHORED_DOCUMENT_BLOCKS || (item.ul as string[]).some((line) => line.length > MAX_ARTIFACT_BLOCK_CHARS)) return undefined
      characters += (item.ul as string[]).reduce((sum, line) => sum + line.length, 0)
      blocks.push({ ul: [...item.ul] as string[] })
    } else if (fields(item, ['code']) && Array.isArray(item.code) && item.code.every((line) => typeof line === 'string')) {
      if ((item.code as string[]).length > MAX_AUTHORED_DOCUMENT_BLOCKS || (item.code as string[]).some((line) => line.length > MAX_ARTIFACT_BLOCK_CHARS)) return undefined
      characters += (item.code as string[]).reduce((sum, line) => sum + line.length, 0)
      blocks.push({ code: [...item.code] as string[] })
    } else if (fields(item, ['email']) && record(item.email) && fields(item.email, ['to', 'subject']) &&
      typeof item.email.to === 'string' && typeof item.email.subject === 'string') {
      if (item.email.to.length > MAX_ARTIFACT_BLOCK_CHARS || item.email.subject.length > MAX_ARTIFACT_BLOCK_CHARS) return undefined
      characters += item.email.to.length + item.email.subject.length
      blocks.push({ email: { to: item.email.to, subject: item.email.subject } })
    } else return undefined
    const text = 'h' in item ? item.h : 'p' in item ? item.p : undefined
    if (typeof text === 'string' && text.length > MAX_ARTIFACT_BLOCK_CHARS) return undefined
  }
  if (characters > MAX_HISTORY_DOC_BODY_CHARS) return undefined
  return { type: 'doc', title: value.title, blocks }
}

export function parseArtifactHistoryBody(value: unknown): ArtifactHistoryBody | undefined {
  const doc = parseDocBody(value)
  if (doc) return doc
  const structured = parseStructuredArtifactBody(value)
  return structured ? structured : undefined
}

function parseMetadata(value: unknown): ArtifactHistoryVersionMetadata | undefined {
  if (!record(value) || !fields(value, ['revision', 'savedAt', 'reason'], ['restoredFromRevision']) ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
    (value.savedAt !== null && (typeof value.savedAt !== 'string' || !Number.isFinite(Date.parse(value.savedAt)) ||
      new Date(value.savedAt).toISOString() !== value.savedAt)) ||
    !['baseline', 'edit', 'restore'].includes(value.reason as string)) return undefined
  if ((value.reason === 'baseline') !== (value.savedAt === null) ||
    (value.reason === 'baseline' && Object.hasOwn(value, 'restoredFromRevision'))) return undefined
  if (value.reason !== 'restore' && Object.hasOwn(value, 'restoredFromRevision')) return undefined
  if (value.reason === 'restore' && (!Number.isSafeInteger(value.restoredFromRevision) ||
    (value.restoredFromRevision as number) < 0 || (value.restoredFromRevision as number) >= (value.revision as number))) return undefined
  return {
    revision: value.revision as number,
    savedAt: value.savedAt as string | null,
    reason: value.reason as ArtifactHistoryReason,
    ...(value.reason === 'restore' ? { restoredFromRevision: value.restoredFromRevision as number } : {}),
  }
}

export function parseArtifactHistoryVersion(value: unknown): ArtifactHistoryVersion | undefined {
  if (!record(value) || !Object.hasOwn(value, 'body')) return undefined
  const { body, ...metadata } = value
  const parsedMetadata = parseMetadata(metadata)
  const parsedBody = parseArtifactHistoryBody(body)
  return parsedMetadata && parsedBody ? { ...parsedMetadata, body: parsedBody } : undefined
}

export function parseArtifactHistoryPage(value: unknown): ArtifactHistoryPage | undefined {
  if (!record(value) || !fields(value, ['artifactId', 'currentRevision', 'versions'], ['nextBeforeRevision']) ||
    typeof value.artifactId !== 'string' || !value.artifactId ||
    !Number.isSafeInteger(value.currentRevision) || (value.currentRevision as number) < 0 ||
    !Array.isArray(value.versions) || value.versions.length > MAX_ARTIFACT_HISTORY_PAGE_SIZE) return undefined
  const versions: ArtifactHistoryVersionMetadata[] = []
  for (const raw of value.versions) {
    const metadata = parseMetadata(raw)
    if (!metadata || metadata.revision > (value.currentRevision as number) ||
      (versions.length > 0 && versions.at(-1)!.revision <= metadata.revision)) return undefined
    versions.push(metadata)
  }
  if (Object.hasOwn(value, 'nextBeforeRevision') && (!Number.isSafeInteger(value.nextBeforeRevision) ||
    (value.nextBeforeRevision as number) < 0 ||
    (versions.length > 0 && (value.nextBeforeRevision as number) !== versions.at(-1)!.revision))) return undefined
  return {
    artifactId: value.artifactId,
    currentRevision: value.currentRevision as number,
    versions,
    ...(Object.hasOwn(value, 'nextBeforeRevision') ? { nextBeforeRevision: value.nextBeforeRevision as number } : {}),
  }
}

export function parseArtifactHistoryVersionResult(value: unknown): ArtifactHistoryVersionResult | undefined {
  if (!record(value) || !fields(value, ['artifactId', 'currentRevision', 'version']) ||
    typeof value.artifactId !== 'string' || !value.artifactId ||
    !Number.isSafeInteger(value.currentRevision) || (value.currentRevision as number) < 0) return undefined
  const version = parseArtifactHistoryVersion(value.version)
  if (!version || version.revision > (value.currentRevision as number)) return undefined
  return { artifactId: value.artifactId, currentRevision: value.currentRevision as number, version }
}

export function parseRestoreArtifactHistoryRequest(value: unknown): RestoreArtifactHistoryRequest | undefined {
  if (!record(value) || !fields(value, ['expectedRevision']) ||
    !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0) return undefined
  return { expectedRevision: value.expectedRevision as number }
}

export function historyBodyWithoutRevision(body: ArtifactContent): ArtifactHistoryBody | undefined {
  const { revision: _revision, ...content } = body
  return parseArtifactHistoryBody(content)
}

export function parseArtifactHistoryEntries(value: unknown): ArtifactHistoryEntries {
  if (!Array.isArray(value)) throw new TypeError('Artifact history must be an array of entries.')
  const ids = new Set<string>()
  const entries: ArtifactHistoryEntries = []
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0] || ids.has(entry[0]) ||
      !Array.isArray(entry[1]) || entry[1].length === 0) throw new TypeError('Artifact history entry is malformed.')
    ids.add(entry[0])
    const versions: ArtifactHistoryVersion[] = []
    for (const raw of entry[1]) {
      const version = parseArtifactHistoryVersion(raw)
      if (!version) throw new TypeError('Artifact history version is malformed.')
      const prior = versions.at(-1)
      if (!prior) {
        if (version.reason !== 'baseline') throw new TypeError('Artifact history must begin with a baseline.')
      } else {
        if (version.revision !== prior.revision + 1 || version.reason === 'baseline') {
          throw new TypeError('Artifact history revisions must be contiguous and monotonic.')
        }
        if (version.reason === 'restore') {
          const source = versions.find((candidate) => candidate.revision === version.restoredFromRevision)
          if (!source) throw new TypeError('Artifact history restore source is missing.')
          if (JSON.stringify(source.body) !== JSON.stringify(version.body)) {
            throw new TypeError('Artifact history restore body differs from its source version.')
          }
        }
      }
      versions.push(version)
    }
    entries.push([entry[0], versions])
  }
  return entries
}
