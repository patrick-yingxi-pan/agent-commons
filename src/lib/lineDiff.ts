export type LineDiffRow = {
  kind: 'context' | 'delete' | 'add'
  text: string
  eol: '\n' | '\r\n' | ''
  oldLine?: number
  newLine?: number
}

export type LineDiffHunk = {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  rows: LineDiffRow[]
}

export type LineDiffResult =
  | { status: 'ready'; hunks: LineDiffHunk[]; added: number; deleted: number }
  | { status: 'too-complex' }

const MAX_INPUT_BYTES = 64 * 1024
const MAX_LINES = 8_000
const MAX_WORK = 2_000_000
const MAX_TRACE_CELLS = 2_000_000
const CONTEXT_LINES = 3

type Line = { text: string; eol: '\n' | '\r\n' | '' }
type Edit = { kind: 'context' | 'delete' | 'add'; line: Line }

function withinUtf8Limit(value: string): boolean {
  if (value.length > MAX_INPUT_BYTES) return false
  let bytes = 0
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x80) bytes++
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) { bytes += 4; i++ }
      else bytes += 3
    } else bytes += 3
    if (bytes > MAX_INPUT_BYTES) return false
  }
  return true
}

function splitLines(value: string): Line[] {
  if (value.length === 0) return []
  const lines: Line[] = []
  let start = 0
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) !== 10) continue
    const crlf = i > start && value.charCodeAt(i - 1) === 13
    lines.push({ text: value.slice(start, crlf ? i - 1 : i), eol: crlf ? '\r\n' : '\n' })
    if (lines.length > MAX_LINES) return lines
    start = i + 1
  }
  if (start < value.length) lines.push({ text: value.slice(start), eol: '' })
  return lines
}

function sameLine(a: Line, b: Line): boolean {
  return a.text === b.text && a.eol === b.eol
}

function myersMiddle(before: Line[], after: Line[]): Edit[] | null {
  const n = before.length
  const m = after.length
  const max = n + m
  const width = max * 2 + 3
  const offset = max + 1
  let frontier = new Int32Array(width)
  const trace: Int32Array[] = []
  let traceCells = 0
  let work = 0
  let found = -1

  for (let d = 0; d <= max; d++) {
    if (traceCells + width > MAX_TRACE_CELLS) return null
    trace.push(frontier.slice())
    traceCells += width
    for (let k = -d; k <= d; k += 2) {
      if (++work > MAX_WORK) return null
      const slot = offset + k
      let x: number
      if (k === -d || (k !== d && frontier[slot - 1] < frontier[slot + 1])) x = frontier[slot + 1]
      else x = frontier[slot - 1] + 1
      let y = x - k
      while (x < n && y < m && sameLine(before[x], after[y])) {
        if (++work > MAX_WORK) return null
        x++
        y++
      }
      frontier[slot] = x
      if (x >= n && y >= m) { found = d; break }
    }
    if (found !== -1) break
  }
  if (found === -1) return null

  const reversed: Edit[] = []
  let x = n
  let y = m
  for (let d = found; d > 0; d--) {
    const previous = trace[d]
    const k = x - y
    const slot = offset + k
    const previousK = k === -d || (k !== d && previous[slot - 1] < previous[slot + 1]) ? k + 1 : k - 1
    const previousX = previous[offset + previousK]
    const previousY = previousX - previousK
    while (x > previousX && y > previousY) {
      reversed.push({ kind: 'context', line: before[--x] })
      y--
    }
    if (x === previousX) reversed.push({ kind: 'add', line: after[--y] })
    else reversed.push({ kind: 'delete', line: before[--x] })
  }
  while (x > 0 && y > 0) {
    reversed.push({ kind: 'context', line: before[--x] })
    y--
  }
  while (x > 0) reversed.push({ kind: 'delete', line: before[--x] })
  while (y > 0) reversed.push({ kind: 'add', line: after[--y] })
  return reversed.reverse()
}

