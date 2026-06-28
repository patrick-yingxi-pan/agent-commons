/** ── Seed: Commissions (docs/agent-commons.md, D7/D13) ──────────────────────
 *  One seeded commission — the default Agent contributing to the guarded Insights
 *  Project (`p-insights`, server/data/cowork.ts). The degenerate single-Contributor
 *  case: no `grant` / `authority`, so it inherits the Agent's (which inherits the
 *  provider's). Cross-user commissions arrive with isolation (D12) and multi-principal
 *  coordination at the Guardian (D11). */
import type { Commission } from '../../contract/index.ts'
import { DEFAULT_AGENT } from './workers.ts'

export const SEED_COMMISSIONS: Commission[] = [
  // The owner's default Agent — a maintainer (D14): full work permissions, and it
  // outranks ordinary writers in acquisition-time arbitration.
  { id: 'commission-insights-default', agentId: DEFAULT_AGENT.id, projectId: 'p-insights', role: 'maintainer' },
]
