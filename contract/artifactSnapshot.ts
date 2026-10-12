import type { ArtifactKind } from './entities.ts'
import type { ArtifactContent } from './content.ts'
import { parseArtifactHistoryBody } from './artifactHistory.ts'
import { isFormulaCell } from './sheetCell.ts'
import { calculateSheet } from './workbookCalculation.ts'
import { spreadsheetSheets } from './workbook.ts'
import { isServedCaptureTime, isSnapshotId } from './servedSnapshotIdentity.ts'

export const ARTIFACT_SNAPSHOT_MAX_BYTES = 65_536
const MAX_ARTIFACT_ID_CHARS = 200
const MAX_ARTIFACT_TITLE_CHARS = 240
// These array ceilings are below the point where even the shortest JSON
// entries could fit in the 64 KiB whole-snapshot budget.
const MAX_FIGURE_LABELS = 16_000
const MAX_FIGURE_POINTS = 32_000
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/u

type WithoutRevision<T> = T extends unknown ? Omit<T, 'revision'> : never
export type ArtifactSnapshotBody = WithoutRevision<ArtifactContent>

export interface ArtifactSnapshot {
  version: 1
  snapshotId: string
  capturedAt: string
  artifactId: string
  title: string
  artifactKind: ArtifactKind
  revision: number
  body: ArtifactSnapshotBody
}

export interface ArtifactSnapshotSource {
  artifactId: string
  title: string
  artifactKind: ArtifactKind
  body: ArtifactContent
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactFields(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
}

/** Compare parser output to its source without relying on property order. This
 * rejects hidden/symbol keys, sparse arrays, and values the JSON wire would drop. */
function sameJsonShape(source: unknown, parsed: unknown): boolean {
  if (source === null || parsed === null || typeof source !== 'object' || typeof parsed !== 'object') {
    return source === parsed
  }
  if (Array.isArray(source) || Array.isArray(parsed)) {
    if (!Array.isArray(source) || !Array.isArray(parsed) || source.length !== parsed.length) return false
    const expectedKeys = ['length', ...Array.from({ length: parsed.length }, (_, index) => String(index))].sort()
    const sourceKeys = Reflect.ownKeys(source)
    if (sourceKeys.length !== expectedKeys.length || sourceKeys.some((key) => typeof key !== 'string') ||
        [...sourceKeys as string[]].sort().some((key, index) => key !== expectedKeys[index])) return false
    return parsed.every((value, index) => sameJsonShape(source[index], value))
  }
  if (!record(source) || !record(parsed)) return false
  const sourceKeys = Reflect.ownKeys(source)
  const parsedKeys = Reflect.ownKeys(parsed)
  if (sourceKeys.length !== parsedKeys.length || sourceKeys.some((key) => typeof key !== 'string') ||
      parsedKeys.some((key) => typeof key !== 'string')) return false
  const sourceNames = (sourceKeys as string[]).sort()
  const parsedNames = (parsedKeys as string[]).sort()
  return sourceNames.every((key, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    return key === parsedNames[index] && !!descriptor && 'value' in descriptor && descriptor.enumerable &&
      sameJsonShape(descriptor.value, parsed[key])
  })
}

function validText(value: unknown, max: number, nonblank = false): value is string {
  return typeof value === 'string' && value.length <= max && (!nonblank || !!value.trim()) &&
    hasWellFormedUnicode(value)
}

function validIdentityText(value: unknown, max: number, nonblank = false): value is string {
  return validText(value, max, nonblank) && !CONTROLS.test(value)
}

function hasWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff || index + 1 >= value.length) return false
      index++
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}

function validArtifactId(value: unknown): value is string {
  return validIdentityText(value, MAX_ARTIFACT_ID_CHARS, true)
}

/** Encode an Artifact target outside the IDs used by other attachment kinds. */
export function artifactContextId(artifactId: string): string {
  return `artifact::${encodeURIComponent(artifactId)}`
}

