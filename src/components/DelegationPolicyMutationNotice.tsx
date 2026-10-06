import { RotateCcw, X } from 'lucide-react'
import { discardDelegationPolicy, retryDelegationPolicy, useDelegationPolicyStatus } from '../controller/delegationPolicyMutations.ts'
import { InlineOperationStatus } from './InlineOperationStatus'
import { Spinner } from './Spinner'

/** Shell-owned Retry/Dismiss surface for one frozen owner policy edit. */
export function DelegationPolicyMutationNotice() {
  const mutation = useDelegationPolicyStatus()
  if (!mutation.busy && !mutation.error) return null
  return (
    <div
      data-delegation-policy-mutation={mutation.error ? 'failed' : 'pending'}
      className="relative z-[60] shrink-0 border-b border-line bg-panel-2/95 px-2 pt-2"
    >
      {mutation.busy ? (
        <InlineOperationStatus
          tone="status"
          message={mutation.pendingCount > 1 ? `Saving Delegation policy… ${mutation.pendingCount - 1} more queued` : 'Saving Delegation policy…'}
          leading={<Spinner size={12} />}
        />
      ) : (
        <InlineOperationStatus
          tone="alert"
          message={mutation.error!}
          action={mutation.retryable
            ? { label: 'Retry exact edit', icon: <RotateCcw size={12} />, onClick: retryDelegationPolicy }
            : { label: 'Dismiss', icon: <X size={12} />, onClick: discardDelegationPolicy }}
          secondaryAction={mutation.retryable
            ? { label: 'Dismiss', icon: <X size={12} />, onClick: discardDelegationPolicy }
            : undefined}
        />
      )}
    </div>
  )
}
