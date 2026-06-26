/** ── Cadence model ──────────────────────────────────────────────────────────
 *  A scheduled routine's recurrence, as a small structured spec — so the
 *  Schedule panel's editor can offer a frequency + time picker instead of a free
 *  string, and derive the three human labels the routine displays (the `cadence`
 *  chip, the WHEN `trigger` sentence, and the `next`-run estimate) coherently from
 *  one source. Pure + framework-free so it's unit-tested; the UI passes `new
 *  Date()` for `now`. The daemon owns real firing — `next` is an honest display
 *  estimate, not a scheduling guarantee. */

export type Frequency = 'every-30m' | 'hourly' | 'every-2h' | 'weekdays' | 'daily' | 'weekly'

export interface CadenceSpec {
  freq: Frequency
  /** "HH:MM" (24h) — the time of day, for the day-anchored frequencies. */
  time?: string
  /** 0=Sunday … 6=Saturday — the day, for `weekly`. */
  weekday?: number
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The frequencies that carry a time-of-day (so the editor shows a time field). */
export const TIMED_FREQS: Frequency[] = ['weekdays', 'daily', 'weekly']

/** "14:30" → "2:30 PM"; "08:00" → "8:00 AM". */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

/** Inverse of formatTime for the common "8:00 AM" form → "08:00" (used to
 *  pre-fill the editor from a stored cadence string). Returns null if unparseable. */
export function parseTime(label: string): string | null {
  const m = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

/** The cadence chip label + the WHEN sentence for a spec. */
export function describeCadence(spec: CadenceSpec): { cadence: string; trigger: string } {
  const time = formatTime(spec.time ?? '09:00')
  switch (spec.freq) {
    case 'every-30m':
      return { cadence: 'Every 30 min', trigger: 'every 30 minutes' }
    case 'hourly':
      return { cadence: 'Every hour', trigger: 'every hour' }
    case 'every-2h':
      return { cadence: 'Every 2 hours', trigger: 'every 2 hours' }
    case 'weekdays':
      return { cadence: `Weekdays · ${time}`, trigger: `every weekday at ${time}` }
    case 'daily':
      return { cadence: `Daily · ${time}`, trigger: `every day at ${time}` }
    case 'weekly': {
      const wd = spec.weekday ?? 1
      return { cadence: `${WEEKDAY_NAMES[wd]}s · ${time}`, trigger: `every ${WEEKDAY_NAMES[wd]} at ${time}` }
    }
  }
}

const STEP_MIN: Partial<Record<Frequency, number>> = { 'every-30m': 30, hourly: 60, 'every-2h': 120 }

/** The next time this cadence would fire, as a human label relative to `now`.
 *  Interval frequencies read "in 18 min" / "in 1h 30m"; day-anchored ones read
 *  "Today, 9:00 AM" / "Tomorrow, 9:00 AM" / "Mon, 9:00 AM" — matching the seed. */
export function nextRunLabel(spec: CadenceSpec, now: Date): string {
  const step = STEP_MIN[spec.freq]
  if (step) {
    const target = nextIntervalBoundary(now, step)
    return relativeLabel(target, now)
  }
  const [hh, mm] = (spec.time ?? '09:00').split(':').map(Number)
  for (let i = 0; i < 8; i++) {
    const cand = new Date(now)
    cand.setDate(now.getDate() + i)
    cand.setHours(hh, mm, 0, 0)
    if (cand.getTime() > now.getTime() && matchesDay(spec, cand)) return dayLabel(cand, now)
  }
  // Unreachable in practice (a matching day exists within 8 days), but keep total.
  const fallback = new Date(now)
  fallback.setHours(hh, mm, 0, 0)
  return dayLabel(fallback, now)
}

function matchesDay(spec: CadenceSpec, d: Date): boolean {
  if (spec.freq === 'daily') return true
  if (spec.freq === 'weekdays') {
    const wd = d.getDay()
    return wd >= 1 && wd <= 5
  }
  return d.getDay() === (spec.weekday ?? 1) // weekly
}

/** The next clock boundary that is a strict multiple of `stepMin` minutes-of-day. */
function nextIntervalBoundary(now: Date, stepMin: number): Date {
  const minutesOfDay = now.getHours() * 60 + now.getMinutes()
  const nextMin = (Math.floor(minutesOfDay / stepMin) + 1) * stepMin
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setMinutes(nextMin)
  return d
}

function relativeLabel(target: Date, now: Date): string {
  const totalMin = Math.max(1, Math.round((target.getTime() - now.getTime()) / 60000))
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `in ${m} min`
  if (m === 0) return `in ${h}h`
  return `in ${h}h ${m}m`
}

function dayLabel(target: Date, now: Date): string {
  const time = formatTime(`${String(target.getHours()).padStart(2, '0')}:${String(target.getMinutes()).padStart(2, '0')}`)
  const dayDiff = Math.round(
    (startOfDay(target).getTime() - startOfDay(now).getTime()) / 86_400_000,
  )
  if (dayDiff === 0) return `Today, ${time}`
  if (dayDiff === 1) return `Tomorrow, ${time}`
  return `${WEEKDAY_SHORT[target.getDay()]}, ${time}`
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Best-effort parse of a stored cadence string back into a spec, to pre-fill the
 *  editor. Returns null when it doesn't recognize the shape (the editor then opens
 *  on a sensible default). */
export function parseCadence(cadence: string): CadenceSpec | null {
  const c = cadence.trim()
  if (/every\s*30\s*min/i.test(c)) return { freq: 'every-30m' }
  if (/every\s*2\s*hours?/i.test(c)) return { freq: 'every-2h' }
  if (/every\s*hour/i.test(c)) return { freq: 'hourly' }
  const timed = c.match(/^(.+?)\s*·\s*(.+)$/)
  if (timed) {
    const [, head, timePart] = timed
    const time = parseTime(timePart)
    if (time) {
      if (/^weekdays$/i.test(head.trim())) return { freq: 'weekdays', time }
      if (/^daily$/i.test(head.trim())) return { freq: 'daily', time }
      const wdName = head.trim().replace(/s$/i, '')
      const wd = WEEKDAY_NAMES.findIndex((n) => n.toLowerCase() === wdName.toLowerCase())
      if (wd >= 0) return { freq: 'weekly', time, weekday: wd }
    }
  }
  return null
}
