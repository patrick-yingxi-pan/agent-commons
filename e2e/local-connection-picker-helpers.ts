import { expect, type Locator } from '@playwright/test'

/** Verify the native connection identity stays a full-width row above its
 * independently wrapping actions, even for a deliberately long name. */
export async function assertLocalConnectionPickerRow(row: Locator, width: number) {
  await expect(row).toBeVisible()
  await row.scrollIntoViewIfNeeded()
  const identity = row.locator('[data-local-connection-picker-identity]')
  const actions = row.locator('[data-local-connection-picker-actions]')
  const name = row.locator('[data-local-connection-picker-name]')
  const status = row.locator('[data-local-connection-picker-status]')
  await expect(identity).toBeVisible()
  await expect(actions).toBeVisible()
  await expect(name).toBeVisible()
  await expect(status).toBeVisible()
  const geometry = await row.evaluate(element => {
    const rect = (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector)
      if (!target) return null
      const bounds = target.getBoundingClientRect()
      return {
        x: bounds.x, y: bounds.y, right: bounds.right, bottom: bounds.bottom,
        width: bounds.width, height: bounds.height,
        clientWidth: target.clientWidth, scrollWidth: target.scrollWidth,
        clientHeight: target.clientHeight, scrollHeight: target.scrollHeight,
        lineHeight: (() => {
          const style = getComputedStyle(target)
          const lineHeight = Number.parseFloat(style.lineHeight)
          return Number.isFinite(lineHeight) ? lineHeight : Number.parseFloat(style.fontSize) * 1.5
        })(),
      }
    }
    const bounds = element.getBoundingClientRect()
    const buttons = [...element.querySelectorAll<HTMLElement>('[data-local-connection-picker-actions] button')]
      .map(button => {
        const box = button.getBoundingClientRect()
        return { x: box.x, right: box.right, y: box.y, bottom: box.bottom, width: box.width, height: box.height }
      })
    return {
      row: { x: bounds.x, right: bounds.right, y: bounds.y, bottom: bounds.bottom, width: bounds.width, height: bounds.height },
      identity: rect('[data-local-connection-picker-identity]'),
      name: rect('[data-local-connection-picker-name]'),
      status: rect('[data-local-connection-picker-status]'),
      actions: rect('[data-local-connection-picker-actions]'),
      buttons,
      viewportWidth: window.innerWidth,
    }
  })
  expect(geometry.identity, 'the connection identity stamp is present').not.toBeNull()
  expect(geometry.name, 'the long connection name stamp is present').not.toBeNull()
  expect(geometry.status, 'the connection status stamp is present').not.toBeNull()
  expect(geometry.actions, 'the connection actions stamp is present').not.toBeNull()
  const { row: rowBox, identity: identityBox, name: nameBox, status: statusBox, actions: actionsBox, buttons } = geometry
  expect(rowBox.width, `connection row has usable width at ${width}px`).toBeGreaterThan(0)
  expect(rowBox.x).toBeGreaterThanOrEqual(-1)
  expect(rowBox.right).toBeLessThanOrEqual(geometry.viewportWidth + 1)
  expect(identityBox!.x).toBeGreaterThanOrEqual(rowBox.x - 1)
  expect(identityBox!.right).toBeLessThanOrEqual(rowBox.right + 1)
  expect(identityBox!.width, 'identity owns the full row width instead of being squeezed beside actions')
    .toBeGreaterThanOrEqual(rowBox.width * 0.97)
  expect(nameBox!.width, 'the potentially long name gets the full identity line and may wrap')
    .toBeGreaterThanOrEqual(identityBox!.width * 0.97)
  expect(nameBox!.y).toBeLessThanOrEqual(statusBox!.y + 1)
  expect(nameBox!.bottom, 'the connection name and remembered/until-close status do not overlap')
    .toBeLessThanOrEqual(statusBox!.y + 1)
  expect(statusBox!.width, 'status copy retains a readable full-line width instead of sharing a narrow flex column')
    .toBeGreaterThanOrEqual(identityBox!.width * 0.9)
  expect(statusBox!.scrollWidth, 'status copy is not clipped horizontally').toBeLessThanOrEqual(statusBox!.clientWidth + 1)
  expect(statusBox!.scrollHeight, 'status copy is not clipped vertically').toBeLessThanOrEqual(statusBox!.clientHeight + 1)
  expect(actionsBox!.scrollWidth, 'wrapping actions fit their full-width action row').toBeLessThanOrEqual(actionsBox!.clientWidth + 1)
  if (width === 320 || width === 1280) {
    expect(statusBox!.height, `connection status remains one readable line at ${width}px`)
      .toBeLessThanOrEqual(statusBox!.lineHeight + 1)
  }
  expect(actionsBox!.y, 'wrapping actions start after the full-width identity')
    .toBeGreaterThanOrEqual(identityBox!.bottom - 1)
  expect(buttons.length).toBeGreaterThan(0)
  for (const button of buttons) {
    expect(button.width).toBeGreaterThan(0)
    expect(button.height).toBeGreaterThan(0)
    expect(button.x).toBeGreaterThanOrEqual(-1)
    expect(button.right, `connection action remains reachable at ${width}px`)
      .toBeLessThanOrEqual(geometry.viewportWidth + 1)
    expect(button.x).toBeGreaterThanOrEqual(actionsBox!.x - 1)
    expect(button.right).toBeLessThanOrEqual(actionsBox!.right + 1)
    expect(button.y).toBeGreaterThanOrEqual(actionsBox!.y - 1)
    expect(button.bottom).toBeLessThanOrEqual(actionsBox!.bottom + 1)
  }
}
