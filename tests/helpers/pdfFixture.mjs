import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'

// Legacy PDF encryption exists here ONLY to exercise password rejection. It is
// intentionally unsuitable for protecting application data and never ships.
const PASSWORD_PADDING = Buffer.from([0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a])
const md5 = (value) => createHash('md5').update(value).digest()
function rc4(key, value) {
  const s = Array.from({ length: 256 }, (_, i) => i); let j = 0
  for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]] }
  const out = Buffer.alloc(value.length); let i = 0; j = 0
  for (let k = 0; k < value.length; k++) { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; out[k] = value[k] ^ s[(s[i] + s[j]) & 255] }
  return out
}
const padPassword = (value) => Buffer.concat([Buffer.from(String(value ?? ''), 'binary'), PASSWORD_PADDING]).subarray(0, 32)
function security(password, ownerPassword, id) {
  const ownerKey = md5(padPassword(ownerPassword ?? password)).subarray(0, 5)
  const ownerEntry = rc4(ownerKey, padPassword(password)); const permissions = Buffer.alloc(4); permissions.writeInt32LE(-4, 0)
  const encryptionKey = md5(Buffer.concat([padPassword(password), ownerEntry, permissions, id])).subarray(0, 5)
  return { ownerEntry, userEntry: rc4(encryptionKey, PASSWORD_PADDING), encryptionKey }
}
function toUnicodeCMap(codes) {
  const entries = [...codes.entries()].map(([code, character]) => `<${code.toString(16).padStart(2, '0').toUpperCase()}> <${Buffer.from(character, 'utf16le').swap16().toString('hex').toUpperCase()}>`)
  const maxCode = codes.size ? Math.max(...codes.keys()) : 32
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n/CMapName /Fixture-ToUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<20> <${maxCode.toString(16).padStart(2, '0').toUpperCase()}>\nendcodespacerange\n${entries.length} beginbfchar\n${entries.join('\n')}\nendbfchar\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`
}

/**
 * Build a deterministic PDF. Set unicode:true for ToUnicode extraction, and
 * password (optionally ownerPassword) for a genuine Standard R2 protected PDF.
 */
export function pdfFixture({ pages = ['Folder fixture page 1', 'Folder fixture page 2'], compress = false, unicode = false, password = null, ownerPassword = null } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) throw new TypeError('pages must be a non-empty array')
  const escape = (value) => String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
  // Keep codes in the printable range: Type1 readers may discard control-byte
  // codes before consulting ToUnicode.
  const codes = new Map(); let nextCode = 32
  const encode = (text) => Buffer.from([...String(text)].map((character) => { for (const [code, value] of codes) if (value === character) return code; if (nextCode > 255) throw new RangeError('unicode fixture supports at most 224 distinct characters'); codes.set(nextCode, character); return nextCode++ }))
  const content = (text) => {
    if (text == null) return Buffer.alloc(0)
    // Preserve the original byte-for-byte one-line fixture. Multiline text is
    // laid out as separate, in-bounds runs so PDF.js extracts every line.
    if (!String(text).includes('\n') && !unicode) return Buffer.from(`BT\n/F1 16 Tf\n72 720 Td\n(${escape(text)}) Tj\nET\n`, 'ascii')
    const lines = String(text).split('\n')
    const chunks = [Buffer.from('BT\n/F1 16 Tf\n72 720 Td\n', 'ascii')]
    lines.forEach((line, index) => {
      if (unicode) chunks.push(Buffer.from(`<${encode(line).toString('hex').toUpperCase()}> Tj\n`, 'ascii'))
      else chunks.push(Buffer.from(`(${escape(line)}) Tj\n`, 'ascii'))
      if (index < lines.length - 1) chunks.push(Buffer.from('0 -18 Td\n', 'ascii'))
    })
    chunks.push(Buffer.from('ET\n', 'ascii'))
    return Buffer.concat(chunks)
  }
  const rebuilt = []
  const addRebuilt = (body, stream = null) => { rebuilt.push({ body: Buffer.isBuffer(body) ? body : Buffer.from(body, 'binary'), stream }); return rebuilt.length }
  const fontId = addRebuilt(unicode ? '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode TO_UNICODE >>' : '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const rebuiltPages = []
  for (const text of pages) {
    const raw = content(text)
    const stream = compress ? deflateSync(raw) : raw
    const filter = compress ? ' /Filter /FlateDecode' : ''
    const contentId = addRebuilt(`<< /Length ${stream.length}${filter} >>\nstream\n`, stream)
    rebuiltPages.push({ contentId, text })
  }
  if (unicode) { const cmap = Buffer.from(toUnicodeCMap(codes), 'ascii'); const cmapId = addRebuilt(`<< /Length ${cmap.length} >>\nstream\n`, cmap); rebuilt[fontId - 1].body = Buffer.from(rebuilt[fontId - 1].body.toString('binary').replace('TO_UNICODE', `${cmapId} 0 R`), 'binary') }
  const pagesId = addRebuilt('')
  const pageIds2 = rebuiltPages.map(({ contentId }) => addRebuilt(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`))
  rebuilt[pagesId - 1].body = Buffer.from(`<< /Type /Pages /Kids [${pageIds2.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds2.length} >>`, 'ascii')
  const catalogId = addRebuilt(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)
  const id = md5('agent-commons-pdf-fixture'); let encryption = null; let encryptId = null
  if (password != null) { encryption = security(password, ownerPassword, id); encryptId = addRebuilt(`<< /Filter /Standard /V 1 /R 2 /O <${encryption.ownerEntry.toString('hex').toUpperCase()}> /U <${encryption.userEntry.toString('hex').toUpperCase()}> /P -4 >>`) }

  const header = Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'binary')
  const chunks = [header]
  const offsets = [0]
  let offset = header.length
  rebuilt.forEach((entry, index) => {
    let body = entry.body
    if (entry.stream && encryption) {
      const objectIdentity = Buffer.alloc(5)
      objectIdentity.writeUIntLE(index + 1, 0, 3)
      const key = md5(Buffer.concat([encryption.encryptionKey, objectIdentity])).subarray(0, 10)
      body = Buffer.concat([body, rc4(key, entry.stream)])
    }
    else if (entry.stream) body = Buffer.concat([body, entry.stream])
    const object = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`, 'ascii'), body, entry.stream ? Buffer.from('\nendstream\nendobj\n', 'ascii') : Buffer.from('\nendobj\n', 'ascii')])
    offsets.push(offset)
    chunks.push(object)
    offset += object.length
  })
  const xrefOffset = offset
  let xref = `xref\n0 ${rebuilt.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= rebuilt.length; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${rebuilt.length + 1} /Root ${catalogId} 0 R${encryptId ? ` /Encrypt ${encryptId} 0 R` : ''} /ID [<${id.toString('hex').toUpperCase()}> <${id.toString('hex').toUpperCase()}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  chunks.push(Buffer.from(xref, 'ascii'))
  return Buffer.concat(chunks)
}
