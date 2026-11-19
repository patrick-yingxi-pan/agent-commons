import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { domainToASCII, domainToUnicode, fileURLToPath } from 'node:url'
import type { PartnerCollisionSignal, PartnerDomainPurpose } from '../../contract/taskPartners.ts'
import { parseOutboundEndpoint } from '../outboundAddressCore.mjs'
import { fail } from './protocol.ts'

// Snapshots include the private section of the PSL and the UCD NFKC_CF, Bidi,
// and UTS #39 confusable mappings. Nothing depends on a website being reachable
// while checking a partner name or domain.
const suffixes = new Set(readFileSync(fileURLToPath(new URL('data/public-suffix-list.dat', import.meta.url)), 'utf8')
  .split('\n').filter(s => s && !s.startsWith('//')).map(rule => {
    const prefix = rule.startsWith('!') ? '!' : rule.startsWith('*.') ? '*.' : ''
    return prefix + domainToASCII(rule.slice(prefix.length))
  }))
const topLevelDomains = new Set([...suffixes].map(rule => rule.split('.').at(-1)!))
function hasRegistrableDomain(host: string) {
  const labels = host.split('.')
  if (!topLevelDomains.has(labels.at(-1)!) || labels.at(-1) === 'onion') return false
  let size = 1
  for (let i = 0; i < labels.length; i++) {
    const suffix = labels.slice(i).join('.')
    if (suffixes.has('!' + suffix)) return i < labels.length
    if (suffixes.has(suffix)) size = Math.max(size, labels.length - i)
    if (i && suffixes.has('*.' + suffix)) size = Math.max(size, labels.length - i + 1)
  }
  return labels.length > size
}
export function partnerWebsite(value: unknown, purpose: PartnerDomainPurpose): URL {
  const invalid = () => fail(400, 'bad_request', 'Enter a public HTTPS ' + purpose + ' address with a registrable domain.')
  if (typeof value !== 'string' || value.length > 512 || value !== value.trim() || !value.startsWith('https://')) return invalid()
  let site: URL
  try { site = parseOutboundEndpoint(value, 'public') } catch { return invalid() }
  const host = site.hostname
  if (site.port || site.search || host.length > 239 || host.endsWith('.') || isIP(host) ||
      host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
      !hasRegistrableDomain(host)) return invalid()
  return site
}

