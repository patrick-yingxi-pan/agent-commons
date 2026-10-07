import type { LocalGitReviewFile } from '../../contract/localGitReview.mjs'

export type GitRenameSuggestion = {
  fromPath: string
  toPath: string
  match: 'exact' | 'similar'
  sharedPercent: number
}
export type GitRenameSuggestions = { pairs: GitRenameSuggestion[]; limited: boolean }

const MAX_FILES = 500
const MAX_BYTES = 128 * 1024
const MAX_PAIRS = 4_096
const MAX_LINE_PROBES = 250_000
const MIN_PERCENT = 80
const MIN_MARGIN = 10
const encoder = new TextEncoder()
type Candidate = { path: string; text: string; bytes: number }
type Lines = Map<string, { count: number; bytes: number }>

// Include the actual line terminator in the key: CRLF and missing final newline
// are content, not normalization opportunities. Blank lines are not move evidence.
function lines(text: string): Lines {
  const result: Lines = new Map()
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (!line.trim()) continue
    const previous = result.get(line)
    if (previous) previous.count++
    else result.set(line, { count: 1, bytes: encoder.encode(line).byteLength })
  }
  return result
}

/** Suggestions over an already-admitted raw capture, never Git identity or read
 * authority. Exact and edited matches both remain possible copy-plus-delete.
 * If a comparison budget is exhausted, discard ALL edited suggestions: an
 * unscored candidate could invalidate a previously observed unique best match. */
export function findGitRenameSuggestions(files: readonly LocalGitReviewFile[]): GitRenameSuggestions {
  const pairs: GitRenameSuggestion[] = []
  if (files.length > MAX_FILES) return { pairs, limited: true }
  const removed: Candidate[] = []
  const added: Candidate[] = []
  let bytes = 0
  for (const file of files) {
    const side = file.staged === 'deleted' && file.index.kind === 'missing' ? file.head
      : file.staged === 'added' && file.head.kind === 'missing' ? file.index : null
    if (side?.kind !== 'text') continue
    if (side.text.length > MAX_BYTES) return { pairs: [], limited: true }
    const size = encoder.encode(side.text).byteLength
    bytes += size
    if (bytes > MAX_BYTES) return { pairs: [], limited: true }
    if (!side.text.trim()) continue
    ;(file.staged === 'deleted' ? removed : added).push({ path: file.path, text: side.text, bytes: size })
  }
  const groups = new Map<string, { before: Candidate[]; after: Candidate[] }>()
  for (const [candidates, key] of [[removed, 'before'], [added, 'after']] as const) {
    for (const candidate of candidates) {
      let group = groups.get(candidate.text)
      if (!group) { group = { before: [], after: [] }; groups.set(candidate.text, group) }
      group[key].push(candidate)
    }
  }
  const exactCandidates = new Set<string>()
  for (const group of groups.values()) {
    if (!group.before.length || !group.after.length) continue
    // Duplicate equal bodies must not later be paired to a weaker edited match.
    for (const candidate of [...group.before, ...group.after]) exactCandidates.add(candidate.path)
    if (group.before.length === 1 && group.after.length === 1) pairs.push({
      fromPath: group.before[0].path, toPath: group.after[0].path, match: 'exact', sharedPercent: 100,
    })
  }
  const before = removed.filter(candidate => !exactCandidates.has(candidate.path))
  const after = added.filter(candidate => !exactCandidates.has(candidate.path))
  const finish = (limited = false): GitRenameSuggestions => ({
    pairs: pairs.sort((a, b) => a.fromPath < b.fromPath ? -1 : a.fromPath > b.fromPath ? 1 : a.toPath < b.toPath ? -1 : a.toPath > b.toPath ? 1 : 0),
    limited,
  })
  if (before.length * after.length > MAX_PAIRS) return finish(true)
  const beforeLines = before.map(candidate => lines(candidate.text))
  const afterLines = after.map(candidate => lines(candidate.text))
  type Best = { score: number; runnerUp: number; index: number }
  const newBest = (): Best => ({ score: 0, runnerUp: 0, index: -1 })
  const beforeBest = before.map(newBest)
  const afterBest = after.map(newBest)
  const record = (best: Best, score: number, index: number) => {
    if (score > best.score) { best.runnerUp = best.score; best.score = score; best.index = index }
    else best.runnerUp = Math.max(best.runnerUp, score)
  }
  let probes = 0
  for (let i = 0; i < before.length; i++) {
    for (let j = 0; j < after.length; j++) {
      let sharedBytes = 0
      let sharedLines = 0
      const [small, large] = beforeLines[i].size <= afterLines[j].size
        ? [beforeLines[i], afterLines[j]] : [afterLines[j], beforeLines[i]]
      for (const [line, value] of small) {
        if (++probes > MAX_LINE_PROBES) return finish(true)
        const count = Math.min(value.count, large.get(line)?.count ?? 0)
        sharedLines += count
        sharedBytes += count * value.bytes
      }
      // A tiny common header must not suggest a move of otherwise unrelated files.
      const score = sharedLines < 3 ? 0 : Math.floor(100 * sharedBytes / Math.max(before[i].bytes, after[j].bytes))
      record(beforeBest[i], score, j)
      record(afterBest[j], score, i)
    }
  }
  for (let i = 0; i < before.length; i++) {
    const best = beforeBest[i]
    if (best.score < MIN_PERCENT || best.score - best.runnerUp < MIN_MARGIN) continue
    const reverse = afterBest[best.index]
    if (reverse.index !== i || reverse.score - reverse.runnerUp < MIN_MARGIN) continue
    pairs.push({ fromPath: before[i].path, toPath: after[best.index].path, match: 'similar', sharedPercent: best.score })
  }
  return finish()
}
