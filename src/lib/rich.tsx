import { Fragment, type ReactNode } from 'react'

/** Renders a deliberately tiny subset of markdown used in the demo content:
 *  **bold**, `inline code`, • bullets, and newlines. Built as React nodes (no
 *  dangerouslySetInnerHTML) so it stays safe. */
export function renderRich(text: string): ReactNode {
  return text.split('\n').map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {renderInline(line)}
    </Fragment>
  ))
}

function renderInline(line: string): ReactNode {
  const nodes: ReactNode[] = []
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) nodes.push(line.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-semibold text-ink">
          {tok.slice(2, -2)}
        </strong>,
      )
    } else {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-panel-2 px-1 py-0.5 font-mono text-[0.85em] text-accent-strong"
        >
          {tok.slice(1, -1)}
        </code>,
      )
    }
    last = m.index + tok.length
  }
  if (last < line.length) nodes.push(line.slice(last))
  return nodes
}
