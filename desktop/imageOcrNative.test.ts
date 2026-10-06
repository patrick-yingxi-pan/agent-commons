import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { buildImageOcrHelper } from './ocrHelperBuild.mjs'
import { imageOcrFixture } from './imageOcrFixture.mjs'
import { createImageOcrRunner } from './imageOcr.mjs'

const temporaryDirectories: string[] = []
after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true })
})

function fixtureDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'agent-commons-image-ocr-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function invoke(helper: string, input: Buffer, args: string[] = []) {
  const result = spawnSync(helper, args, { input, encoding: 'utf8', timeout: 30_000, maxBuffer: 128 * 1024 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /^\{[^\r\n]*\}\n$/)
  return JSON.parse(result.stdout) as { status: string; text?: string }
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function insertChunk(png: Buffer, type: string, content: Buffer) {
  const chunk = Buffer.alloc(content.length + 12)
  chunk.writeUInt32BE(content.length, 0)
  chunk.write(type, 4, 4, 'ascii')
  content.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + content.length)), 8 + content.length)
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)])
}

test('native OCR accepts generated text PNGs and returns only complete bounded recognition', {
  skip: process.platform !== 'darwin',
}, async () => {
  const directory = fixtureDirectory()
  const helper = buildImageOcrHelper({ targetArch: process.arch === 'x64' ? 'x64' : 'arm64', outputPath: join(directory, 'agent-commons-image-ocr') })
  assert.equal(helper, join(directory, 'agent-commons-image-ocr'))

  const textPng = await imageOcrFixture({ text: 'Cobalt garden 427' })
  const recognized = invoke(helper, textPng)
  assert.equal(recognized.status, 'ready')
  assert.match(recognized.text ?? '', /Cobalt\s+garden\s+427/i)
  assert.ok(Buffer.byteLength(recognized.text ?? '', 'utf8') <= 64 * 1024)
  assert.deepEqual(Object.keys(recognized).sort(), ['status', 'text'])
  const runner = createImageOcrRunner({ executable: helper, targetPlatform: 'darwin' })
  assert.deepEqual(await runner.recognize(textPng), { status: 'ready', text: recognized.text })
  runner.dispose()

  assert.deepEqual(invoke(helper, await imageOcrFixture({ width: 800, height: 240 })), { status: 'no-text' })
  const smallestImage = invoke(helper, await imageOcrFixture({ width: 1, height: 1 }))
  assert.ok(['no-text', 'unavailable'].includes(smallestImage.status), 'valid minimum dimensions are admitted before Vision decides whether it can process them')
  assert.deepEqual(invoke(helper, await imageOcrFixture({ text: '   ' })), { status: 'no-text' })
  assert.deepEqual(invoke(helper, Buffer.from('not a png')), { status: 'invalid' })
  assert.deepEqual(invoke(helper, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])), { status: 'invalid' })
  const validPng = await imageOcrFixture()
  assert.deepEqual(invoke(helper, validPng.subarray(0, validPng.length - 5)), { status: 'invalid' })
  assert.deepEqual(invoke(helper, Buffer.concat([validPng, Buffer.from([0])])), { status: 'invalid' })
  assert.deepEqual(invoke(helper, insertChunk(validPng, 'iCCP', Buffer.from([0x66, 0x61, 0x6b, 0x65, 0, 0, 0x78, 0x9c]))), { status: 'invalid' })
  assert.deepEqual(invoke(helper, insertChunk(validPng, 'acTL', Buffer.alloc(8))), { status: 'invalid' })
  assert.deepEqual(invoke(helper, await imageOcrFixture({ width: 2001, height: 1 })), { status: 'invalid' })
  assert.deepEqual(invoke(helper, Buffer.alloc(3 * 1024 * 1024 + 1)), { status: 'too-large' })
  assert.deepEqual(invoke(helper, Buffer.alloc(0), ['--help']), { status: 'invalid' })
})
