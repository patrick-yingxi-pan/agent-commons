/** ── Routine cadence ────────────────────────────────────────────────────────
 *  One framework-free recurrence model shared by the schedule editor and the
 *  server scheduler. Human-readable cadence strings remain the wire format for
 *  backwards compatibility; this module is the only place that parses them or
 *  turns them into a real, timezone-aware fire time. */

export type Frequency = 'every-30m' | 'hourly' | 'every-2h' | 'weekdays' | 'daily' | 'weekly'

export interface CadenceSpec {
  freq: Frequency
  /** "HH:MM" (24h) — the time of day, for day-anchored frequencies. */
  time?: string
  /** 0=Sunday … 6=Saturday — the day, for `weekly`. */
  weekday?: number
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The frequencies that carry a time-of-day (so the editor shows a time field). */
export const TIMED_FREQS: Frequency[] = ['weekdays', 'daily', 'weekly']

const STEP_MIN: Partial<Record<Frequency, number>> = { 'every-30m': 30, hourly: 60, 'every-2h': 120 }
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "14:30" → "2:30 PM"; "08:00" → "8:00 AM". */
export function formatTime(hhmm: string): string {
  const match = hhmm.match(HHMM)
  if (!match) return hhmm
  const h = Number(match[1])
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${match[2]} ${period}`
}

/** Inverse of formatTime for the common "8:00 AM" form. */
export function parseTime(label: string): string | null {
  const match = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour < 1 || hour > 12 || minute > 59) return null
  let h = hour % 12
  if (match[3].toUpperCase() === 'PM') h += 12
  return `${String(h).padStart(2, '0')}:${match[2]}`
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

/** Best-effort parse of the stored human cadence back into its structured form. */
export function parseCadence(cadence: string): CadenceSpec | null {
  const c = cadence.trim()
  if (/^every\s*30\s*min(?:utes?)?$/i.test(c)) return { freq: 'every-30m' }
  if (/^every\s*2\s*hours?$/i.test(c)) return { freq: 'every-2h' }
  if (/^every\s*hour$/i.test(c)) return { freq: 'hourly' }
  const timed = c.match(/^(.+?)\s*·\s*(.+)$/)
  if (!timed) return null
  const [, head, timePart] = timed
  const time = parseTime(timePart)
  if (!time) return null
  if (/^weekdays$/i.test(head.trim())) return { freq: 'weekdays', time }
  if (/^daily$/i.test(head.trim())) return { freq: 'daily', time }
  const wdName = head.trim().replace(/s$/i, '')
  const weekday = WEEKDAY_NAMES.findIndex((name) => name.toLowerCase() === wdName.toLowerCase())
  return weekday >= 0 ? { freq: 'weekly', time, weekday } : null
}

/** `Intl` is the platform timezone database; validation is explicit so a bad
 *  machine-client patch becomes a descriptive 400 instead of a scheduler crash. */
export function validTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0)
    return true
  } catch {
    return false
  }
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

function formatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function zonedParts(at: number, fmt: Intl.DateTimeFormat): ZonedParts {
  const values = Object.fromEntries(
    fmt.formatToParts(at)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  }
}

function sameWallTime(a: ZonedParts, b: ZonedParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute
}

/** Resolve a wall-clock minute to every matching instant. A DST fall-back can
 *  produce two; a spring-forward gap produces none. The bounded ±16h search
 *  covers every IANA UTC offset and its quarter-hour variants. */
function wallTimeCandidates(parts: ZonedParts, fmt: Intl.DateTimeFormat): number[] {
  const naive = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  const found: number[] = []
  for (let offsetMinutes = -16 * 60; offsetMinutes <= 16 * 60; offsetMinutes += 15) {
    const candidate = naive + offsetMinutes * 60_000
    if (sameWallTime(zonedParts(candidate, fmt), parts)) found.push(candidate)
  }
  return found.sort((a, b) => a - b)
}

function localDateAfter(origin: ZonedParts, days: number): Pick<ZonedParts, 'year' | 'month' | 'day'> {
  const shifted = new Date(Date.UTC(origin.year, origin.month - 1, origin.day + days))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

function localWeekday(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>): number {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

function matchesDay(spec: CadenceSpec, weekday: number): boolean {
  if (spec.freq === 'daily') return true
  if (spec.freq === 'weekdays') return weekday >= 1 && weekday <= 5
  return weekday === (spec.weekday ?? 1)
}

/** The first real instant strictly after `afterMs` that matches the recurrence
 *  in `timezone`. Nonexistent DST wall times are skipped; repeated wall times
 *  resolve to the first still-future occurrence. */
export function nextCadenceFireAt(spec: CadenceSpec, afterMs: number, timezone: string): number | undefined {
  if (!Number.isFinite(afterMs) || !validTimeZone(timezone)) return undefined
  const fmt = formatter(timezone)
  const step = STEP_MIN[spec.freq]
  if (step) {
    let candidate = Math.floor(afterMs / 60_000) * 60_000 + 60_000
    // Even across a DST jump, one matching local clock boundary exists within a day.
    for (let i = 0; i < 24 * 60; i += 1, candidate += 60_000) {
      const local = zonedParts(candidate, fmt)
      if ((local.hour * 60 + local.minute) % step === 0) return candidate
    }
    return undefined
  }

  const time = spec.time ?? '09:00'
  const match = time.match(HHMM)
  if (!match) return undefined
  const origin = zonedParts(afterMs, fmt)
  for (let days = 0; days <= 8; days += 1) {
    const date = localDateAfter(origin, days)
    if (!matchesDay(spec, localWeekday(date))) continue
    const wall: ZonedParts = { ...date, hour: Number(match[1]), minute: Number(match[2]) }
    const candidate = wallTimeCandidates(wall, fmt).find((at) => at > afterMs)
    if (candidate !== undefined) return candidate
  }
  return undefined
}

function relativeLabel(target: number, now: number): string {
  const totalMin = Math.max(1, Math.round((target - now) / 60_000))
  const hours = Math.floor(totalMin / 60)
  const minutes = totalMin % 60
  if (hours === 0) return `in ${minutes} min`
  if (minutes === 0) return `in ${hours}h`
  return `in ${hours}h ${minutes}m`
}

/** Human preview of the same instant the server will persist as its cursor. */
export function nextRunLabel(spec: CadenceSpec, now: Date, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const target = nextCadenceFireAt(spec, now.getTime(), timezone)
  if (target === undefined) return 'Unavailable'
  if (STEP_MIN[spec.freq]) return relativeLabel(target, now.getTime())

  const fmt = formatter(timezone)
  const targetParts = zonedParts(target, fmt)
  const nowParts = zonedParts(now.getTime(), fmt)
  const targetDay = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day)
  const nowDay = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)
  const dayDiff = Math.round((targetDay - nowDay) / 86_400_000)
  const time = formatTime(`${String(targetParts.hour).padStart(2, '0')}:${String(targetParts.minute).padStart(2, '0')}`)
  if (dayDiff === 0) return `Today, ${time}`
  if (dayDiff === 1) return `Tomorrow, ${time}`
  return `${WEEKDAY_SHORT[localWeekday(targetParts)]}, ${time}`
}
