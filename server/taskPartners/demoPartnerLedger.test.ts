import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DemoPartnerLedger } from './demoPartnerLedger.ts'

test('fictional voucher holds, recipient transfers and returns survive retries, restart and changed per-handoff subjects', () => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-partner-ledger-'))
  const path = join(dir, 'vouchers.db')
  const partner = 'demo-custodian', holdUntil = '2099-01-01T00:00:00Z'
  const asset = (quantity: string) => ({ assetId: 'review-voucher', unit: 'voucher', quantity })
  let ledger = new DemoPartnerLedger(path)
  const reserve = (command: string, quantity: string, ending = '19') => {
    const grant = { kind: 'reserve' as const, asset: asset(quantity), holdUntil }
    ledger.bindAccount(partner, command + '-grant', command + '-subject', ending, grant)
    return ledger.settle(partner, command, { ...grant, payerRef: command + '-subject', grantRef: command + '-grant' })
  }
  try {
    const held = reserve('first', '90')
    assert.equal(held.kind, 'reserve')
    assert.deepEqual(reserve('first', '90'), held)
    assert.equal(reserve('overspend', '11').kind, 'failed')
    ledger.close()
    ledger = new DemoPartnerLedger(path)
    const delivery = { kind: 'release' as const, asset: asset('90'), reservationId: 'demo-first',
      beneficiaryRef: 'recipient-subject', submissionId: 'accepted', grantRef: 'recipient-grant' }
    ledger.bindAccount(partner, delivery.grantRef, delivery.beneficiaryRef, '42', { kind: 'receive', asset: delivery.asset })
    assert.equal(ledger.settle(partner, 'wrong-recipient', { ...delivery, beneficiaryRef: 'different' }).kind, 'failed')
    assert.equal(ledger.settle(partner, 'wrong-amount', { ...delivery, asset: asset('1') }).kind, 'failed')
    const paid = ledger.settle(partner, 'pay', delivery)
    assert.equal(paid.kind, 'release')
    assert.deepEqual(ledger.settle(partner, 'pay', delivery), paid)
    assert.equal(ledger.settle(partner, 'pay-again', delivery).kind, 'failed')
    assert.equal(reserve('received', '190', '42').kind, 'reserve')
    assert.equal(reserve('another', '1', '42').kind, 'failed')
    const refund = { kind: 'return' as const, asset: asset('190'), reservationId: 'demo-received', payerRef: 'received-subject' }
    assert.equal(ledger.settle(partner, 'wrong-payer', { ...refund, payerRef: 'someone-else' }).kind, 'failed')
    const returned = ledger.settle(partner, 'refund', refund)
    assert.equal(returned.kind, 'return')
    assert.deepEqual(ledger.settle(partner, 'refund', refund), returned)
    assert.equal(reserve('returned', '190', '42').kind, 'reserve')
    assert.equal(reserve('never-minted', '1', '42').kind, 'failed')
  } finally {
    ledger.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
