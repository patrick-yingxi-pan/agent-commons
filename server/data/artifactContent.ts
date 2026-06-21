/**
 * Real, hand-authored bodies for the prototype's artifacts — keyed by file name
 * so one authored body serves every place the file is previewed: the Artifacts
 * gallery card, the gallery's full viewer, and the shared workspace panel (these
 * surfaces all reference the same file names). The numbers here are kept
 * consistent with each artifact's one-line excerpt in `cowork.ts` (e.g. the
 * activation lift, the p95 latency drop) so a reader who opens a file sees the
 * detail the summary promised — not a skeleton.
 *
 * A file with no entry here still previews richly: the renderer derives a title
 * from the file name and lays out a kind-appropriate scaffold.
 */

export type DocBlock =
  | { h: string } // section heading
  | { p: string } // paragraph
  | { ul: string[] } // bullet list
  | { code: string[] } // monospace block (config, headers, signatures)
  | { email: { to: string; subject: string } } // an email's To/Subject header

export type FigureShape = 'hero' | 'bars' | 'line' | 'funnel'

export type ArtifactContent =
  | { type: 'doc'; title: string; blocks: DocBlock[] }
  | { type: 'sheet'; columns: string[]; rows: string[][]; note?: string }
  | { type: 'slides'; slides: { title: string; bullets: string[] }[] }
  | {
      type: 'figure'
      shape: FigureShape
      caption: string
      headline?: string
      labels?: string[]
      series?: number[]
      series2?: number[]
      legend?: [string, string]
    }

