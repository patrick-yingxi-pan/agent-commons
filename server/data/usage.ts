/** Seed for the composer's usage gauge — the active conversation's context
 *  window plus the plan's rolling limit windows. In the real product these are
 *  the account's live meter readings (and the context figure comes from the open
 *  session); here they're a deterministic fixture served over `GET /v1/usage`. */
import type { UsageSnapshot } from '../../contract/index.ts'

export const USAGE: UsageSnapshot = {
  context: { used: '352.0k', total: '1.0M', pct: 35 },
  limits: [
    { label: '5-hour limit', reset: 'Resets 6:39 PM', pct: 71 },
    { label: 'Weekly · all models', reset: 'Resets Jun 20', pct: 24 },
    { label: 'Sonnet only', reset: '', pct: 0 },
  ],
}