const caseFold = new Map<number, string>(), skeletonMap = new Map<number, string>()
const bidiClass = new Map<number, string>(), mirrors = new Map<number, string>()
const brackets = new Map<number, { paired: number; open: boolean }>()
const fromHex = (s: string) => Number.parseInt(s, 16)
for (const line of readFileSync(fileURLToPath(new URL('data/unicode17.txt', import.meta.url)), 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue
  const [prop, range, value] = line.split(';')
  const [first, last = first] = range.split('..').map(fromHex)
  if (prop === 'bracket') {
    const [other, side] = value.split(' ')
    brackets.set(first, { paired: fromHex(other), open: side === 'o' })
    continue
  }
  const table = prop === 'cf' ? caseFold : prop === 'skeleton' ? skeletonMap : prop === 'class' ? bidiClass : mirrors
  const mapped = prop === 'class' ? value : value ? String.fromCodePoint(...value.split(' ').map(fromHex)) : ''
  for (let point = first; point <= last; point++) table.set(point, mapped)
}

/** Isolated, single-paragraph LTR UAX #9 after NFKC_CF. Admissions reject
 * directional controls and line separators. Identities contain no explicit
 * embeddings or isolates, leaving one level run with LTR start/end. */
function displayOrder(value: string) {
  const chars = [...value].filter(c => !/\p{Default_Ignorable_Code_Point}/u.test(c))
  const types = chars.map(c => bidiClass.get(c.codePointAt(0)!) ?? 'L')
  if (!types.includes('AL') && !types.includes('R')) return chars
  let strong = 'L'
  const original = [...types]
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'NSM') types[i] = i ? types[i - 1] : 'L'
    if (types[i] === 'EN' && strong === 'AL') types[i] = 'AN'
    if (['L', 'R', 'AL'].includes(types[i])) strong = types[i]
    if (types[i] === 'AL') types[i] = 'R'
  }
  for (let i = 1; i + 1 < types.length; i++) {
    if (types[i - 1] === types[i + 1] &&
        ((types[i] === 'ES' && types[i - 1] === 'EN') ||
         (types[i] === 'CS' && ['EN', 'AN'].includes(types[i - 1])))) types[i] = types[i - 1]
  }
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== 'ET') continue
    const start = i
    while (types[i + 1] === 'ET') i++
    if (types[start - 1] === 'EN' || types[i + 1] === 'EN') types.fill('EN', start, i + 1)
  }
  strong = 'L'
  for (let i = 0; i < types.length; i++) {
    if (['ES', 'ET', 'CS'].includes(types[i])) types[i] = 'ON'
    if (types[i] === 'EN' && strong === 'L') types[i] = 'L'
    if (types[i] === 'L' || types[i] === 'R') strong = types[i]
  }
  // N0 (bracket pair resolution). Process pairs in opening order.
  const pairs: [number, number][] = [], stack: number[] = []
  for (let i = 0; i < chars.length; i++) {
    const br = brackets.get(chars[i].codePointAt(0)!)
    if (!br || types[i] !== 'ON') continue
    if (br.open) { if (stack.length >= 63) break; stack.push(i); continue }
    let at = stack.length - 1
    while (at >= 0 && chars[stack[at]].normalize('NFD') !== String.fromCodePoint(br.paired).normalize('NFD')) at--
    if (at >= 0) { pairs.push([stack[at], i]); stack.length = at }
  }
  const direction = (kind?: string) => kind && ['R', 'AN', 'EN'].includes(kind) ? 'R' : kind === 'L' ? 'L' : undefined
  for (const [open, close] of pairs.sort((a, b) => a[0] - b[0])) {
    const inside = types.slice(open + 1, close).map(direction)
    const prior = types.slice(0, open).reverse().map(direction).find(Boolean) ?? 'L'
    const result = inside.includes('L') ? 'L' : inside.includes('R') ? prior : undefined
    if (result) for (const at of [open, close]) {
      types[at] = result
      for (let i = at + 1; original[i] === 'NSM'; i++) types[i] = result
    }
  }
  for (let i = 0; i < types.length; i++) {
    if (direction(types[i])) continue
    const start = i
    while (i + 1 < types.length && !direction(types[i + 1])) i++
    const before = direction(types[start - 1]) ?? 'L', after = direction(types[i + 1]) ?? 'L'
    types.fill(before === after ? before : 'L', start, i + 1)
  }
  const levels = types.map(t => t === 'L' ? 0 : t === 'R' ? 1 : 2)
  // Preserve base + following combining marks in odd-level runs (L3).
  const runs: { level: number; text: string }[] = []
  for (let i = 0; i < chars.length; i++) {
    const level = levels[i]
    const mapped = level % 2 ? mirrors.get(chars[i].codePointAt(0)!) ?? chars[i] : chars[i]
    if (level % 2 && original[i] === 'NSM' && runs.at(-1)?.level === level) runs[runs.length - 1].text += mapped
    else runs.push({ level, text: mapped })
  }
  for (const level of [2, 1]) for (let i = 0; i < runs.length; i++) {
    if (runs[i].level < level) continue
    const start = i
    while (i + 1 < runs.length && runs[i + 1].level >= level) i++
    const backwards = runs.slice(start, i + 1).reverse()
    runs.splice(start, backwards.length, ...backwards)
  }
  return [...runs.map(r => r.text).join('')]
}
function skeleton(value: string) {
  const ordered = displayOrder(value).join('').normalize('NFD')
  return [...ordered].map(c => skeletonMap.get(c.codePointAt(0)!) ?? c).join('').normalize('NFD')
}
function near(a: string, b: string) {
  const x = [...a], y = [...b], shorter = Math.min(x.length, y.length)
  const limit = shorter >= 12 ? 2 : shorter >= 5 ? 1 : 0
  if (!limit || Math.abs(x.length - y.length) > limit) return false
  let prev2: number[] = [], prev = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const row = new Array<number>(y.length + 1).fill(limit + 1)
    row[0] = i
    for (let j = Math.max(1, i - limit); j <= Math.min(y.length, i + limit); j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + Number(x[i - 1] !== y[j - 1]))
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) row[j] = Math.min(row[j], prev2[j - 2] + 1)
    }
    prev2 = prev
    prev = row
  }
  return prev[y.length] <= limit
}
export function comparisonKeys(name: string, domain: string) {
  const normalized = [...name].map(c => caseFold.get(c.codePointAt(0)!) ?? c).join('').normalize('NFC')
    .replace(/[\p{White_Space}\p{Punctuation}]/gu, '')
  return { name, normalized, skeleton: skeleton(normalized), domain, domainSkeleton: skeleton(domainToUnicode(domain)) }
}
export function collision(left: ReturnType<typeof comparisonKeys>, right: ReturnType<typeof comparisonKeys>) {
  const signals: PartnerCollisionSignal[] = []
  if (left.name === right.name) signals.push('exact_name')
  else if (left.normalized === right.normalized) signals.push('normalized_name')
  else if (left.skeleton === right.skeleton) signals.push('confusable_name')
  else if (near(left.normalized, right.normalized)) signals.push('similar_name')
  if (left.domain !== right.domain && left.domainSkeleton === right.domainSkeleton) signals.push('confusable_domain')
  return signals
}