/** File name → its real body. */
export const ARTIFACT_CONTENT: Record<string, ArtifactContent> = {
  // ── Insights dashboard ─────────────────────────────────────────────────────
  'insights-onepager.md': {
    type: 'doc',
    title: 'Insights — launch one-pager',
    blocks: [
      { h: 'What it is' },
      {
        p: 'A self-serve analytics surface inside the product: cohorts, funnels, and retention without exporting to a spreadsheet. One screen, filterable, shareable.',
      },
      { h: 'Who it’s for' },
      {
        ul: [
          'PMs who today ask data science for a pull and wait two days',
          'Founders watching activation and retention week over week',
          'Success teams checking a single account’s health before a call',
        ],
      },
      { h: 'Launch plan' },
      {
        ul: [
          'Week 1 — ship behind the `insights` flag to 5 design-partner workspaces',
          'Week 2 — readout, fix the top-3 papercuts, widen to 25%',
          'Week 3 — default on; announce in-app + admin email',
        ],
      },
    ],
  },
  'insights-spec.md': {
    type: 'doc',
    title: 'Insights — functional spec',
    blocks: [
      { h: 'Filters' },
      { p: 'Date range, segment, and plan, composable and reflected in the URL so a filtered view is a shareable link.' },
      { h: 'Saved views' },
      { ul: ['Per-user by default; promotable to workspace-shared', 'A view captures filters + chart + sort', 'Last-opened view restored on return'] },
      { h: 'Sharing' },
      { p: 'Read-only links scoped to the workspace. Link holders see the view, never the underlying export.' },
      { h: 'Empty & error states' },
      {
        ul: [
          'No data yet → sample dashboard with a “connect events” CTA',
          'Query timeout → retry with the last good result kept on screen',
          'Permission denied → explain which role is required, no dead end',
        ],
      },
    ],
  },
  'launch-email.md': {
    type: 'doc',
    title: 'Insights is live behind a flag',
    blocks: [
      { email: { to: 'Workspace admins', subject: 'Insights is live behind a flag — switch it on' } },
      { p: 'Insights is ready for early access. It’s off by default; you can turn it on for your workspace whenever you’re ready.' },
      { h: 'How to switch it on' },
      { ul: ['Settings → Labs → toggle “Insights”', 'It appears in the left nav for everyone in the workspace', 'Roll it back the same way — no data is lost'] },
      { h: 'What to try first' },
      { p: 'Open the Activation funnel and filter to last 30 days. If anything looks off, reply here — we’re reading every response this week.' },
    ],
  },
  'insights-hero.png': {
    type: 'figure',
    shape: 'hero',
    headline: 'Insights',
    caption: 'Marketing hero — the dashboard with the cohort chart in front.',
  },
  'query-perf.sheet': {
    type: 'sheet',
    columns: ['widget', 'p95 before', 'p95 after', 'Δ'],
    rows: [
      ['Cohort retention', '1.81s', '240ms', '−87%'],
      ['Activation funnel', '1.42s', '210ms', '−85%'],
      ['Revenue by plan', '980ms', '180ms', '−82%'],
      ['Active accounts', '760ms', '150ms', '−80%'],
      ['Feature adoption', '1.10s', '230ms', '−79%'],
    ],
    note: 'Measured after adding the composite index on (workspace_id, event_at).',
  },

  // ── Growth experiments ─────────────────────────────────────────────────────
  'onboarding-ab-readout.md': {
    type: 'doc',
    title: 'Onboarding A/B — readout',
    blocks: [
      { h: 'Result' },
      { p: 'Variant B (guided first query) lifted activation +6.2%, 95% CI +2.1–10.3%. Significant at n = 8,410 over 18 days. Recommendation: ship B.' },
      { h: 'What changed' },
      { ul: ['Replaced the empty dashboard with a 3-step guided first query', 'Moved “invite a teammate” after the first aha, not before', 'Cut the product tour from 6 steps to 2'] },
      { h: 'Guardrails' },
      { ul: ['No change to 7-day retention (−0.3%, n.s.)', 'Support tickets flat', 'Time-to-first-query down 41s on average'] },
      { h: 'Next' },
      { p: 'Ship to 100%, then test the invite placement as a follow-on.' },
    ],
  },
  'activation-funnel.png': {
    type: 'figure',
    shape: 'funnel',
    caption: 'Signup → first query → invite, control vs. variant B.',
    labels: ['Signup', 'First query', 'Invite'],
    series: [100, 68, 31],
    series2: [100, 60, 24],
    legend: ['Variant B', 'Control'],
  },
  'june-churn-cohorts.sheet': {
    type: 'sheet',
    columns: ['cohort', 'users', 'churn', 'expansion', 'contraction'],
    rows: [
      ['Annual · Mar', '1,180', '1.9%', '+4.1%', '−1.2%'],
      ['Annual · Apr', '1,204', '2.1%', '+3.8%', '−1.5%'],
      ['Annual · May', '1,190', '4.8%', '+2.2%', '−3.1%'],
      ['Monthly · May', '3,902', '3.0%', '+1.4%', '−2.0%'],
      ['Trial · Jun', '2,180', '6.4%', '+0.0%', '−6.4%'],
    ],
    note: '2,481 paying accounts across 11 monthly cohorts. May annual is the spike.',
  },
  'churn-drivers.md': {
    type: 'doc',
    title: 'June churn — drivers',
    blocks: [
      { p: 'Three drivers explain ~80% of June’s churn spike. All three are addressable this quarter.' },
      { h: '1. Failed payments (≈ 38%)' },
      { p: 'Card expiries with no dunning retry. A 3-attempt retry + pre-expiry email recovers most.' },
      { h: '2. Seat over-provisioning (≈ 26%)' },
      { p: 'Teams that bought 10 seats, activated 3, and downgraded at renewal. Right-size prompts at day 14.' },
      { h: '3. Single-owner accounts (≈ 16%)' },
      { p: 'One active user, no teammates invited. These churn 2.4× the baseline. The new invite placement should help.' },
    ],
  },
  'q3-board-deck.slides': {
    type: 'slides',
    slides: [
      { title: 'Net revenue retention', bullets: ['NRR 114%, up from 108% in Q2', 'Gross retention 91%', 'Expansion outpacing contraction 3 quarters running'] },
      { title: 'Expansion', bullets: ['Seat expansion in 22% of accounts', 'Insights driving upgrade conversations', 'Top cohort: design partners from H1'] },
      { title: 'The roadmap ask', bullets: ['Two hires: a data engineer + a PM', 'Insights GA in Q3, billing v2 in Q4', 'Target: NRR 118% by year end'] },
    ],
  },

  // ── Brand refresh ──────────────────────────────────────────────────────────
  'brand-voice-guide.md': {
    type: 'doc',
    title: 'Brand voice guide',
    blocks: [
      { h: 'The voice in three words' },
      { p: 'Warm, plain, confident. We sound like a sharp colleague who respects your time — not a brochure, not a robot.' },
      { h: 'Do / don’t' },
      {
        ul: [
          'Do: “See what your product is doing.” — Don’t: “Leverage actionable insights.”',
          'Do: “This didn’t work — here’s why.” — Don’t: “An error has occurred.”',
          'Do: short sentences. — Don’t: stacked clauses joined by semicolons.',
        ],
      },
      { h: 'Banned words' },
      { p: 'leverage, synergy, seamless, revolutionary, unlock, robust, best-in-class, game-changer.' },
    ],
  },
  'homepage-copy.md': {
    type: 'doc',
    title: 'Homepage copy',
    blocks: [
      { h: 'Hero' },
      { p: '“See what your product is actually doing.” Sub: Cohorts, funnels, and retention — without the export-to-spreadsheet detour.' },
      { h: 'Proof points' },
      { ul: ['Set up in minutes, not a data-team ticket', 'Every view is a shareable link', 'Trusted by teams shipping weekly'] },
      { h: 'Call to action' },
      { p: 'One CTA, repeated: “Start free.” No “request a demo” fork on the primary path.' },
    ],
  },
  'logo-lockups.png': {
    type: 'figure',
    shape: 'hero',
    headline: 'Insights',
    caption: 'Three wordmark lockups at display, body, and favicon sizes.',
  },
  'color-tokens.sheet': {
    type: 'sheet',
    columns: ['token', 'role', 'hex'],
    rows: [
      ['surface', 'Card / panel background', '#FBFAF7'],
      ['canvas', 'App background', '#F4F2EC'],
      ['ink', 'Primary text', '#26231D'],
      ['ink-soft', 'Secondary text', '#5C574E'],
      ['accent', 'Primary action', '#C7613D'],
      ['line', 'Hairline borders', '#E7E3DA'],
    ],
    note: '38 tokens total; the six load-bearing ones shown.',
  },
  'tone-dos-donts.md': {
    type: 'doc',
    title: 'Tone — do / don’t rewrites',
    blocks: [
      { h: 'Support' },
      { p: 'Don’t: “Your request could not be processed at this time.”' },
      { p: 'Do: “That didn’t go through — your card expired last week. Update it and we’ll retry.”' },
      { h: 'Marketing' },
      { p: 'Don’t: “Unlock powerful, best-in-class analytics.”' },
      { p: 'Do: “See what your product is doing — in plain numbers.”' },
      { h: 'Empty states' },
      { p: 'Don’t: “No data available.” Do: “No events yet — connect your app to see your first funnel.”' },
    ],
  },

  // ── Platform hardening ─────────────────────────────────────────────────────
  'oncall-runbook.md': {
    type: 'doc',
    title: 'On-call runbook',
    blocks: [
      { h: 'First five minutes' },
      { ul: ['Ack the page; post in #incident with a one-line symptom', 'Check the status dashboard before reading code', 'If user-facing, declare a SEV and start a timeline'] },
      { h: 'Escalation path' },
      { p: 'Primary → secondary after 10 min unacked → eng lead for any SEV-1. Don’t debug alone past 20 minutes.' },
      { h: 'Rollback' },
      { code: ['# revert to the last green release', 'deploy rollback --service auth --to last-green'] },
      { p: 'Rollback is always safe here — migrations are backward-compatible for one release.' },
    ],
  },
  'rate-limit-rfc.md': {
    type: 'doc',
    title: 'Rate limiting — RFC (draft)',
    blocks: [
      { h: 'Proposal' },
      { p: 'Token-bucket per API key: 600 requests/minute, burst 100. Counters in Redis, refilled continuously.' },
      { h: 'Response on limit' },
      { p: 'Return 429 with a Retry-After and budget headers so clients can self-throttle instead of hammering.' },
      { code: ['HTTP/1.1 429 Too Many Requests', 'Retry-After: 12', 'X-RateLimit-Limit: 600', 'X-RateLimit-Remaining: 0'] },
      { h: 'Open questions' },
      { ul: ['Per-key vs. per-workspace budgets for shared keys', 'Whether reads and writes share one bucket'] },
    ],
  },
  'refresh-session-notes.md': {
    type: 'doc',
    title: 'Auth refactor — notes',
    blocks: [
      { p: 'Collapsed two divergent token-refresh paths (the retry wrapper and the raw call) into one `refreshSession()`.' },
      { h: 'Before' },
      { code: ['const token = await rawRefresh(req.cookies.rt, { retries: 2 })'] },
      { h: 'After' },
      { code: ['const token = await refreshSession(req.cookies.rt)'] },
      { h: 'Why it matters' },
      { ul: ['One place to reason about expiry, reuse, and revocation', 'Retries + backoff now consistent across callers', 'Deleted 140 lines and two near-duplicate helpers'] },
    ],
  },
  'auth-test-plan.md': {
    type: 'doc',
    title: 'Auth refresh — test plan',
    blocks: [
      { h: 'Expiry' },
      { ul: ['Valid refresh token → new access token', 'Expired refresh token → 401, no new token', 'Clock skew within 30s tolerated'] },
      { h: 'Reuse' },
      { ul: ['Replayed (already-used) token → 401 + family revoked', 'Concurrent refresh → exactly one new token issued'] },
      { h: 'Revocation' },
      { ul: ['Revoked session → 401 immediately', 'Logout everywhere → all family tokens invalid'] },
    ],
  },
  'error-budget.sheet': {
    type: 'sheet',
    columns: ['service', 'SLO', '30-day uptime', 'budget burned'],
    rows: [
      ['auth', '99.95%', '99.97%', '38%'],
      ['api', '99.9%', '99.94%', '52%'],
      ['ingest', '99.9%', '99.88%', '118%'],
      ['web', '99.95%', '99.99%', '11%'],
    ],
    note: 'Ingest is over budget for the month — freeze risky changes until it recovers.',
  },

  // ── Session / demo artifacts not in the gallery ────────────────────────────
  'voice-guide.md': {
    type: 'doc',
    title: 'Voice guide (reference)',
    blocks: [
      { p: 'Warm, plain, confident. Reused from the brand kit so the launch copy matches the rest of the product.' },
      { ul: ['Short sentences', 'Say what happened, then what to do', 'No jargon from the banned list'] },
    ],
  },
  'wordmark-lockups.png': {
    type: 'figure',
    shape: 'hero',
    headline: 'Insights',
    caption: 'Wordmark lockups pulled from brand-kit/ for reference.',
  },
  'q1-launch-email.md': {
    type: 'doc',
    title: 'Q1 launch email (reference)',
    blocks: [
      { email: { to: 'All customers', subject: 'What shipped this quarter' } },
      { p: 'Last quarter’s announcement, kept as a template for tone and structure. Reuse the “what shipped / why it matters / try it” shape.' },
    ],
  },
  'talk-track.md': {
    type: 'doc',
    title: 'Board deck — speaker notes',
    blocks: [
      { h: 'Slide 1 — retention' },
      { p: 'Lead with NRR 114%. Pause on the trend line; it’s the headline.' },
      { h: 'Slide 2 — expansion' },
      { p: 'Tie expansion to Insights driving upgrade conversations. Name two design partners.' },
      { h: 'Slide 3 — the ask' },
      { p: 'Two hires. Be specific about what each unblocks. End on the NRR-118% target.' },
    ],
  },
  'retention-chart.png': {
    type: 'figure',
    shape: 'line',
    caption: 'Weekly retention, last 12 weeks — trending up after the onboarding change.',
    labels: ['W1', 'W4', 'W8', 'W12'],
    series: [62, 66, 71, 78],
  },
  'empty-states-spec.md': {
    type: 'doc',
    title: 'Empty states — spec',
    blocks: [
      { h: 'No data yet' },
      { p: 'Show a sample dashboard with a “connect events” CTA. Never a blank screen.' },
      { h: 'Query error' },
      { p: 'Keep the last good result on screen; offer retry. Explain in plain words.' },
      { h: 'Permission denied' },
      { p: 'Say which role is required and who to ask. No dead end.' },
      { h: 'Loading' },
      { p: 'Skeleton matches the real layout so nothing jumps when data lands.' },
    ],
  },
  'empty-states.png': {
    type: 'figure',
    shape: 'hero',
    headline: 'No events yet',
    caption: 'Mock of the “connect events” empty state with a sample dashboard behind it.',
  },

  // ── Files in the attach catalog (previewed in the composer panel) ──────────
  'Q3-roadmap.pdf': {
    type: 'doc',
    title: 'Q3 roadmap',
    blocks: [
      { h: 'Themes' },
      { ul: ['Insights to GA', 'Billing v2', 'Reliability: ingest error budget'] },
      { h: 'Bets' },
      { ul: ['Self-serve analytics lands in-product', 'Usage-based billing groundwork', 'Halve p95 on the hot dashboards'] },
      { h: 'Non-goals' },
      { p: 'No mobile app this quarter; no new connectors until ingest is back under budget.' },
    ],
  },
  'design-doc.pdf': {
    type: 'doc',
    title: 'Insights — design doc',
    blocks: [
      { h: 'Goal' },
      { p: 'Let any workspace member answer “what is my product doing?” without a data-team ticket.' },
      { h: 'Architecture' },
      { ul: ['Event store → materialized cohort/funnel views', 'Query layer with per-workspace budgets', 'Saved views as shareable, read-only links'] },
      { h: 'Risks' },
      { p: 'Query cost at scale; mitigated by the composite index and result caching.' },
    ],
  },
  'budget.xlsx': {
    type: 'sheet',
    columns: ['team', 'Q3 budget', 'spent', 'remaining'],
    rows: [
      ['Eng', '$420k', '$291k', '$129k'],
      ['Design', '$180k', '$118k', '$62k'],
      ['Growth', '$240k', '$204k', '$36k'],
      ['Infra', '$310k', '$298k', '$12k'],
    ],
    note: 'Infra is nearly fully committed — the ingest work ate the buffer.',
  },
  'chart.png': {
    type: 'figure',
    shape: 'bars',
    caption: 'Weekly active users, last 6 weeks.',
    labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'],
    series: [62, 65, 71, 74, 79, 84],
  },
  'hero-banner.png': {
    type: 'figure',
    shape: 'hero',
    headline: 'See what your product is doing',
    caption: 'Marketing banner draft.',
  },
  'mockup.png': { type: 'figure', shape: 'hero', headline: 'Dashboard mockup', caption: 'High-fidelity mock of the Insights screen.' },
  'wireframe.png': { type: 'figure', shape: 'hero', headline: 'Wireframe', caption: 'Low-fi layout for the filters + chart area.' },
  'screenshot-1.png': { type: 'figure', shape: 'hero', headline: 'Screenshot', caption: 'Captured from the staging build.' },
  'logo.png': { type: 'figure', shape: 'hero', headline: 'Insights', caption: 'Primary wordmark.' },
}

/** The real body for a file, if one is authored. */
export function artifactContentFor(name: string): ArtifactContent | undefined {
  return ARTIFACT_CONTENT[name]
}
