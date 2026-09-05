import test from 'node:test'
import assert from 'node:assert/strict'
import { createRecoverableSecretMutationController } from './recoverableSecretMutationCore.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('response loss recovers the exact secret and settles as applied', async () => {
  const accepted: string[] = []
  const statuses: Array<{ busy: boolean; error: string | null }> = []
  const controller = createRecoverableSecretMutationController<string, string>({
    resourceId: (input) => input,
    mutate: async () => { throw new Error('lost response') },
    recover: async (_input, key) => `recovered:${key}`,
    cancel: async () => {},
    accept: (_input, secret) => { accepted.push(secret) },
    describeFailure: () => ({ message: 'uncertain', retryable: true }),
    describeRecoveryAbsence: () => ({ message: 'not created', retryable: true }),
    describeCancelFailure: () => ({ message: 'cancel uncertain', retryable: true }),
    setStatus: (status) => { statuses.push(status) },
    mintIdempotencyKey: () => 'stable-key',
  })

  assert.equal(await controller.enqueue('account-a'), 'applied')
  assert.deepEqual(accepted, ['recovered:stable-key'])
  assert.equal(statuses.at(-1)?.busy, false)
  assert.equal(statuses.at(-1)?.error, null)
})

test('Retry keeps one key, while Cancel must be acknowledged before releasing uncertainty', async () => {
  const keys: string[] = []
  let attempts = 0
  let allowCancel = false
  const statuses: Array<{ busy: boolean; error: string | null }> = []
  const controller = createRecoverableSecretMutationController<string, string>({
    resourceId: (input) => input,
    mutate: async (_input, key) => {
      keys.push(key)
      attempts += 1
      throw new Error('offline')
    },
    recover: async () => null,
    cancel: async () => {
      if (!allowCancel) throw new Error('still offline')
    },
    accept: () => {},
    describeFailure: () => ({ message: 'uncertain', retryable: true }),
    describeRecoveryAbsence: () => ({ message: 'not created', retryable: true }),
    describeCancelFailure: () => ({ message: 'cancel uncertain', retryable: true }),
    setStatus: (status) => { statuses.push(status) },
    mintIdempotencyKey: () => 'one-key',
  })

  const outcome = controller.enqueue('account-a')
  await tick()
  assert.equal(statuses.at(-1)?.error, 'uncertain')
  controller.retry()
  await tick()
  assert.equal(attempts, 2)
  assert.deepEqual(keys, ['one-key', 'one-key'])

  controller.cancel()
  await tick()
  assert.equal(statuses.at(-1)?.error, 'cancel uncertain', 'failed cancellation keeps the request held')
  allowCancel = true
  controller.cancel()
  assert.equal(await outcome, 'discarded')
  assert.equal(statuses.at(-1)?.error, null)
})

test('clearAll fences a late recovered secret from a previous account', async () => {
  let release!: (value: string | null) => void
  const accepted: string[] = []
  const controller = createRecoverableSecretMutationController<string, string>({
    resourceId: (input) => input,
    mutate: async () => { throw new Error('lost') },
    recover: () => new Promise((resolve) => { release = resolve }),
    cancel: async () => {},
    accept: (_input, secret) => { accepted.push(secret) },
    describeFailure: () => ({ message: 'uncertain', retryable: true }),
    describeRecoveryAbsence: () => ({ message: 'not created', retryable: true }),
    describeCancelFailure: () => ({ message: 'cancel uncertain', retryable: true }),
    setStatus: () => {},
    mintIdempotencyKey: () => 'old-account-key',
  })

  const outcome = controller.enqueue('old-account')
  await tick()
  controller.clearAll()
  assert.equal(await outcome, 'discarded')
  release('late-secret')
  await tick()
  assert.deepEqual(accepted, [])
})

test('restart resume reads before writing and an absent receipt waits for same-key Retry', async () => {
  const calls: string[] = []
  const accepted: string[] = []
  const statuses: Array<{ error: string | null }> = []
  const controller = createRecoverableSecretMutationController<string, string>({
    resourceId: (input) => input,
    mutate: async (_input, key) => {
      calls.push(`mutate:${key}`)
      return `minted:${key}`
    },
    recover: async (_input, key) => {
      calls.push(`recover:${key}`)
      return null
    },
    cancel: async () => {},
    accept: (_input, secret) => { accepted.push(secret) },
    describeFailure: () => ({ message: 'uncertain', retryable: true }),
    describeRecoveryAbsence: () => ({ message: 'not created', retryable: true }),
    describeCancelFailure: () => ({ message: 'cancel uncertain', retryable: true }),
    setStatus: (status) => { statuses.push(status) },
    mintIdempotencyKey: () => 'retained-key',
  })

  const outcome = controller.resume('account-a')
  await tick()
  assert.deepEqual(calls, ['recover:retained-key'])
  assert.equal(statuses.at(-1)?.error, 'not created')
  controller.retry()
  assert.equal(await outcome, 'applied')
  assert.deepEqual(calls, ['recover:retained-key', 'mutate:retained-key'])
  assert.deepEqual(accepted, ['minted:retained-key'])
})
