import { createServer } from 'node:http'
import { once } from 'node:events'
import { expect, test } from '@playwright/test'
import { servePublicPartner } from '../server/taskPartners/publicHttp.ts'
import type { PartnerPublicProfile } from '../contract/taskPartners.ts'

test('the issued badge checks the entire ancestor chain and opens the live canonical partner profile', async ({ context, page }) => {
  const domain = 'orchard.example.com'
  const website = 'https://' + domain
  const sibling = 'https://support.' + domain
  const untrusted = 'https://outside.example.net'
  const origins = { webOrigin: 'https://commons.example.org', badgeOrigin: 'https://badges.example.org', sandboxOrigin: null }
  const profile: PartnerPublicProfile = {
    partnerId: 'org-orchard', displayName: 'Orchard Works', status: 'active', capabilities: ['custodian'],
    asOf: new Date().toISOString(), identity: { domainAscii: domain, identityRevision: 1,
      profilePath: '/partners/org-orchard', verifiedAt: new Date(Date.now() - 60000).toISOString(),
      validUntil: new Date(Date.now() + 600000).toISOString(), collisionSignals: [], relatedPartners: [] },
  }
  const canonical = origins.webOrigin + profile.identity.profilePath
  const badge = origins.badgeOrigin + '/v1/task-partners/public/partners/org-orchard/badge?domain=' + domain
  const embed = '<iframe title="Partner badge" src="' + badge + '"></iframe>'
  const service = createServer((req, res) => {
    const url = new URL(req.url!, 'https://unused.example')
    if (!servePublicPartner(req, res, url, origins, id => id === profile.partnerId ? profile : null, true)) {
      res.writeHead(404).end()
    }
  })
  service.listen(0, '127.0.0.1')
  try {
    await once(service, 'listening')
    const address = service.address()
    if (!address || typeof address === 'string') throw new Error('Expected a loopback service port')
    const local = 'http://127.0.0.1:' + address.port
    const denied: string[] = []
    page.on('console', line => {
      if (line.type() === 'error' && line.text().includes('frame-ancestors')) denied.push(line.text())
    })
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.origin === origins.webOrigin || url.origin === origins.badgeOrigin) {
        const response = await context.request.get(local + url.pathname + url.search, { headers: { Host: url.host } })
        return route.fulfill({ response })
      }
      if (url.origin === untrusted) return route.fulfill({ contentType: 'text/html', body: '<iframe src="' + website + '"></iframe>' })
      if (url.origin === website || url.origin === sibling) return route.fulfill({ contentType: 'text/html', body: embed })
      return route.abort()
    })
    await page.goto(website)
    const link = page.frameLocator('iframe').getByRole('link')
    await expect(link).toContainText(domain)
    await expect(link).toContainText('Reward custodian')
    const opened = page.waitForEvent('popup')
    await link.click()
    const popup = await opened
    await expect(popup).toHaveURL(canonical)
    await expect(popup.getByRole('heading', { name: profile.displayName })).toBeVisible()
    await expect(popup.getByText(profile.partnerId, { exact: true })).toBeVisible()
    expect(await popup.evaluate(() => [window.opener, document.referrer])).toEqual([null, ''])
    await popup.close()
    for (const [i, origin] of [sibling, untrusted].entries()) {
      await page.goto(origin)
      await expect.poll(() => denied.length).toBe(i + 1)
      const immediate = origin === untrusted ? page.frameLocator('iframe') : page
      await expect(immediate.frameLocator('iframe').getByRole('link')).toHaveCount(0)
    }
    profile.status = 'revoked'
    profile.capabilities = []
    await page.goto(website)
    await expect.poll(() => denied.length).toBe(3)
    await expect(page.frameLocator('iframe').getByRole('link')).toHaveCount(0)
    await page.goto(canonical)
    await expect(page.getByText('Revoked', { exact: true })).toBeVisible()
    await expect(page.getByText('No active approvals', { exact: true })).toBeVisible()
  } finally {
    await new Promise<void>((resolve, reject) => service.close(error => error ? reject(error) : resolve()))
  }
})
