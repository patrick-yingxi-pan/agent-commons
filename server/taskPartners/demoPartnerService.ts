import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PartnerIdentity } from '../../contract/taskPartners.ts'
import type { DemoPartnerWorker } from '../data/taskPartnerDemo.ts'
import { demoPartnerConfiguration, demoPartnerWebsite } from './demoConfiguration.ts'
import { DemoPartnerLedger } from './demoPartnerLedger.ts'
import { DemoWorkerClient, type DemoGrantOffer } from './demoPartnerWorker.ts'

interface DemoServiceOptions {
  workers: readonly DemoPartnerWorker[]; platformApiOrigin: string; ledgerPath?: string
  badgeUrl: (worker: DemoPartnerWorker) => string; profileUrl: (worker: DemoPartnerWorker) => string
}
type Start = { startUrl: string; identity: PartnerIdentity; handoffDomainAscii: string }
type Pending = { host: string; offer: DemoGrantOffer; chosen?: '19' | '42' }
const escape = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]!)
const css = 'html{font:1rem/1.55 system-ui;color:#192830;background:#fff}main{max-width:38rem;margin:6vh auto;padding:1.5rem;overflow-wrap:anywhere}button,a{font:inherit}button{padding:.45rem .8rem;margin:.35rem .5rem .35rem 0}bdi{font-family:monospace}iframe{max-width:100%}'
async function form(req: IncomingMessage) {
  if (req.headers['content-type']?.toString().split(';')[0] !== 'application/x-www-form-urlencoded') throw Error('Unexpected form encoding.')
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    req.on('data', part => {
      size += (part as Uint8Array).byteLength
      if (size > 4096) reject(Error('Form too large.'))
      else chunks.push(part as Uint8Array)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
    req.on('close', () => { if (!req.complete) reject(Error('Incomplete form.')) })
  })
  const values = new URLSearchParams(bytes.toString('utf8'))
  if ([...values.keys()].length !== 2) throw Error('Unexpected form fields.')
  return values
}
function describe(offer: DemoGrantOffer) {
  const { grant } = offer
  if (grant.kind === 'run') return 'Run the fictional model ' + grant.model + (grant.effort ? ' at ' + grant.effort + ' effort' : '') + '. The demo returns the text “ready”.'
  if (grant.kind === 'reserve') return 'Reserve ' + grant.asset.quantity + ' demo vouchers until ' + grant.holdUntil + '. Each fictional account starts with 100 vouchers.'
  return 'Receive ' + grant.asset.quantity + ' demo vouchers in the selected account.'
}
function page(res: ServerResponse, status: number, title: string, content: string, badgeOrigin?: string) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" + (badgeOrigin ? '; frame-src ' + badgeOrigin : '') })
  res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escape(title) + '</title><style>' + css + '</style></head><body><main><p>Agent Commons demonstration partner</p><h1>' + escape(title) + '</h1>' + content + '</main></body></html>')
}

