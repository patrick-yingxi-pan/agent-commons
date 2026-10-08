import { Component, lazy, Suspense, type ComponentProps } from 'react'
import type { EnvelopeCard } from './ContributionEnvelopeCard.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

async function loadCard() {
  const [module, effectState] = await Promise.all([
    import('./ContributionEnvelopeCard.tsx'),
    import('../controller/contributionMcpEffectMutations.ts'),
  ])
  await effectState.prepareContributionMcpEffectCommands()
  return { default: module.EnvelopeCard }
}
const Card = lazy(loadCard)
type Props = ComponentProps<typeof EnvelopeCard>

/** Keep MCP connection/receipt code out of the initial SectionView chunk. A
 * failed chunk never offers an action that could send an external call. */
export class DeferredContributionEnvelopeCard extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  fallback(failed: boolean) {
    return <div data-contribution-envelope-load={failed ? 'error' : 'loading'} className="mt-5 rounded-xl border border-line bg-surface px-3 py-3">
      <InlineOperationStatus
        tone={failed ? 'alert' : 'status'}
        message={failed
          ? 'Couldn’t load this effect envelope or its saved MCP receipts. No call was sent by loading. Unsaved proposal text or local receipt-check state may be lost; check saved Project history before reloading.'
          : 'Loading effect envelope and saved call receipts…'}
        action={failed ? { label: 'Reload app', onClick: () => window.location.reload() } : undefined}
      />
    </div>
  }
  render() {
    if (this.state.failed) return this.fallback(true)
    return <Suspense fallback={this.fallback(false)}><Card {...this.props} /></Suspense>
  }
}
