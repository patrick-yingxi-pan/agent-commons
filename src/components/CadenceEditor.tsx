import { useRef, useState, type ReactNode } from 'react'
import type { SchedulePatch } from '../../contract/index.ts'
import type { ScheduledTask } from '../types'
import type { CadenceSpec, Frequency } from '../lib/cadence'

type Commit = (patch: SchedulePatch, expectedRevision: number) => Promise<void>

const FREQ_OPTIONS: { id: Frequency; label: string }[] = [
  { id: 'every-30m', label: 'Every 30 min' }, { id: 'hourly', label: 'Hourly' },
  { id: 'every-2h', label: 'Every 2 hours' }, { id: 'weekdays', label: 'Weekdays' },
  { id: 'daily', label: 'Daily' }, { id: 'weekly', label: 'Weekly' },
]
const TIMEZONES = ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'UTC', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai', 'Australia/Sydney']

/** Deferred cadence popover body; the stable Schedule panel owns its opening. */
export function CadenceEditor({
  task,
  busy,
  error,
  commit,
  initialSpec,
  timedFreqs,
  weekdayNames,
  describe,
  nextLabel,
  busyIndicator,
  doneIndicator,
  softButtonClass,
  onClose,
}: {
  task: ScheduledTask
  busy: boolean
  error: string | null
  commit: Commit
  initialSpec: CadenceSpec
  timedFreqs: readonly Frequency[]
  weekdayNames: readonly string[]
  describe: typeof import('../lib/cadence').describeCadence
  nextLabel: typeof import('../lib/cadence').nextRunLabel
  busyIndicator: ReactNode
  doneIndicator: ReactNode
  softButtonClass: string
  onClose: () => void
}) {
  const baseRevision = useRef(task.revision ?? 0)
  const close = busy ? () => {} : onClose
  const [spec, setSpec] = useState<CadenceSpec>(initialSpec)
  const [tz, setTz] = useState(task.timezone ?? 'UTC')
  const [missedFirePolicy, setMissedFirePolicy] = useState(task.missedFirePolicy ?? 'skip')

  const timed = timedFreqs.includes(spec.freq)
  const preview = describe(spec)
  const next = nextLabel(spec, new Date(), tz)

  const apply = async () => {
    const derived = describe(spec)
    await commit({ cadence: derived.cadence, timezone: tz, missedFirePolicy }, baseRevision.current)
  }

  return (
    <fieldset disabled={busy} className="contents">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Frequency</div>
        <div className="mt-1.5 grid grid-cols-2 gap-1">
          {FREQ_OPTIONS.map((f) => {
            const on = spec.freq === f.id
            return <button key={f.id} onClick={() => setSpec((s) => ({ ...s, freq: f.id, time: s.time ?? '09:00', weekday: s.weekday ?? 1 }))} aria-pressed={on} className={`rounded-md border px-2 py-1 text-[12px] font-medium transition ${on ? 'border-accent bg-accent-tint text-accent-strong' : 'border-line bg-surface text-ink-soft hover:border-line-strong'}`}>{f.label}</button>
          })}
        </div>
        {spec.freq === 'weekly' && <label className="mt-2.5 block"><span className="text-[11px] font-medium text-ink-soft">Day</span><select value={spec.weekday ?? 1} onChange={(e) => setSpec((s) => ({ ...s, weekday: Number(e.target.value) }))} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none transition focus:border-co">{weekdayNames.map((n, i) => <option key={i} value={i}>{n}</option>)}</select></label>}
        {timed && <label className="mt-2.5 block"><span className="text-[11px] font-medium text-ink-soft">Time</span><input type="time" value={spec.time ?? '09:00'} onChange={(e) => setSpec((s) => ({ ...s, time: e.target.value }))} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none transition focus:border-co" /></label>}
        <label className="mt-2.5 block"><span className="text-[11px] font-medium text-ink-soft">Timezone</span><select value={tz} onChange={(e) => setTz(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none transition focus:border-co">{TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}</select></label>
        <label className="mt-2.5 block"><span className="text-[11px] font-medium text-ink-soft">After downtime</span><select value={missedFirePolicy} onChange={(e) => setMissedFirePolicy(e.target.value as 'skip' | 'catch-up-once')} className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-[13px] text-ink outline-none transition focus:border-co"><option value="skip">Skip missed run</option><option value="catch-up-once">Run once when back</option></select></label>
        <div className="mt-3 rounded-lg bg-panel-2/50 px-2.5 py-2 text-[12px] text-ink-soft"><span className="font-medium text-ink">{preview.cadence}</span> · next {next}</div>
        {error && <p role="status" className="mt-2 text-[12px] text-removed">{error}</p>}
        <div className="mt-2.5 flex items-center justify-end gap-2">
          <button onClick={close} disabled={busy} className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft transition hover:text-ink disabled:cursor-not-allowed disabled:opacity-50">Cancel</button>
          <button onClick={apply} disabled={busy} className={`flex items-center gap-1 ${softButtonClass} px-2.5 py-1 text-[12px] disabled:cursor-not-allowed disabled:opacity-50`}>{busy ? busyIndicator : doneIndicator}{busy ? 'Applying…' : 'Apply'}</button>
        </div>
    </fieldset>
  )
}
