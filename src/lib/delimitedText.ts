/** Parse literal CSV/TSV records without normalizing cell contents. Callers
 * must enforce their own source and record bounds before or after parsing. */
export function parseDelimitedText(source: string, delimiter: ',' | '\t'): string[][] | undefined {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let closedQuote = false

  const finishCell = () => {
    row.push(cell)
    cell = ''
  }
  const finishRow = () => {
    finishCell()
    rows.push(row)
    row = []
  }
  const isBreak = (char: string) => char === '\r' || char === '\n'

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quoted) {
      if (char !== '"') {
        cell += char
        continue
      }
      if (source[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = false
        closedQuote = true
      }
      continue
    }

    if (closedQuote) {
      if (char === delimiter) {
        finishCell()
        closedQuote = false
      } else if (isBreak(char)) {
        finishRow()
        closedQuote = false
        if (char === '\r' && source[index + 1] === '\n') index += 1
      } else {
        return undefined
      }
      continue
    }

    if (char === '"') {
      if (cell.length !== 0) return undefined
      quoted = true
    } else if (char === delimiter) {
      finishCell()
    } else if (isBreak(char)) {
      finishRow()
      if (char === '\r' && source[index + 1] === '\n') index += 1
    } else {
      cell += char
    }
  }

  if (quoted) return undefined
  if (cell.length > 0 || row.length > 0 || closedQuote) finishRow()
  return rows.length ? rows : undefined
}
