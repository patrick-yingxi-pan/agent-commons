import { test, expect, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { ms } from './budget.ts'

function sse(res: import('node:http').ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function fixture() {
  const seen: string[] = []
  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'folder-input-model', display_name: 'Folder fixture' }] }))
      return
    }
    if (req.method !== 'POST' || req.url !== '/v1/messages') return res.writeHead(404).end()
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { stream?: boolean; messages?: Array<{ role: string; content: unknown }> }
    const latest = [...(body.messages ?? [])].reverse().find((item) => item.role === 'user')?.content
    const text = typeof latest === 'string' ? latest : JSON.stringify(latest ?? '')
    seen.push(text)
    const marker = text.lastIndexOf('\n\n{"attached_files":')
    const document = marker >= 0 ? JSON.parse(text.slice(marker + 2)) as { attached_files?: Array<{ status: string; text?: string }> } : undefined
    const supplied = document?.attached_files?.find((item) => item.status === 'ready')?.text
    const reply = supplied ? `Folder supplied: ${supplied}` : 'No supplied attachment text.'
    const id = `folder_fixture_${Date.now().toString(36)}`
    if (body.stream !== true) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id, type: 'message', role: 'assistant', model: 'folder-input-model',
        content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 } }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' })
    sse(res, 'message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'folder-input-model', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })
    sse(res, 'content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    sse(res, 'content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
    sse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 })
    sse(res, 'message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } })
    sse(res, 'message_stop', { type: 'message_stop' })
    res.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  return { server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`, seen }
}

test('folder snapshots survive reload, reach the model, and detach by opaque folder identity', async ({ page }) => {
  test.setTimeout(ms(90_000))
  await page.setViewportSize({ width: 1280, height: 800 })
  const api = await fixture()
  const nonce = `FOLDER_INPUT_${Date.now().toString(36)}`
  try {
    await page.addInitScript(({ marker }) => {
      let n = 0
      Object.defineProperty(window, 'agentCommonsDesktop', {
        configurable: false,
        value: { context: {
          pickFiles: async () => ({ status: 'cancelled' }),
          pickFolder: async () => {
            n += 1
            return { status: 'selected', folder: { name: 'shared', files: [
              { name: 'same.md', sizeBytes: marker.length, snapshot: { text: `${marker}-${n}` } },
              { name: 'photo.png', sizeBytes: 10, snapshot: { omitted: 'unsupported' } },
            ] } }
          },
        } },
      })
    }, { marker: nonce })
    const provider = await page.request.post('/api/v1/providers', { data: { label: `Folder fixture ${Date.now().toString(36)}`, modelFamily: 'claude', effortLevels: ['Default'], config: { baseURL: api.url, model: 'folder-input-model' } } })
    expect(provider.ok()).toBeTruthy()
    const providerRow = await provider.json()
    const created = await page.request.post('/api/v1/sessions', { data: { providerId: providerRow.id } })
    expect(created.ok()).toBeTruthy()
    const session = await created.json()
    await page.goto(`/s/${encodeURIComponent(session.id)}`)

    async function chooseFolder() {
      await page.getByRole('button', { name: 'Add context' }).click()
      const picker = page.getByRole('dialog', { name: 'Add context' })
      await picker.getByRole('button', { name: /^Folder/ }).click()
      await picker.getByRole('button', { name: 'This computer', exact: true }).click()
      await picker.getByRole('button', { name: /Choose a folder from this computer/ }).click()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Add context' })).toHaveCount(0)
    }
    await chooseFolder()
    await chooseFolder()
    await expect(page.locator('[data-attachment-input-disclosure]')).toContainText(/2 text files/i)
    const workspaceChip = page.getByRole('button', { name: 'Workspace · 2', exact: true })
    await expect(workspaceChip).toBeVisible()
    const panel = page.locator('main')
    const sameFiles = panel.getByRole('button', { name: /^same\.md / })
    await expect(sameFiles).toHaveCount(2)
    await sameFiles.first().click()
    await expect(panel).toContainText(`${nonce}-1`)
    await sameFiles.last().click()
    await expect(panel).toContainText(`${nonce}-2`)

    const composer = page.getByPlaceholder('Reply to Claude…')
    await composer.fill('Summarize the selected folders.')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: `${nonce}-1` })).toBeVisible({ timeout: ms(20_000) })
    expect(api.seen.some((text) => text.includes(`${nonce}-1`) && text.includes(`${nonce}-2`))).toBe(true)

    await page.reload()
    await expect(workspaceChip).toBeVisible()
    await expect(sameFiles).toHaveCount(2)
    await expect(page.getByText('Workspace', { exact: true }).last()).toBeVisible()
    const remove = page.getByRole('button', { name: 'Remove shared/ from the workspace', exact: true }).first()
    await expect(remove).toBeVisible()
    await remove.click()
    await page.getByText('Remove this folder from the workspace?', { exact: true }).locator('..').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(page.getByText(`${nonce}-1`, { exact: true })).toHaveCount(0)
    await composer.fill('What folder text remains?')
    await composer.press('Enter')
    await expect(page.locator('[data-turn]').filter({ hasText: `${nonce}-2` })).toBeVisible({ timeout: ms(20_000) })
    expect(api.seen.at(-1)).toContain(`${nonce}-2`)
    expect(api.seen.at(-1)).not.toContain(`${nonce}-1`)
  } finally {
    await new Promise<void>((resolve) => api.server.close(() => resolve()))
  }
})

test('folder snapshot body and omission previews stay contained at every canonical viewport', async ({ page }) => {
  test.setTimeout(ms(90_000))
  const longName = `${'unbroken-folder-name-'.repeat(8)}notes.md`
  const longBody = `${'A very long unbroken line from a folder snapshot. '.repeat(120)}END`
  await page.addInitScript(({ fileName, body }) => {
    Object.defineProperty(window, 'agentCommonsDesktop', {
      configurable: false,
      value: { context: {
        pickFiles: async () => ({ status: 'cancelled' }),
        pickFolder: async () => ({ status: 'selected', folder: { name: 'review', files: [
          { name: fileName, sizeBytes: body.length, snapshot: { text: body } },
          { name: 'empty.md', sizeBytes: 0, snapshot: { text: '' } },
          { name: 'photo.png', sizeBytes: 100, snapshot: { omitted: 'unsupported' } },
          { name: 'report.pdf', sizeBytes: 100, snapshot: { omitted: 'unsupported' } },
        ] } }),
      } },
    })
  }, { fileName: longName, body: longBody })
  const created = await page.request.post('/api/v1/sessions', { data: { firstMessage: `folder review ${Date.now().toString(36)}` } })
  expect(created.ok()).toBeTruthy()
  const session = await created.json()
  await page.goto(`/s/${encodeURIComponent(session.id)}`)
  await page.getByRole('button', { name: 'Add context' }).click()
  const picker = page.getByRole('dialog', { name: 'Add context' })
  await picker.getByRole('button', { name: /^Folder/ }).click()
  await picker.getByRole('button', { name: 'This computer', exact: true }).click()
  await picker.getByRole('button', { name: /Choose a folder from this computer/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Add context' })).toHaveCount(0)

  const main = page.locator('main')
  const bodyRow = main.getByRole('button', { name: new RegExp(`^${longName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `) })
  const emptyRow = main.getByRole('button', { name: /^empty\.md / })
  const omittedRow = main.getByRole('button', { name: /^photo\.png / })
  await expect(bodyRow).toHaveCount(1)
  await expect(emptyRow).toHaveCount(1)
  await expect(omittedRow).toHaveCount(1)
  await emptyRow.click()
  const emptyPreview = main.locator('[data-folder-snapshot-preview]')
  await expect(emptyPreview).toContainText('(Empty file)')
  await expect(emptyPreview).toContainText('currently attached text')

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport)
    await bodyRow.click()
    const bodyPreview = main.locator('[data-folder-snapshot-preview]')
    await expect(bodyPreview).toContainText('END')
    await expect(bodyPreview).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect.poll(() => bodyPreview.evaluate((el) => {
      const box = el.getBoundingClientRect()
      // The preview body is intentionally scrollable for long snapshots; the
      // invariant is horizontal containment, not forcing the whole file into
      // the viewport.
      return box.left >= 0 && box.right <= innerWidth + 1 && box.top >= 0
    })).toBe(true)
    await expect.poll(() => bodyPreview.locator('pre').evaluate((el) => {
      const box = el.getBoundingClientRect()
      const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 12
      return box.top + line <= innerHeight + 1
    })).toBe(true)
    await page.screenshot({ path: `.data/folder-review/${viewport.width}x${viewport.height}-body.png` })

    await omittedRow.click()
    const omittedPreview = main.locator('[data-folder-snapshot-preview]')
    await expect(omittedPreview).toContainText('Preview unavailable')
    await expect.poll(() => omittedPreview.evaluate((el) => {
      const box = el.getBoundingClientRect()
      return box.left >= 0 && box.right <= innerWidth + 1
    })).toBe(true)
    await expect.poll(() => omittedPreview.locator('p').last().evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight + 1)).toBe(true)
    await page.screenshot({ path: `.data/folder-review/${viewport.width}x${viewport.height}-omitted.png` })
  }
})
