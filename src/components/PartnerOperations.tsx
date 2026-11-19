import { useState } from 'react'
import {
  usePartnerBalance,
  usePartnerObligations,
  usePartnerRecovery,
  refreshPartnerRegistry,
} from '../api/hooks'
import { grantPartnerCredits, reconcilePartner } from '../api/commands'
import { usePartnerAction } from '../controller/usePartnerAction'
import { SECONDARY_BUTTON_CLASS, PAGE_ACTION_BUTTON_CLASS } from '../lib/button'
import { PartnerField, PartnerGroup, PartnerNotice, PartnerSelect, PartnerQueryStatus } from './PartnerFields'
import { PartnerPagination } from './PartnerFields'
import type { PartnerObligation } from '../api/taskPartners'

export function PartnerCredits({ canIssue }: { canIssue: boolean }) {
  const balance = usePartnerBalance()
  const action = usePartnerAction()
  return (
    <PartnerGroup title="Work credits">
      <PartnerQueryStatus query={balance} retry={refreshPartnerRegistry} />
      {balance.data && (
        <p className="text-[13px]">
          Available · <strong>{balance.data.available}</strong> credits. Reserved · {balance.data.held} credits.
        </p>
      )}
      {canIssue && (
        <details>
          <summary>Issue site work credits</summary>
          <p className="my-2 text-[13px]">
            Credit an account with site-issued work credits. Use a unique reference for each issuance.
          </p>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault()
              const form = e.currentTarget
              const d = new FormData(form)
              const body = {
                userId: String(d.get('userId')).trim(),
                tenantId: String(d.get('tenantId')).trim(),
                quantity: String(d.get('quantity')).trim(),
                reference: String(d.get('reference')).trim(),
                reason: String(d.get('reason')).trim(),
              }
              void action.run(
                body,
                (k) => grantPartnerCredits(body, k),
                () => {
                  form.reset()
                  action.setNotice('Work credits issued.')
                },
              )
            }}
          >
            <PartnerField label="Recipient user ID" name="userId" required />
            <PartnerField label="Recipient tenant ID" name="tenantId" required />
            <PartnerField
              label="Quantity of work credits"
              name="quantity"
              pattern="[1-9][0-9]{0,37}"
              inputMode="numeric"
              required
            />
            <PartnerField label="Unique issuance reference" name="reference" required />
            <PartnerField label="Reason for issuance" name="reason" required />
            <button disabled={action.pending} className={PAGE_ACTION_BUTTON_CLASS}>
              Issue work credits
            </button>
          </form>
          <PartnerNotice action={action} />
        </details>
      )}
    </PartnerGroup>
  )
}
function RecoveryCase({ item, canOpen }: { item: PartnerObligation; canOpen: boolean }) {
  const read = usePartnerRecovery(item.obligationId, item.latestRecoveryId)
  const recovery = read.data
  const action = usePartnerAction()
  const [mode, setMode] = useState('lookup')
  const [reason, setReason] = useState('')
  const [source, setSource] = useState('')
  const [evidence, setEvidence] = useState('')
  const [digest, setDigest] = useState('')
  const apply = (body: Record<string, unknown>) =>
    void action.run(
      [item.obligationId, body],
      (key) => reconcilePartner(item.obligationId, body, key),
      () => action.setNotice('Recovery updated.'),
    )
  return (
    <details className="border-l border-line pl-3">
      <summary>
        {item.taskId} · {item.state.replaceAll('_', ' ')}
      </summary>
      <p className="break-all text-[13px]">Command · {item.commandId}</p>
      {item.asset && (
        <p>
          {item.asset.quantity} {item.asset.unit}
        </p>
      )}
      {canOpen && !item.latestRecoveryId && (
        <form
          className="my-2 space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            apply({ action: 'open', expectedRevision: item.revision, commandId: item.commandId, mode, reason })
          }}
        >
          <PartnerSelect label="Recovery operation" value={mode} onChange={setMode}>
            <option value="lookup">Look up prior outcome</option>
            <option value="release">Release reserved reward</option>
            <option value="return">Return reserved reward</option>
          </PartnerSelect>
          <PartnerField
            label="Recovery reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={300}
          />
          <button
            className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
            disabled={action.pending}
          >
            Open recovery case
          </button>
        </form>
      )}
      {item.latestRecoveryId && <PartnerQueryStatus query={read} retry={refreshPartnerRegistry} />}
      {recovery && (
        <>
          <p>
            Recovery · {recovery.mode} · {recovery.state.replaceAll('_', ' ')}
          </p>
          <p>{recovery.reason}</p>
          {recovery.availableActions.includes('authorize') && (
            <button
              className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
              disabled={action.pending}
              onClick={() =>
                apply({
                  action: 'authorize',
                  recoveryId: recovery.recoveryId,
                  expectedRevision: recovery.revision,
                })
              }
            >
              Authorize recovery
            </button>
          )}
          {recovery.availableActions.includes('submit_evidence') && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                apply({
                  action: 'submit_evidence',
                  recoveryId: recovery.recoveryId,
                  expectedRevision: recovery.revision,
                  sourceReference: source,
                  externalEvidence: evidence,
                  evidenceDigest: digest,
                })
              }}
            >
              <PartnerField
                label="Independent source reference"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                required
              />
              <PartnerField
                label="Signed recovery evidence (compact JWS)"
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                required
              />
              <PartnerField
                label="SHA-256 of signed evidence"
                value={digest}
                onChange={(e) => setDigest(e.target.value)}
                required
                pattern="[a-f0-9]{64}"
              />
              <button
                disabled={action.pending}
                className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
              >
                Submit evidence
              </button>
            </form>
          )}
          {recovery.availableActions.includes('confirm_evidence') && (
            <>
              <p className="break-all">Evidence digest · {recovery.evidenceDigest}</p>
              <button
                className={`${SECONDARY_BUTTON_CLASS} min-h-8 px-3 py-1 text-[13px]`}
                disabled={action.pending}
                onClick={() =>
                  apply({
                    action: 'confirm_evidence',
                    recoveryId: recovery.recoveryId,
                    expectedRevision: recovery.revision,
                    evidenceDigest: recovery.evidenceDigest,
                  })
                }
              >
                Confirm recorded evidence
              </button>
            </>
          )}
        </>
      )}
      <PartnerNotice action={action} />
    </details>
  )
}
export function PartnerObligations({ partnerId, canOpen }: { partnerId: string; canOpen: boolean }) {
  const [cursors, setCursors] = useState<string[]>([])
  const read = usePartnerObligations(partnerId, cursors.at(-1))
  return (
    <PartnerGroup title="Outstanding obligations">
      <PartnerQueryStatus query={read} retry={refreshPartnerRegistry} />
      {read.data?.items.length === 0 && <p className="text-[13px]">No outstanding obligations.</p>}
      {read.data?.items.map((item) => (
        <RecoveryCase key={item.obligationId} item={item} canOpen={canOpen} />
      ))}
      <PartnerPagination next={read.data?.nextCursor} cursors={cursors} set={setCursors} />
    </PartnerGroup>
  )
}
