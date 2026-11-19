/** Browser conformance of the proposed public badge. The HTTP examples supply the
 * actual markup and headers; all origins are intercepted fixtures. Chromium
 * decides which frames load, including when the direct parent is authorized but
 * a higher ancestor is not. This test does not require a deployed partner API. */
import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

const spec = JSON.parse(readFileSync(new URL('../docs/design/task-partner-api.openapi.json', import.meta.url), 'utf8'))

test('the sample badge renders only under its verified site and opens the canonical partner page', async ({ context, page }) => {
  const badge = spec['x-partner-badge-examples'].find(example => example.active)
  expect(badge, 'an active issuance example is required').toBeTruthy()
  const issuedTo = spec.components.schemas.PublicPartnerProfile.examples.find(profile =>
    profile.partnerId === badge.partnerId && profile.asOf === badge.profileAsOf)
  expect(issuedTo, 'badge must identify a published partner').toBeTruthy()
  const website = 'https://' + badge.domainAscii + '/'
  const other = 'https://independent-atelier.example/'
  expect(new URL(website).origin).not.toBe(new URL(other).origin)
  const nested = new URL('nested', other).href
  const frameRequests: string[] = []
  const denied: string[] = []
  page.on('console', message => {
    if (message.type() === 'error' && message.text().includes('frame-ancestors')) denied.push(message.text())
  })
  await context.route('**/*', async route => {
    const url = route.request().url()
    if (url === badge.frameUrl) {
      frameRequests.push(url)
      return route.fulfill({ headers: badge.headers, contentType: 'text/html', body: badge.body })
    }
    if (url === website || url === other) return route.fulfill({ contentType: 'text/html', body: badge.snippet })
    if (url === nested) return route.fulfill({ contentType: 'text/html', body: `<iframe src="${website}"></iframe>` })
    if (url === badge.profileUrl) return route.fulfill({ contentType: 'text/html', body: '<h1>Partner profile fixture</h1>' })
    return route.abort()
  })

  await page.goto(website)
  const verified = page.frameLocator('iframe').getByRole('link')
  await expect(verified).toBeVisible()
  await expect(verified).toContainText(issuedTo.displayName)
  await expect(verified).toContainText(issuedTo.identity.domainAscii)
  await expect(verified).toHaveAttribute('href', badge.profileUrl)
  // A parent-page fallback remains usable without the embedded frame.
  await expect(page.getByRole('link')).toHaveAttribute('href', badge.profileUrl)
  const opened = page.waitForEvent('popup')
  await verified.click()
  const profile = await opened
  await expect(profile).toHaveURL(badge.profileUrl)
  await expect(profile.getByRole('heading')).toHaveText('Partner profile fixture')
  expect(await profile.evaluate(() => ({ opener: window.opener !== null, referrer: document.referrer })))
    .toEqual({ opener: false, referrer: '' })
  await profile.close()
  expect(frameRequests).toHaveLength(1)
  expect(denied).toHaveLength(0)

  for (const [index, host] of [other, nested].entries()) {
    await page.goto(host)
    await expect.poll(() => frameRequests.length).toBe(index + 2)
    await expect.poll(() => denied.length).toBe(index + 1)
    const parent = host === nested ? page.frameLocator('iframe') : page
    await expect(parent.frameLocator('iframe').getByRole('link')).toHaveCount(0)
  }
})
