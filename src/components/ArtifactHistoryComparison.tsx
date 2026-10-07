import { useMemo, useState } from 'react'
import type { ArtifactHistoryVersion } from '../../contract/artifactHistory.ts'
import { ARTIFACT_HISTORY_COMPARE_PAGE_SIZE, compareArtifactHistoryBodies } from '../lib/artifactHistoryCompare.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { TextDiff } from './TextDiff.tsx'

/** A view of two immutable reads, never a replacement body or restore command. */
export function ArtifactHistoryComparison({ current, selected }: {
  current: ArtifactHistoryVersion
  selected: ArtifactHistoryVersion
}) {
  const changes = useMemo(() => compareArtifactHistoryBodies(current.body, selected.body), [current.body, selected.body])
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(changes.length / ARTIFACT_HISTORY_COMPARE_PAGE_SIZE))
  const activePage = Math.min(page, pages - 1)
  const start = activePage * ARTIFACT_HISTORY_COMPARE_PAGE_SIZE
  const visible = changes.slice(start, start + ARTIFACT_HISTORY_COMPARE_PAGE_SIZE)
  const buttonClass = `${SECONDARY_BUTTON_CLASS} px-3 py-1.5 text-[12px] disabled:opacity-50`

  return <section aria-label="Changes if restored" data-artifact-history-comparison
    data-comparison-current-revision={current.revision} data-comparison-selected-revision={selected.revision}
    className="min-w-0 space-y-3">
    <div className="space-y-1">
      <h3 className="text-[13px] font-semibold text-ink">Changes if restored</h3>
      <p className="text-[12px] leading-relaxed text-ink-soft">Current version {current.revision} → selected version {selected.revision}. Restore requires separate confirmation.</p>
      <p className="text-[12px] leading-relaxed text-ink-soft">Only changed fields are shown. Content compares by position; workbook tabs use saved IDs. Moves aren’t inferred.</p>
    </div>
    {changes.length === 0 ? <p role="status" className="text-[13px] text-ink-soft">No content differences.</p> : <>
      <div className="flex flex-wrap items-center gap-2">
        {pages > 1 && <button type="button" className={buttonClass} disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>Previous comparison page</button>}
        <p role="status" className="text-[12px] text-ink-soft">{pages > 1 ? `${start + 1}–${start + visible.length} of ` : ''}{changes.length} changed {changes.length === 1 ? 'field' : 'fields'}</p>
        {pages > 1 && <button type="button" className={buttonClass} disabled={activePage + 1 >= pages} onClick={() => setPage(activePage + 1)}>Next comparison page</button>}
      </div>
      <div className="space-y-4" key={activePage}>
        {visible.map((change) => <div key={change.key} data-artifact-history-change={change.key}>
          <TextDiff label={change.label} presentation="values" sides={{
            before: change.before === undefined ? { label: `Current · Version ${current.revision}`, notice: 'Not present.' }
              : { label: `Current · Version ${current.revision}`, text: change.before },
            after: change.after === undefined ? { label: `Selected · Version ${selected.revision}`, notice: 'Not present.' }
              : { label: `Selected · Version ${selected.revision}`, text: change.after },
          }} />
        </div>)}
      </div>
    </>}
  </section>
}
