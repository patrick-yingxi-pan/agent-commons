import { useEffect, useState, type ComponentType } from 'react'
import type { DelegationPolicyEditorProps } from './DelegationPolicyEditor.tsx'
import { prepareDelegationPolicyRuntime } from '../controller/delegationPolicyMutations.ts'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'

export function DeferredDelegationPolicyEditor(props: DelegationPolicyEditorProps) {
  const [Editor, setEditor] = useState<ComponentType<DelegationPolicyEditorProps> | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setEditor(null)
    setFailure(null)
    void Promise.all([
      import('./DelegationPolicyEditor.tsx'),
      prepareDelegationPolicyRuntime(),
    ]).then(([module]) => {
      if (active) setEditor(() => module.DelegationPolicyEditor)
    }).catch(() => {
      if (active) setFailure('Couldn’t load the policy editor. Opening it does not send changes; already-submitted edits remain in recovery.')
    })
    return () => { active = false }
  }, [])

  if (failure) {
    return (
      <div data-delegation-policy-load="error" className="mt-2.5 rounded-md border border-line p-2">
        <InlineOperationStatus
          tone="alert"
          message={`${failure} Reloading clears unsent drafts and in-memory recovery. Copy your draft and check saved versions afterward.`}
          action={{ label: 'Reload app', onClick: () => window.location.reload() }}
          secondaryAction={{ label: 'Close', onClick: props.onCancel }}
        />
      </div>
    )
  }
  if (!Editor) {
    return <div data-delegation-policy-load="loading" className="mt-2.5"><InlineOperationStatus tone="status" message="Loading policy editor and recovery controls…" /></div>
  }
  return <Editor {...props} />
}