type Comparison = ReturnType<typeof comparisonKeys>
function lookupTerms(keys: Comparison) {
  const terms = new Set(['n:' + keys.normalized, 's:' + keys.skeleton])
  if (keys.domain) terms.add('d:' + keys.domainSkeleton)
  const chars = [...keys.normalized]
  // A single allowed edit affects at most three adjacent pairs; a permitted
  // two-edit candidate has at least eleven pairs. Every possible near-match
  // therefore shares at least one pair within this bounded length window.
  if (chars.length >= 5) for (let i=1; i<chars.length; i++) terms.add('g:' + chars[i-1] + chars[i])
  return terms
}
export class PartnerNameIndex {
  private keys = new Map<string,Comparison>()
  private terms = new Map<string,Set<string>>()
  private cache = new Map<string,{collisionSignals:PartnerCollisionSignal[]; relatedPartners:string[]}>()
  constructor(entries: {partnerId:string;displayName:string;domain:string}[]) {
    for (const row of entries) {
      const keys=comparisonKeys(row.displayName,row.domain)
      this.keys.set(row.partnerId,keys)
      for (const term of lookupTerms(keys)) {
        const matches=this.terms.get(term)
        if (matches) matches.add(row.partnerId)
        else this.terms.set(term,new Set([row.partnerId]))
      }
    }
  }
  private matches(keys:Comparison,exclude?:string) {
    const seen=new Set<string>(), result=new Map<string,PartnerCollisionSignal[]>()
    for (const term of lookupTerms(keys)) for (const candidate of this.terms.get(term) ?? []) {
      if (candidate === exclude || seen.has(candidate)) continue
      seen.add(candidate)
      const signals=collision(keys,this.keys.get(candidate)!)
      if (signals.length) result.set(candidate,signals)
    }
    return result
  }
  search(name:string) { return new Set(this.matches(comparisonKeys(name,'')).keys()) }
  peers(partnerId:string) {
    let found=this.cache.get(partnerId)
    if (!found) {
      const matches=this.matches(this.keys.get(partnerId)!,partnerId)
      found={collisionSignals:[...new Set([...matches.values()].flat())].sort(),relatedPartners:[...matches.keys()].sort().slice(0,32)}
      this.cache.set(partnerId,found)
    }
    return structuredClone(found)
  }
}
