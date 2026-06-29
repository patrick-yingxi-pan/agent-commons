import { Server } from 'lucide-react'
import { useRunners } from '../api'
import { GaugePopover } from './GaugePopover'
import type { Runner } from '../../contract/index.ts'

/* Online/offline dot. A durable runner that disconnected stays listed (D4) but
   dims to grey rather than vanishing. */
const STATUS_COLOR: Record<Runner['status'], string> = { online: '#3fa34d', offline: '#9aa0a6' }

const CAP_LABEL: Record<string, string> = {
  'fs.read': 'fs read',
  'fs.list': 'fs list',
  'fs.write': 'fs write',
  terminal: 'terminal',
  process: 'process',
}

/** Hosts button: an ambient indicator of the native runners connected to this
 *  account (one per host) and the capabilities each advertises. Runners are a
 *  standing fabric, not attached contexts (D4) — so this sits beside the usage
 *  gauge, always present, never inside the Add-context menu. It reads the live
 *  registry (`GET /v1/runners`); the `runner.*` events keep it fresh. */
export function HostsControl() {
  // Server-owned: the UI just caches the registry snapshot.
  const runners = useRunners().data ?? []
  const online = runners.filter((a) => a.status === 'online')

  return (
    <GaugePopover
      icon={<Server size={15} className="text-ink-faint" />}
      count={online.length}
      title={`Hosts — ${online.length} connected`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink-faint">Connected hosts</span>
        <span className="text-[12px] text-ink">{online.length} online</span>
      </div>

      <div className="mt-2.5 space-y-2.5">
        {runners.length === 0 && (
          <p className="text-[12px] leading-snug text-ink-faint">
            No runners connected. A desktop helper running on a host appears here with the
            capabilities it offers.
          </p>
        )}
        {runners.map((a) => (
          <RunnerRow key={a.id} runner={a} />
        ))}
      </div>

      <p className="mt-3 border-t border-line pt-2.5 text-[11px] leading-tight text-ink-faint">
        Hosts are where work can run — referenced by name, not attached as context.
      </p>
    </GaugePopover>
  )
}

function RunnerRow({ runner }: { runner: Runner }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="flex items-center gap-1.5 text-ink">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: STATUS_COLOR[runner.status] }}
          />
          {runner.label}
        </span>
        <span className="text-ink-faint">{runner.host}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {runner.capabilities.map((c) => (
          <span
            key={c.type}
            className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-ink-faint"
            title={`scopes: ${c.scopes.join(', ')}`}
          >
            {CAP_LABEL[c.type] ?? c.type}
          </span>
        ))}
      </div>
    </div>
  )
}