/** Decode only canonical IDs emitted by artifactContextId. */
export function artifactIdFromContextId(id: string): string | null {
  if (typeof id !== 'string' || !id.startsWith('artifact::')) return null
  try {
    const decoded = decodeURIComponent(id.slice('artifact::'.length))
    return validArtifactId(decoded) && artifactContextId(decoded) === id ? decoded : null
  } catch {
    return null
  }
}

function parseFigure(value: unknown): Extract<ArtifactSnapshotBody, { type: 'figure' }> | undefined {
  if (!record(value) || value.type !== 'figure' ||
      !exactOptionalFields(value, ['type', 'shape', 'caption'], ['headline', 'labels', 'series', 'series2', 'legend'])) return undefined
  if (!['hero', 'bars', 'line', 'funnel'].includes(value.shape as string) || !validText(value.caption, ARTIFACT_SNAPSHOT_MAX_BYTES)) return undefined
  let characters = value.caption.length
  let textBytes = new TextEncoder().encode(value.caption).byteLength
  const addText = (text: unknown, nonblank = false): text is string => {
    if (!validText(text, ARTIFACT_SNAPSHOT_MAX_BYTES, nonblank)) return false
    characters += text.length
    if (characters > ARTIFACT_SNAPSHOT_MAX_BYTES) return false
    textBytes += new TextEncoder().encode(text).byteLength
    return textBytes <= ARTIFACT_SNAPSHOT_MAX_BYTES
  }
  if (Object.hasOwn(value, 'headline') && !addText(value.headline, true)) return undefined
  const labels: string[] | undefined = Object.hasOwn(value, 'labels') ? [] : undefined
  if (labels) {
    if (!Array.isArray(value.labels) || value.labels.length > MAX_FIGURE_LABELS) return undefined
    for (const label of value.labels) {
      if (!addText(label)) return undefined
      labels.push(label)
    }
  }
  const series: number[] | undefined = Object.hasOwn(value, 'series') ? [] : undefined
  const series2: number[] | undefined = Object.hasOwn(value, 'series2') ? [] : undefined
  for (const [raw, target] of [[value.series, series], [value.series2, series2]] as const) {
    if (!target) continue
    if (!Array.isArray(raw) || raw.length > MAX_FIGURE_POINTS) return undefined
    for (let index = 0; index < raw.length; index++) {
      const item = raw[index]
      if (typeof item !== 'number' || !Number.isFinite(item)) return undefined
      target.push(item)
    }
  }
  let legend: [string, string] | undefined
  if (Object.hasOwn(value, 'legend')) {
    if (!Array.isArray(value.legend) || value.legend.length !== 2 ||
        !addText(value.legend[0]) || !addText(value.legend[1])) return undefined
    legend = [value.legend[0], value.legend[1]]
  }
  return {
    type: 'figure', shape: value.shape as 'hero' | 'bars' | 'line' | 'funnel', caption: value.caption,
    ...(Object.hasOwn(value, 'headline') ? { headline: value.headline as string } : {}),
    ...(labels ? { labels } : {}), ...(series ? { series } : {}), ...(series2 ? { series2 } : {}),
    ...(legend ? { legend } : {}),
  }
}

function exactOptionalFields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value)
  const allowed = [...required, ...optional]
  return required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => typeof key === 'string' && allowed.includes(key))
}

function parseBody(value: unknown, artifactKind: ArtifactKind): ArtifactSnapshotBody | undefined {
  if (!record(value)) return undefined
  if (value.type === 'figure') {
    if (artifactKind !== 'image') return undefined
    return parseFigure(value)
  }
  const parsed = parseArtifactHistoryBody(value)
  if (!parsed) return undefined
  if ((artifactKind === 'doc' || artifactKind === 'email') && parsed.type !== 'doc') return undefined
  if (artifactKind === 'sheet' && parsed.type !== 'sheet' && parsed.type !== 'workbook') return undefined
  if (artifactKind === 'slide' && parsed.type !== 'slides') return undefined
  if (artifactKind === 'image') return undefined
  return parsed
}

