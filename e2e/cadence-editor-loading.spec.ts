/** The schedule header stays useful while its low-frequency cadence editor is
 * admitted on demand; the stable shell owns geometry while the body swaps. */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import type { ScheduledTask, ScheduleTemplate } from '../contract/index.ts'
import { ms } from './budget.ts'
import { settledNarrowRail, settledOpaquePaint } from './accessibility-helpers.ts'

const VIEWPORTS = [
  { width: 320, height: 700 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 1280, height: 800 },
]

async function createRoutine(page: Page, name: string): Promise<ScheduledTask> {
  const templates = await page.request.get('/api/v1/schedule-templates')
  expect(templates.ok()).toBe(true)
  const [template] = await templates.json() as ScheduleTemplate[]
  const response = await page.request.post('/api/v1/schedules', {
    data: { seed: { ...template!.seed, name, enabled: true, runs: [] } },
  })
  expect(response.ok()).toBe(true)
  return response.json() as Promise<ScheduledTask>
}

async function openScheduleEditor(page: Page, task: ScheduledTask) {
  await page.goto(`/scheduled/${task.id}`)
  await expect(page.getByRole('heading', { name: task.name })).toBeVisible()
  const schedule = page.locator('[data-resource-section="Schedule"]')
  const disclosure = schedule.getByRole('button', { name: /Schedule/ }).first()
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
  await schedule.getByRole('button', { name: 'Edit schedule' }).click()
  return schedule
}

async function expectContained(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('[data-cadence-editor-shell]')
    if (!shell || shell.dataset.popover !== 'true') return false
    const bounds = shell.getBoundingClientRect()
    return bounds.top >= 7 && bounds.left >= 7
      && bounds.bottom <= window.innerHeight - 7
      && bounds.right <= window.innerWidth - 7
  })).toBe(true)
}

async function screenshot(page: Page, testInfo: TestInfo, label: string, viewport: { width: number; height: number }) {
  await settledOpaquePaint(page.locator('[data-cadence-editor-shell]'))
  await page.screenshot({ path: testInfo.outputPath(`${label}-${viewport.width}x${viewport.height}.png`), fullPage: false })
}

test('the stable cadence shell contains loading and loaded bodies at all canonical sizes', async ({ page }, testInfo) => {
  test.setTimeout(ms(90_000))
  const task = await createRoutine(page, `Lazy cadence ${Date.now().toString(36)}`)
  for (const viewport of VIEWPORTS) {
    const probe = await page.context().newPage()
    await probe.setViewportSize(viewport)
    let release!: () => void
    let intercepted = false
    const gate = new Promise<void>((resolve) => { release = resolve })
    await probe.route('**/src/components/CadenceEditor.tsx*', async (route) => {
      intercepted = true
      await gate
      await route.continue()
    })
    try {
      const schedule = await openScheduleEditor(probe, task)
      const loading = probe.locator('[data-cadence-editor-load="loading"]')
      await expect(loading).toBeVisible({ timeout: ms(20_000) })
      await expect(probe.getByRole('dialog', { name: 'Edit schedule' })).toContainText('Loading schedule editor…')
      await expect(loading.getByRole('status')).toBeVisible()
      await expectContained(probe)
      await screenshot(probe, testInfo, 'cadence-loading', viewport)
      expect(intercepted, `held real deferred chunk at ${viewport.width}x${viewport.height}`).toBe(true)

      release()
      const dialog = probe.getByRole('dialog', { name: 'Edit schedule' })
      await expect(dialog).toContainText('Frequency')
      await expect(loading).toHaveCount(0)
      await expectContained(probe)
      await screenshot(probe, testInfo, 'cadence-loaded', viewport)
      await expect(schedule.getByRole('button', { name: 'Edit schedule' })).toBeVisible()
      if (viewport.width === 844 && viewport.height === 390) {
        const dialog = probe.getByRole('dialog', { name: 'Edit schedule' })
        const apply = dialog.getByRole('button', { name: 'Apply', exact: true })
        await apply.scrollIntoViewIfNeeded()
        await expect(apply).toBeVisible()
        const applyGeometry = await apply.evaluate(element => {
          const box = element.getBoundingClientRect()
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
            withinViewport: box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight }
        })
        expect(applyGeometry.withinViewport, 'landscape Apply is scrollable into the viewport').toBe(true)
        await screenshot(probe, testInfo, 'cadence-loaded-footer', viewport)
        await apply.focus()
        await expect(apply).toBeFocused()
        await probe.keyboard.press('Shift+Tab')
        const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
        await expect(cancel).toBeFocused()
        await cancel.click()
        await expect(probe.locator('[data-cadence-editor-shell]')).toHaveCount(0)
        const stored = await (await probe.request.get('/api/v1/schedules')).json() as ScheduledTask[]
        expect(stored.find(candidate => candidate.id === task.id)?.revision).toBe(task.revision,
          'reaching and dismissing the footer without saving preserves cadence')
      }
    } finally {
      release()
      await probe.close()
    }
  }
})

test('a failed cadence chunk stays contained, closes locally, and recovers on real reload without writing', async ({ page }, testInfo) => {
  test.setTimeout(ms(50_000))
  const task = await createRoutine(page, `Failed cadence chunk ${Date.now().toString(36)}`)
  const viewport = { width: 844, height: 390 }
  await page.setViewportSize(viewport)
  let blocked = true
  let intercepted = false
  await page.route('**/src/components/CadenceEditor.tsx*', async (route) => {
    intercepted = true
    if (blocked) await route.abort('failed')
    else await route.continue()
  })
  const schedule = await openScheduleEditor(page, task)
  const failed = page.locator('[data-cadence-editor-load="error"]')
  await expect(failed).toBeVisible({ timeout: ms(20_000) })
  await expect(failed.getByRole('alert')).toBeVisible()
  await expect(failed).toContainText('No change was made')
  await expect(failed).toContainText('Copy any unsent workspace text before reloading')
  await expect(page.getByRole('button', { name: 'Reload app' })).toBeVisible()
  await expectContained(page)
  for (const size of VIEWPORTS) {
    await page.setViewportSize(size)
    await settledNarrowRail(page)
    await expect(failed).toBeVisible()
    await expectContained(page)
    await screenshot(page, testInfo, 'cadence-error', size)
  }
  expect(intercepted).toBe(true)

  await failed.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('[data-cadence-editor-shell]')).toHaveCount(0)
  await expect(schedule.getByRole('button', { name: 'Edit schedule' })).toBeVisible()
  await schedule.getByRole('button', { name: 'Edit schedule' }).click()
  await expect(page.locator('[data-cadence-editor-load="error"]')).toBeVisible()
  blocked = false
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'Reload app' }).click()
  await expect(page.getByRole('heading', { name: task.name })).toBeVisible()
  const reopenedSchedule = page.locator('[data-resource-section="Schedule"]')
  const disclosure = reopenedSchedule.getByRole('button', { name: /Schedule/ }).first()
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click()
  await reopenedSchedule.getByRole('button', { name: 'Edit schedule' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit schedule' })).toContainText('Frequency')
  const stored = await (await page.request.get('/api/v1/schedules')).json() as ScheduledTask[]
  expect(stored.find((candidate) => candidate.id === task.id)?.revision).toBe(task.revision)
})
