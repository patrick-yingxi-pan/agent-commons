/** Shared closed identity coordinates for served-file snapshots. */
export function isSnapshotId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
}

export function isServedSourceId(value: unknown): value is string {
  return typeof value === 'string' && /^(cloud|runner:[A-Za-z0-9_-]+)$/.test(value)
}

export function isServedPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 4096 || /[\\\x00-\x1f\x7f]/.test(value)) return false
  const parts = value.split('/')
  return parts.length <= 64 && parts.every((part) => !!part && !part.startsWith('.') && !/^[a-z]:/i.test(part))
}

export function isServedCaptureTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const instant = Date.parse(value)
  return Number.isFinite(instant) && new Date(instant).toISOString() === value
}
