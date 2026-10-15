import type { AgentRequestSummary } from '../../contract/agentRequests.ts'
import { refreshAgentRequests, useAgentRequests } from '../api/agentRequests.ts'
import { SECONDARY_BUTTON_CLASS } from '../lib/button.ts'
import { ResourcePageEmpty, ResourcePageList, ResourcePageSynopsisRow } from './ResourcePage.tsx'

const statuses: Record<AgentRequestSummary['status'], string> = {
  waiting: 'Waiting for owner', running: 'Running', 'awaiting-reply': 'Owner reviewing reply',
  replied: 'Reply shared', denied: 'Declined', cancelled: 'Cancelled',
}
export const requestStatusLabel = (row: AgentRequestSummary) => row.executionBlockedByRestore && row.status === 'waiting' ? 'Restored · cannot run' : statuses[row.status]

/** Canonical history shared by independently deferred overview and decision surfaces. */
export function AgentRequestsSummary({ onOpenRequest }: { onOpenRequest: (id: string) => void }) {
  const query = useAgentRequests()
  if (!query.data) return <ResourcePageEmpty>{query.error ? <RequestReadFailure onRetry={() => refreshAgentRequests()} /> : <span role="status">Loading requests…</span>}</ResourcePageEmpty>
  return <>
    {query.error && <RequestReadFailure onRetry={() => refreshAgentRequests()} />}
    {!query.data.length ? <ResourcePageEmpty>No requests yet. Requests are private to the two people involved.</ResourcePageEmpty> :
      <ResourcePageList>{query.data.map(row => <ResourcePageSynopsisRow key={row.id} title={row.task}
        description={row.role === 'owner' ? `Received for ${row.toAgentLabel}` : `Sent to ${row.toAgentLabel}`}
        meta={requestStatusLabel(row)} onOpen={() => onOpenRequest(row.id)} />)}</ResourcePageList>}
  </>
}
export function RequestReadFailure({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="space-y-2 text-[13px] text-ink-soft"><p>Couldn’t read current request access. No new action is available from stale information.</p><button className={`${SECONDARY_BUTTON_CLASS} px-3 py-2 text-[13px]`} onClick={onRetry}>Try again</button></div>
}
