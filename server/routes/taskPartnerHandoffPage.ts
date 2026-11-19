import type { ServerResponse } from 'node:http'
import { partnerCollisionLabel } from '../../contract/taskPartners.ts'
import type { Router } from '../http/router.ts'
import { SECURITY_HEADERS } from '../http/respond.ts'
import { store } from '../store/index.ts'
import { PartnerRegistryError } from '../taskPartners/protocol.ts'
import { partnerActor } from '../taskPartners/transport.ts'

const escape = (value: string) => value.replace(/[&<>"']/g, ch =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!)
const css = 'html{font:100%/1.5 system-ui,sans-serif;color:#192830;background:white}main{max-width:34rem;margin:9vh auto;padding:1.5rem;overflow-wrap:anywhere}h1{line-height:1.2}button,a{font:inherit}button{padding:.45rem .8rem}a:focus-visible,button:focus-visible{outline:3px solid currentColor;outline-offset:3px}'

function html(res: ServerResponse, status: number, heading: string, body: string, destination?: string) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
    'Content-Type': 'text/html; charset=utf-8', 'Cross-Origin-Opener-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action " + (destination ?? "'none'") })
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + heading + ' · Agent Commons</title><style>' + css + '</style><main><p>Agent Commons</p><h1>' + heading + '</h1>' + body + '</main></html>')
}

type HandoffStart = ReturnType<typeof store.partnerWork.startResponse>

/** The source URL is resolved from live organization authority, never a query
 * parameter. The workspace shell keeps its existing self-only form policy. */
export function sendHandoffPage(res: ServerResponse, start: HandoffStart) {
  const destination = new URL(start.startUrl)
  if (destination.protocol !== 'https:' || destination.hostname !== start.handoffDomainAscii ||
      destination.username || destination.password || destination.port || destination.hash) {
    throw new Error('Invalid partner handoff destination')
  }
  const website = '<bdi dir="ltr">' + escape(start.identity.domainAscii) + '</bdi>'
  const host = '<bdi dir="ltr">' + escape(destination.hostname) + '</bdi>'
  const collision = partnerCollisionLabel(start.identity.collisionSignals)
  html(res, 200, 'Continue to your task partner', '<p>Verified organization website · ' + website + '</p>' +
    (collision ? '<p>' + escape(collision) + '. Check the full website address before continuing.</p>' : '') +
    '<p>You will sign in at ' + host + '. After selecting your account, return to the original task in Agent Commons to confirm.</p>' +
    '<form method="post" action="' + escape(destination.href) + '"><input type="hidden" name="handoffId" value="' +
    escape(start.handoffId) + '"><input type="hidden" name="startCode" value="' + escape(start.startCode) +
    '"><button type="submit">Continue to ' + host + '</button></form>', destination.origin)
}

export function registerPartnerHandoffPage(router: Router) {
  router.uiFormGet('/auth/task-partner-handoffs/:handoffId',
    'Browser consent document for an existing authorized handoff. Production MCP clients receive their POST fields from the start operation.',
    ({ req, res, params, url }) => {
      const id = params.handoffId!
      if (url.search || !/^grant-[a-f0-9]{32}$/.test(id)) {
        return html(res, 404, 'Authorization unavailable', '<p>Reopen the original task in Agent Commons.</p>')
      }
      const signIn = '/sign-in/task-partner/' + id
      const who = store.identity(req.headers)
      if (who.via !== 'session') {
        return html(res, 401, 'Sign in to continue', '<p>Use the Agent Commons account that started this task authorization. Signing in returns you to this handoff.</p>' +
          '<p><a href="' + signIn + '">Sign in to Agent Commons</a></p>')
      }
      try {
        const actor = partnerActor(req, who)
        const start = store.partnerWork.startResponse(actor, 'production', { handoffId: id })
        return sendHandoffPage(res, start)
      } catch (error) {
        if (!(error instanceof PartnerRegistryError)) throw error
        return html(res, error.status, 'Authorization unavailable',
          '<p>Check that you are signed in to the account that started this authorization. Reopen the task to check its status or start again.</p>' +
          '<a href="/" target="_blank" rel="noopener noreferrer">Open Agent Commons</a>')
      }
    })
}
