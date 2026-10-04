import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadDesktopUpdateConfiguration } from './updateConfiguration.mjs'

const defaults = {
  packaged: true,
  development: false,
  platform: 'darwin',
  architecture: 'arm64',
  currentVersion: '1.2.3',
  resourcesPath: '/Applications/Agent Commons.app/Contents/Resources',
}

test('configuration is available only to packaged non-development macOS builds on known architectures', async () => {
  for (const architecture of ['arm64', 'x64']) {
    const config = await loadDesktopUpdateConfiguration({ ...defaults, architecture, readBaseUrl: async () => 'https://updates.example/releases/' })
    assert.deepEqual(config, { baseUrl: 'https://updates.example/releases/', architecture, currentVersion: '1.2.3' })
    assert.equal(Object.isFrozen(config), true)
  }

  const forbidden = [
    { ...defaults, packaged: false },
    { ...defaults, development: true },
    { ...defaults, platform: 'linux' },
    { ...defaults, platform: 'win32' },
    { ...defaults, architecture: 'ia32' },
    { ...defaults, architecture: 'universal' },
  ]
  let reads = 0
  for (const input of forbidden) {
    assert.equal(await loadDesktopUpdateConfiguration({ ...input, readBaseUrl: async () => { reads += 1; return 'https://updates.example/releases/' } }), null)
  }
  assert.equal(reads, 0)
})

test('a missing signed-bundle update key disables configuration without another authority', async () => {
  const previous = process.env.AGENT_COMMONS_UPDATE_BASE_URL
  process.env.AGENT_COMMONS_UPDATE_BASE_URL = 'https://environment.example/releases/'
  try {
    const reads: string[] = []
    const result = await loadDesktopUpdateConfiguration({
      ...defaults,
      readBaseUrl: async (path: string) => { reads.push(path); throw new Error('key not found') },
    })
    assert.equal(result, null)
    assert.deepEqual(reads, ['/Applications/Agent Commons.app/Contents/Info.plist'])
  } finally {
    if (previous === undefined) delete process.env.AGENT_COMMONS_UPDATE_BASE_URL
    else process.env.AGENT_COMMONS_UPDATE_BASE_URL = previous
  }
})

test('malformed HTTPS release authority and unstable current versions are refused', async () => {
  for (const baseUrl of [
    'http://updates.example/releases/',
    'https://updates.example/releases',
    'https://user@updates.example/releases/',
    'https://updates.example:443/releases/',
    'https://localhost/releases/',
  ]) {
    await assert.rejects(loadDesktopUpdateConfiguration({ ...defaults, readBaseUrl: async () => baseUrl }), /HTTPS directory URL/)
  }
  for (const currentVersion of ['1.2.3-beta.1', '01.2.3', '1.2']) {
    await assert.rejects(loadDesktopUpdateConfiguration({ ...defaults, currentVersion, readBaseUrl: async () => 'https://updates.example/releases/' }), /stable three-part version/)
  }
})