function myers(before: Line[], after: Line[]): Edit[] | null {
  let prefix = 0
  const shared = Math.min(before.length, after.length)
  while (prefix < shared && sameLine(before[prefix], after[prefix])) prefix++

  let suffix = 0
  while (suffix < shared - prefix &&
    sameLine(before[before.length - suffix - 1], after[after.length - suffix - 1])) suffix++

  const beforeEnd = before.length - suffix
  const afterEnd = after.length - suffix
  const beforeMiddle = before.slice(prefix, beforeEnd)
  const afterMiddle = after.slice(prefix, afterEnd)
  const edits: Edit[] = []

  for (let i = 0; i < prefix; i++) edits.push({ kind: 'context', line: before[i] })
  if (beforeMiddle.length === 0) {
    for (const line of afterMiddle) edits.push({ kind: 'add', line })
  } else if (afterMiddle.length === 0) {
    for (const line of beforeMiddle) edits.push({ kind: 'delete', line })
  } else {
    const middle = myersMiddle(beforeMiddle, afterMiddle)
    if (!middle) return null
    edits.push(...middle)
  }
  for (let i = suffix; i > 0; i--) edits.push({ kind: 'context', line: before[before.length - i] })
  return edits
}

function toHunks(edits: Edit[]): { hunks: LineDiffHunk[]; added: number; deleted: number } {
  const changed: number[] = []
  let added = 0
  let deleted = 0
  for (let i = 0; i < edits.length; i++) {
    const kind = edits[i].kind
    if (kind === 'add') { changed.push(i); added++ }
    else if (kind === 'delete') { changed.push(i); deleted++ }
  }
  if (changed.length === 0) return { hunks: [], added, deleted }

  const windows: Array<{ start: number; end: number }> = []
  for (const index of changed) {
    const next = { start: Math.max(0, index - CONTEXT_LINES), end: Math.min(edits.length - 1, index + CONTEXT_LINES) }
    const last = windows.at(-1)
    if (last && next.start <= last.end + 1) last.end = Math.max(last.end, next.end)
    else windows.push(next)
  }

  const hunks: LineDiffHunk[] = []
  let oldLine = 1
  let newLine = 1
  let editIndex = 0
  for (const window of windows) {
    while (editIndex < window.start) {
      if (edits[editIndex].kind !== 'add') oldLine++
      if (edits[editIndex].kind !== 'delete') newLine++
      editIndex++
    }
    const oldStartAtWindow = oldLine
    const newStartAtWindow = newLine
    const rows: LineDiffRow[] = []
    let oldCount = 0
    let newCount = 0
    while (editIndex <= window.end) {
      const edit = edits[editIndex++]
      if (edit.kind === 'context') {
        rows.push({ kind: 'context', text: edit.line.text, eol: edit.line.eol, oldLine, newLine })
        oldLine++; newLine++; oldCount++; newCount++
      } else if (edit.kind === 'delete') {
        rows.push({ kind: 'delete', text: edit.line.text, eol: edit.line.eol, oldLine })
        oldLine++; oldCount++
      } else {
        rows.push({ kind: 'add', text: edit.line.text, eol: edit.line.eol, newLine })
        newLine++; newCount++
      }
    }
    hunks.push({
      oldStart: oldCount === 0 ? oldStartAtWindow - 1 : oldStartAtWindow,
      oldCount,
      newStart: newCount === 0 ? newStartAtWindow - 1 : newStartAtWindow,
      newCount,
      rows,
    })
  }
  return { hunks, added, deleted }
}

export function diffLines(beforeText: string, afterText: string): LineDiffResult {
  if (!withinUtf8Limit(beforeText) || !withinUtf8Limit(afterText)) return { status: 'too-complex' }
  const before = splitLines(beforeText)
  const after = splitLines(afterText)
  if (before.length > MAX_LINES || after.length > MAX_LINES) return { status: 'too-complex' }
  const edits = myers(before, after)
  if (!edits) return { status: 'too-complex' }
  const result = toHunks(edits)
  return { status: 'ready', ...result }
}
