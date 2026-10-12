import { expect, test } from '@playwright/test'
import { proxyMcpApi, startMcpRouterStack } from './mcp-fixture.ts'

test('the isolated MCP API proxy leaves aborted browser reads single-settled', async ({ page }) => {
  let releaseHeld!: () => void
  let markEntered!: () => void
  let markFinished!: () => void
  const heldResponse = new Promise<void>(resolve => { releaseHeld = resolve })
  const entered = new Promise<void>(resolve => { markEntered = resolve })
  const finished = new Promise<void>(resolve => { markFinished = resolve })
  let heldReads = 0
  const stack = await startMcpRouterStack({
    beforeHandle: async (request, url) => {
      if (request.method !== 'GET' || url.pathname !== '/me' || url.searchParams.get('fixture_hold') !== '1') return
      heldReads += 1
      markEntered()
      try { await heldResponse } finally { markFinished() }
    },
  })
  let disposeProxy: (() => Promise<void>) | undefined
  try {
    await page.goto('/')
    disposeProxy = await proxyMcpApi(page, stack)
    await page.evaluate(() => {
      const scope = window as typeof window & {
        __mcpFixtureAbort?: AbortController
        __mcpFixturePending?: Promise<{ status?: number; userId?: string; error?: string }>
      }
      const controller = new AbortController()
      scope.__mcpFixtureAbort = controller
      scope.__mcpFixturePending = fetch('/api/v1/me?fixture_hold=1', { signal: controller.signal })
        .then(async response => {
          const body = await response.json() as { user?: { id?: string } }
          return { status: response.status, userId: body.user?.id }
        })
        .catch(error => ({ error: error instanceof Error ? error.name : String(error) }))
    })
    await entered
    await page.evaluate(() => {
      const scope = window as typeof window & { __mcpFixtureAbort?: AbortController }
      scope.__mcpFixtureAbort?.abort()
    })
    const aborted = await page.evaluate(async () => {
      const scope = window as typeof window & {
        __mcpFixturePending?: Promise<{ status?: number; userId?: string; error?: string }>
      }
      return scope.__mcpFixturePending
    })
    expect(aborted).toEqual({ error: 'AbortError' })

    releaseHeld()
    await finished
    expect(heldReads).toBe(1, 'the canceled request reaches the isolated router exactly once')

    const ordinaryRead = await page.evaluate(async () => {
      const response = await fetch('/api/v1/me')
      const body = await response.json() as { user?: { id?: string } }
      return { status: response.status, userId: body.user?.id }
    })
    expect(ordinaryRead.status).toBe(200)
    expect(ordinaryRead.userId).toBeTruthy()
  } finally {
    releaseHeld()
    await disposeProxy?.()
    await stack.close()
  }
})
