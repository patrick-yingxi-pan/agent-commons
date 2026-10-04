import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { loadDesktopUpdateConfiguration } from './updateConfiguration.mjs'

/** Test-only native menu observation. Signed builds retain their real host
 * configuration; this helper never checks a public feed or installs an update. */
export async function smokeDesktopUpdateMenu(electronApp) {
  await expect.poll(() => electronApp.evaluate(({ Menu }) =>
    Menu.getApplicationMenu()?.getMenuItemById('check-for-updates')?.enabled,
  ), { timeout: 10_000 }).toBe(true)
  const posture = await electronApp.evaluate(({ app }) => ({
      packaged: app.isPackaged, development: false, platform: process.platform,
      architecture: process.arch, currentVersion: app.getVersion(), resourcesPath: process.resourcesPath,
  }))
  // Independently read the actual packaged plist from the test process. The
  // app's own loaded configuration is observed through its real menu action.
  const configuration = await loadDesktopUpdateConfiguration(posture)
  const fixture = await electronApp.evaluateHandle(({ app, Menu, dialog }, configured) => {
    // Activation must share the acquired instance authority, not an unbound name.
    app.emit('activate')
    const item = Menu.getApplicationMenu().getMenuItemById('check-for-updates')
    const observations = []
    const original = dialog.showMessageBox
    if (!configured) {
      dialog.showMessageBox = async (_owner, options) => {
        observations.push({ message: options.message, buttons: options.buttons, defaultId: options.defaultId, cancelId: options.cancelId })
        return { response: 0, checkboxChecked: false }
      }
      item.click()
    }
    return { configured, label: item.label, observations,
      restore: () => { dialog.showMessageBox = original } }
  }, Boolean(configuration))
  try {
    assert.equal(await fixture.evaluate(value => value.label), 'Check for Updates…')
    if (!await fixture.evaluate(value => value.configured)) {
      await expect.poll(() => fixture.evaluate(value => value.observations.length)).toBe(1)
      assert.deepEqual(await fixture.evaluate(value => value.observations[0]), {
        message: 'Updates are not configured for this build', buttons: ['OK'], defaultId: 0, cancelId: 0,
      })
      console.log('[desktop-update-smoke] native menu + activation + honest unconfigured-build dialog; no feed or install request')
    } else {
      console.log('[desktop-update-smoke] native menu + activation + bundled update configuration; public check/installation not invoked')
    }
  } finally {
    await fixture.evaluate(value => value.restore())
    await fixture.dispose()
  }
}
