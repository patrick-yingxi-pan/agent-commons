/**
 * Find the first case-insensitive literal match and return a bounded snippet
 * in the original text. Matching follows full-string JavaScript lowercasing,
 * while the source span is mapped back through per-codepoint lowercase widths.
 */
export function literalSearchSnippet(content: string, normalizedQuery: string, maxChars = 320): string | undefined {
  if (!normalizedQuery) return undefined

  const lowerContent = content.toLowerCase()
  const lowerAt = lowerContent.indexOf(normalizedQuery)
  if (lowerAt < 0) return undefined

  const span = sourceSpanForLowerRange(content, lowerAt, lowerAt + normalizedQuery.length)
  return boundedSnippet(content, span.start, span.end, maxChars)
}

function sourceSpanForLowerRange(content: string, lowerStart: number, lowerEnd: number): { start: number; end: number } {
  let lowerAt = 0
  let sourceAt = 0
  let sourceStart: number | undefined
  for (const character of content) {
    // Lowercasing a full string can change values contextually (Greek final
    // sigma), but its UTF-16 width is the sum of per-codepoint widths.
    const lowerWidth = character.toLowerCase().length
    const nextLowerAt = lowerAt + lowerWidth
    if (sourceStart === undefined && lowerAt < lowerEnd && nextLowerAt > lowerStart) sourceStart = sourceAt
    if (sourceStart !== undefined && nextLowerAt >= lowerEnd) return { start: sourceStart, end: sourceAt + character.length }
    lowerAt += lowerWidth
    sourceAt += character.length
  }
  return { start: sourceAt, end: sourceAt }
}

function boundedSnippet(content: string, matchAt: number, matchEnd: number, maxChars: number): string {
  const max = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0
  if (max === 0) return ''
  if (content.length <= max) return content

  // Reserve space for ellipses where possible. Usually the full match fits;
  // Unicode expansion can exceed the query width, so a longer source match
  // retains its beginning instead of moving the snippet past it.
  const window = Math.max(0, max - 2)
  const matchLength = matchEnd - matchAt
  const before = Math.max(0, Math.min(80, Math.floor((window - matchLength) / 2)))
  const left = Math.max(0, Math.min(matchAt - before, content.length - window))
  const right = Math.min(content.length, left + window)
  const prefix = left > 0 && max >= 2 ? '…' : ''
  const suffix = right < content.length && max - prefix.length >= 2 ? '…' : ''
  const available = Math.max(0, max - prefix.length - suffix.length)
  const text = content.slice(left, Math.min(right, left + available))
  return `${prefix}${text}${suffix}`
}
