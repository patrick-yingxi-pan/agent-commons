import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, Mail, Sheet, Presentation } from 'lucide-react'
import type { Artifact, ArtifactKind } from '../../types'

const KIND_ICON: Record<ArtifactKind, typeof FileText> = {
  doc: FileText,
  email: Mail,
  image: ImageIcon,
  slide: Presentation,
  sheet: Sheet,
}

export function ArtifactPanel({
  artifacts,
  workspaceName,
}: {
  artifacts: Artifact[]
  workspaceName: string
}) {
  const [selectedId, setSelectedId] = useState(artifacts[0]?.id)

  // Keep the selection valid as the workspace fills in during the demo.
  useEffect(() => {
    if (!artifacts.some((a) => a.id === selectedId)) {
      setSelectedId(artifacts[0]?.id)
    }
  }, [artifacts, selectedId])

  const selected = artifacts.find((a) => a.id === selectedId) ?? artifacts[0]

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-3 py-2">
        <div className="text-xs font-semibold text-ink">{workspaceName}</div>
        <div className="text-[11px] text-ink-faint">{artifacts.length} items in workspace</div>
      </div>

      <div className="shrink-0 overflow-y-auto px-2 py-2" style={{ maxHeight: '46%' }}>
        {artifacts.map((a) => {
          const Icon = KIND_ICON[a.kind]
          const active = a.id === selected?.id
          return (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                active ? 'bg-surface ring-1 ring-line-strong' : 'hover:bg-surface/60'
              }`}
            >
              <Icon size={16} className="shrink-0 text-cap-workspace" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-ink">{a.name}</div>
                <div className="truncate text-[11px] text-ink-faint">{a.meta}</div>
              </div>
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="flex-1 overflow-y-auto border-t border-line bg-surface p-3">
          <ArtifactPreview artifact={selected} />
        </div>
      )}
    </div>
  )
}

function ArtifactPreview({ artifact }: { artifact: Artifact }) {
  if (artifact.kind === 'image') {
    return (
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Preview
        </div>
        <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-gradient-to-br from-[#f3d9c9] via-[#e9b79c] to-[#cf8f6e] text-sm font-medium text-white/90 shadow-inner">
          {artifact.name}
        </div>
      </div>
    )
  }
  if (artifact.kind === 'sheet') {
    return (
      <div>
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
          Preview
        </div>
        <div className="overflow-hidden rounded-lg border border-line text-[11px]">
          {['cohort,users,churn', 'Annual · May,1,204,2.1%', 'Annual · Jun,1,190,4.8%', 'Monthly · Jun,3,902,3.0%'].map(
            (row, i) => (
              <div
                key={i}
                className={`grid grid-cols-3 gap-2 px-2 py-1 ${
                  i === 0 ? 'bg-panel-2 font-semibold text-ink' : 'text-ink-soft'
                } ${i > 0 ? 'border-t border-line' : ''}`}
              >
                {row.split(',').map((c, j) => (
                  <span key={j} className="truncate">
                    {c}
                  </span>
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    )
  }
  // doc / email / slide → mocked text lines
  return (
    <div>
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        {artifact.kind === 'email' ? 'Draft email' : 'Document'}
      </div>
      <div className="space-y-2">
        <div className="h-3 w-2/3 rounded bg-panel-2" />
        <div className="h-2.5 w-full rounded bg-panel-2" />
        <div className="h-2.5 w-11/12 rounded bg-panel-2" />
        <div className="h-2.5 w-full rounded bg-panel-2" />
        <div className="h-2.5 w-4/5 rounded bg-panel-2" />
        <div className="h-2.5 w-full rounded bg-panel-2" />
        <div className="h-2.5 w-3/4 rounded bg-panel-2" />
      </div>
    </div>
  )
}
