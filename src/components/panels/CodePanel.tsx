import { useState } from 'react'
import { FileCode2, GitCompare, SquareTerminal } from 'lucide-react'
import type { DiffLine, FileNode } from '../../types'

type Tab = 'files' | 'diff' | 'terminal'

export function CodePanel({
  files,
  diff,
  terminal,
  branch,
}: {
  files: FileNode[]
  diff: DiffLine[]
  terminal: string[]
  branch: string
}) {
  const [tab, setTab] = useState<Tab>('diff')

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
        <TabButton active={tab === 'files'} onClick={() => setTab('files')} icon={<FileCode2 size={13} />}>
          Files
        </TabButton>
        <TabButton active={tab === 'diff'} onClick={() => setTab('diff')} icon={<GitCompare size={13} />}>
          Diff
        </TabButton>
        <TabButton
          active={tab === 'terminal'}
          onClick={() => setTab('terminal')}
          icon={<SquareTerminal size={13} />}
        >
          Terminal
        </TabButton>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#e9f0f3] px-2 py-0.5 text-[11px] font-medium text-cap-repo">
          {branch}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'files' && <FilesView files={files} />}
        {tab === 'diff' && <DiffView diff={diff} />}
        {tab === 'terminal' && <TerminalView lines={terminal} />}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active ? 'bg-surface text-ink ring-1 ring-line-strong' : 'text-ink-soft hover:bg-surface/60'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function FilesView({ files }: { files: FileNode[] }) {
  const statusMeta = {
    added: { label: 'A', cls: 'text-added bg-added-bg' },
    modified: { label: 'M', cls: 'text-cap-repo bg-[#e9f0f3]' },
    unchanged: { label: '·', cls: 'text-ink-faint bg-panel-2' },
  } as const
  return (
    <div className="p-2">
      {files.map((f) => {
        const meta = statusMeta[f.status]
        const parts = f.path.split('/')
        const name = parts.pop()
        return (
          <div key={f.path} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface/60">
            <span
              className={`flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold ${meta.cls}`}
            >
              {meta.label}
            </span>
            <span className="truncate font-mono text-[12px] text-ink">
              <span className="text-ink-faint">{parts.join('/')}/</span>
              {name}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function DiffView({ diff }: { diff: DiffLine[] }) {
  return (
    <div className="p-2">
      <pre className="overflow-x-auto rounded-lg border border-line bg-[#fcfbf7] py-1 font-mono text-[12px] leading-[1.7]">
        {diff.map((line, i) => {
          if (line.kind === 'hunk') {
            return (
              <div
                key={i}
                className="bg-panel-2 px-3 py-1 text-[11px] font-semibold text-ink-soft"
              >
                {line.text}
              </div>
            )
          }
          const cls =
            line.kind === 'add'
              ? 'bg-added-bg text-added'
              : line.kind === 'del'
                ? 'bg-removed-bg text-removed'
                : 'text-ink-soft'
          const sign = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '
          return (
            <div key={i} className={`px-3 ${cls}`}>
              <span className="mr-2 inline-block w-2 select-none opacity-70">{sign}</span>
              {line.text}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

function TerminalView({ lines }: { lines: string[] }) {
  return (
    <div className="p-2">
      <div className="rounded-lg bg-[#2b2a24] p-3 font-mono text-[12px] leading-[1.7] text-[#e8e5db]">
        {lines.map((l, i) => (
          <div key={i} className={l.startsWith('$') ? 'text-[#e8b98f]' : 'text-[#cfccc0]'}>
            {l}
          </div>
        ))}
        <div className="mt-1 flex items-center text-[#e8b98f]">
          $<span className="stream-caret ml-1">.</span>
        </div>
      </div>
    </div>
  )
}
