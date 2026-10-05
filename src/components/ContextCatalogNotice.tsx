import type { ContextCatalog } from '../../contract/contexts.ts'
import type { QueryState } from '../api/cache.ts'
import { retryContextCatalog } from '../api/contextCatalog.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'

const NOTICE_CLASS = 'px-1 py-2 text-[12px] text-ink-soft'

export function ContextDemoNotice() {
  return <p data-context-catalog-state="demo" role="note" className={NOTICE_CLASS}>Demo contexts — sample data only.</p>
}

/** Both intake surfaces share honest loading, failure and fixture disclosure. */
export function ContextCatalogNotice({ query }: { query: QueryState<ContextCatalog> }) {
  if (query.data) return query.data.developmentFixtures ? <ContextDemoNotice /> : null
  const phase = query.status === 'error' ? 'error' : 'loading'
  return <div data-context-catalog-state={phase} role={phase === 'error' ? 'alert' : 'status'}
    aria-busy={phase === 'loading' || undefined} className={NOTICE_CLASS}>
    <p>{phase === 'error' ? 'Could not load context options.' : 'Loading context options…'}</p>
    {phase === 'error' && <button type="button" onClick={retryContextCatalog}
      className={`${SECONDARY_BUTTON_CLASS} mt-2 px-2 py-1 text-[12px]`}>Retry context options</button>}
  </div>
}
