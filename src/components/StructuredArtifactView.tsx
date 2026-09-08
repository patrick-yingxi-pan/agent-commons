import type { StructuredArtifactBody } from '../../contract/index.ts'

type Size = 'thumb' | 'compact' | 'full'

const SHEET = {
  thumb: { text: 'text-[8px]', cell: 'px-1.5 py-[3px] min-w-12 max-w-[min(10rem,80cqw)]' },
  compact: { text: 'text-[11px]', cell: 'px-2.5 py-1 min-w-24 max-w-[min(20rem,80cqw)]' },
  full: { text: 'text-[12px]', cell: 'px-3 py-1.5 min-w-24 max-w-[min(20rem,80cqw)]' },
} as const

const HEX = /^#[0-9a-f]{6}$/i

/** One structured renderer shared by consent previews and saved artifact bodies.
 * Wide sheets scroll inside a named, keyboard-focusable region; cells wrap rather
 * than silently clipping model-authored labels or values. */
export function StructuredArtifactView({ body, size }: { body: StructuredArtifactBody; size: Size }) {
  return body.type === 'sheet'
    ? <StructuredSheetView body={body} size={size} />
    : <StructuredSlidesView body={body} size={size} />
}

function StructuredSheetView({
  body,
  size,
}: {
  body: Extract<StructuredArtifactBody, { type: 'sheet' }>
  size: Size
}) {
  const t = SHEET[size]
  const rows = size === 'thumb' ? body.rows.slice(0, 3) : body.rows
  return (
    <div
      className={`@container max-w-full overflow-x-auto overflow-y-hidden rounded-lg border border-line ${t.text}`}
      tabIndex={0}
      role="region"
      aria-label="Sheet preview"
      data-structured-artifact-body="sheet"
    >
      <table className="min-w-full border-collapse">
        <thead>
          <tr className="bg-panel-2">
            {body.columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={`${t.cell} whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-left align-top font-semibold text-ink ${index > 0 ? 'border-l border-line' : ''}`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-t border-line">
              {body.columns.map((_, columnIndex) => {
                const value = row[columnIndex] ?? ''
                return (
                  <td
                    key={columnIndex}
                    className={`${t.cell} whitespace-pre-wrap break-words [overflow-wrap:anywhere] align-top ${columnIndex > 0 ? 'border-l border-line text-right tabular-nums text-ink-soft' : 'text-ink'}`}
                  >
                    {HEX.test(value) ? (
                      <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm ring-1 ring-line-strong" style={{ background: value }} />
                        <span className="font-mono break-all">{value}</span>
                      </span>
                    ) : value}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {body.note && size !== 'thumb' && (
        <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] border-t border-line bg-panel/40 px-3 py-1.5 text-[11px] italic text-ink-faint">
          {body.note}
        </div>
      )}
    </div>
  )
}

function StructuredSlidesView({
  body,
  size,
}: {
  body: Extract<StructuredArtifactBody, { type: 'slides' }>
  size: Size
}) {
  const shown = size === 'thumb' ? body.slides.slice(0, 1) : body.slides
  return (
    <div className={size === 'thumb' ? '' : 'space-y-3'} data-structured-artifact-body="slides">
      {shown.map((slide, index) => (
        <article
          key={index}
          className={`flex w-full flex-col rounded-lg border border-line bg-surface ${size === 'thumb' ? 'min-h-24 p-2.5' : 'min-h-48 p-4'}`}
        >
          <h3 className={`max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-serif font-semibold leading-snug text-ink ${size === 'thumb' ? 'text-[9px]' : size === 'compact' ? 'text-[12px]' : 'text-[15px]'}`}>
            {slide.title}
          </h3>
          <ul className={`mt-1.5 space-y-1 text-ink-soft ${size === 'thumb' ? 'text-[8px]' : 'text-[12px]'}`}>
            {(size === 'thumb' ? slide.bullets.slice(0, 2) : slide.bullets).map((bullet, bulletIndex) => (
              <li key={bulletIndex} className="flex min-w-0 gap-1.5">
                <span className="mt-[2px] shrink-0 text-accent">•</span>
                <span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{bullet}</span>
              </li>
            ))}
          </ul>
          {size !== 'thumb' && (
            <div className="mt-auto pt-2 text-right text-[10px] text-ink-faint">
              {index + 1} / {body.slides.length}
            </div>
          )}
        </article>
      ))}
    </div>
  )
}