function textFor(snapshot: Pick<ArtifactSnapshot, 'title' | 'artifactKind' | 'revision' | 'body'>): string {
  const value = { title: snapshot.title, artifactKind: snapshot.artifactKind, revision: snapshot.revision, body: snapshot.body }
  if (snapshot.body.type !== 'sheet' && snapshot.body.type !== 'workbook') return JSON.stringify(value)
  const sheets = spreadsheetSheets(snapshot.body)
  if (!sheets.some((sheet) => sheet.rows.some((row) => row.some(isFormulaCell)))) return JSON.stringify(value)
  const calculation = {
    version: 1 as const,
    sheets: sheets.map((sheet) => ({
      id: sheet.id,
      rows: calculateSheet(sheet).map((row) => row.map((cell) => cell.text)),
    })),
  }
  return JSON.stringify({ ...value, calculation })
}

/** Deterministic complete model-input representation derived from the saved body. */
export function artifactSnapshotText(snapshot: ArtifactSnapshot): string {
  const body = parseBody(snapshot.body, snapshot.artifactKind)
  if (!body || !sameJsonShape(snapshot.body, body)) throw new TypeError('Invalid Artifact snapshot body')
  return textFor({ ...snapshot, body })
}

const SNAPSHOT_FIELDS = ['version', 'snapshotId', 'capturedAt', 'artifactId', 'title', 'artifactKind', 'revision', 'body'] as const

/** Closed, detached saved copy. No tenant, grant, source resolver, or live-read capability crosses the boundary. */
export function isArtifactSnapshot(value: unknown): value is ArtifactSnapshot {
  if (!record(value) || !exactFields(value, SNAPSHOT_FIELDS) || value.version !== 1 ||
      !isSnapshotId(value.snapshotId) || !isServedCaptureTime(value.capturedAt) || !validArtifactId(value.artifactId) ||
      !validIdentityText(value.title, MAX_ARTIFACT_TITLE_CHARS, true) ||
      !['doc', 'email', 'image', 'slide', 'sheet'].includes(value.artifactKind as string) ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return false
  const body = parseBody(value.body, value.artifactKind as ArtifactKind)
  if (!body || !sameJsonShape(value.body, body)) return false
  const text = textFor({ title: value.title, artifactKind: value.artifactKind as ArtifactKind, revision: value.revision as number, body })
  return hasWellFormedUnicode(text) && new TextEncoder().encode(text).byteLength <= ARTIFACT_SNAPSHOT_MAX_BYTES
}

/** Build from one currently resolved whole body, stripping only its server revision field. */
export function buildArtifactSnapshot(source: ArtifactSnapshotSource, snapshotId: string, capturedAt: string): ArtifactSnapshot | null {
  if (!source || !validArtifactId(source.artifactId) || !validIdentityText(source.title, MAX_ARTIFACT_TITLE_CHARS, true) ||
      !['doc', 'email', 'image', 'slide', 'sheet'].includes(source.artifactKind) || !isSnapshotId(snapshotId) || !isServedCaptureTime(capturedAt)) return null
  if (!source || !record(source.body)) return null
  const raw = source.body as ArtifactContent & { revision?: unknown }
  const revision = raw?.revision === undefined ? 0 : raw.revision
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return null
  const { revision: _serverRevision, ...bodyInput } = raw
  const body = parseBody(bodyInput, source.artifactKind)
  if (!body) return null
  const snapshot: ArtifactSnapshot = {
    version: 1, snapshotId, capturedAt, artifactId: source.artifactId, title: source.title,
    artifactKind: source.artifactKind, revision: revision as number, body,
  }
  return isArtifactSnapshot(snapshot) ? snapshot : null
}