export function createDemoPartnerService(options: DemoServiceOptions) {
  if (demoPartnerConfiguration()?.backendOrigin !== options.platformApiOrigin) throw Error('Demo partner execution requires the local demonstration profile.')
  const { workers, platformApiOrigin } = options
  const ledger = new DemoPartnerLedger(options.ledgerPath)
  const hosts = new Map(workers.map(worker => {
    const origin = new URL(demoPartnerWebsite(worker.domain, platformApiOrigin)!)
    return [origin.host, { worker, origin: origin.origin, client: new DemoWorkerClient(worker, platformApiOrigin, ledger) }] as const
  }))
  const pending = new Map<string, Pending>()
  let timer: ReturnType<typeof setInterval> | undefined
  let running: Promise<void> | undefined
  let closed = false
  const failures = new Set<string>()
  async function poll() {
    if (closed || running) return
    running = Promise.all([...hosts.values()].map(async ({ worker, client }) => {
      try { await client.poll(); failures.delete(worker.partnerId) }
      catch {
        if (!closed && !failures.has(worker.partnerId)) console.warn('[demo partners] Local worker waiting to retry: ' + worker.displayName)
        failures.add(worker.partnerId)
      }
    })).then(() => undefined)
    try { await running } finally { running = undefined }
  }
  return {
    start() { if (!timer && !closed) { timer = setInterval(() => { void poll() }, 1200); timer.unref?.() } },
    async close() { if (closed) return; closed = true; clearInterval(timer); await running; pending.clear(); ledger.close() },
    continuation(start: Start): string | null {
      for (const { worker, origin } of hosts.values()) {
        if (start.identity.profilePath === '/partners/' + worker.partnerId && start.identity.domainAscii === worker.domain &&
          start.handoffDomainAscii === 'auth.' + worker.domain && start.startUrl === 'https://auth.' + worker.domain + '/confirm') return origin + '/confirm'
      }
      return null
    },
    async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
      const own = typeof req.headers.host === 'string' ? hosts.get(req.headers.host.toLowerCase()) : undefined
      if (!own) return false
      const { worker, client, origin } = own
      const host = new URL(origin).host
      try {
        if (req.method === 'GET' && url.pathname === '/' && !url.search) {
          const badge = options.badgeUrl(worker), profile = options.profileUrl(worker)
          page(res, 200, worker.displayName, '<p>Fictional website for <bdi dir="ltr">' + escape(worker.domain) + '</bdi>.</p>' +
            '<iframe title="Agent Commons partner badge" width="290" height="150" src="' + escape(badge) + '"></iframe><p><a href="' + escape(profile) +
            '" rel="noopener noreferrer">View partner on Agent Commons</a></p>', new URL(badge).origin)
          return true
        }
        if (req.method !== 'POST' || url.search || !['/confirm','/select'].includes(url.pathname)) {
          page(res, 404, 'Demo page unavailable', '<p>Open a current authorization from your task.</p>')
          return true
        }
        for (const [token, p] of pending) if (Date.parse(p.offer.expiresAt) <= Date.now()) pending.delete(token)
        const values = await form(req)
        if (url.pathname === '/confirm') {
          const source = req.headers.origin
          if (source && source !== 'null' && !(typeof source === 'string' && /^http:\/\/127\.0\.0\.1(?::[0-9]+)?$/.test(source))) throw Error('Unexpected initiating website.')
          const handoffId = values.get('handoffId') ?? '', code = values.get('startCode') ?? ''
          if (!/^grant-[a-f0-9]{32}$/.test(handoffId) || !/^code-[A-Za-z0-9_-]{43}$/.test(code)) throw Error('Invalid authorization.')
          if (pending.size >= 512) { page(res, 429, 'Try again shortly', '<p>The demo partner is handling other authorizations.</p>'); return true }
          const offer = await client.exchange(handoffId, code)
          const ticket = randomBytes(32).toString('base64url')
          pending.set(ticket, { host, offer })
          page(res, 200, 'Choose a demo account', '<p>' + escape(worker.displayName) + ' · <bdi dir="ltr">' + escape(worker.domain) + '</bdi></p><p>' +
            escape(offer.workSummary) + '</p><p>' + escape(describe(offer)) + '</p><form action="/select" method="post"><input type="hidden" name="ticket" value="' +
            ticket + '"><button name="account" value="19">Use demo account ending in 19</button><button name="account" value="42">Use demo account ending in 42</button></form>')
        } else {
          const ticket = values.get('ticket') ?? '', ending = values.get('account')
          const item = pending.get(ticket)
          if (req.headers.origin !== origin || !item || item.host !== host || (ending !== '19' && ending !== '42') ||
              (item.chosen && item.chosen !== ending)) throw Error('Invalid selection.')
          item.chosen = ending
          await client.select(item.offer, ending)
          pending.delete(ticket)
          page(res, 200, 'Demo account selected', '<p>Return to your task in Agent Commons to confirm the account ending in ' + ending + '.</p>')
        }
      } catch {
        page(res, 409, 'Authorization unavailable', '<p>Reopen your original task to check the current authorization or start again.</p>')
      }
      return true
    },
  }
}
