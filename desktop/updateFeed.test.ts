import { test } from 'node:test'
import assert from 'node:assert/strict'
import { releaseUpdateFeedJson, validateUpdateBaseUrl } from './updateFeed.mjs'

const validBaseUrl = 'https://updates.example/releases/'
const validVersion = '1.2.3'
const validArtifact = {
  architecture: 'arm64' as const,
  archiveName: 'Agent-Commons-1.2.3-macos-arm64.zip',
  bytes: 1234,
  sha256: 'a'.repeat(64),
}

test('update base URL accepts only a canonical public HTTPS directory URL', () => {
  assert.equal(validateUpdateBaseUrl(validBaseUrl), validBaseUrl)

  for (const value of [
    undefined,
    null,
    '',
    'http://updates.example/releases/',
    'https://updates.example/releases',
    'https://localhost/releases/',
    'https://updates.local/releases/',
    'https://updates.example.local/releases/',
    'https://updates.example.localhost/releases/',
    'https://updates/releases/',
    'https://127.0.0.1/releases/',
    'https://192.0.2.1/releases/',
    'https://[::1]/releases/',
    'https://user:pass@updates.example/releases/',
    'https://updates.example:443/releases/',
    'https://updates.example/releases/?channel=stable',
    'https://updates.example/releases/#latest',
    'https://updates.example/releases/%2e%2e/private/',
    'https://updates.example/releases/../private/',
    'https://updates.example/releases\\private/',
    ' https://updates.example/releases/',
    'https://UPDATES.example/releases/',
  ]) {
    assert.throws(() => validateUpdateBaseUrl(value), `expected rejection for ${String(value)}`)
  }
})

test('release feed emits deterministic Squirrel static JSON with exact artifact metadata', () => {
  const json = releaseUpdateFeedJson({ baseUrl: validBaseUrl, version: validVersion, artifact: validArtifact })
  assert.equal(json.endsWith('\n'), true)
  assert.deepEqual(JSON.parse(json), {
    currentRelease: validVersion,
    releases: [{
      version: validVersion,
      updateTo: {
        version: validVersion,
        url: `${validBaseUrl}${validArtifact.archiveName}`,
        name: validVersion,
        sha256: validArtifact.sha256,
        size: validArtifact.bytes,
      },
    }],
  })
  assert.equal(releaseUpdateFeedJson({ baseUrl: validBaseUrl, version: validVersion, artifact: validArtifact }), json)
})

test('release feed rejects malformed versions, paths, architectures, hashes, sizes, and artifact shapes', () => {
  const invalidVersions = [
    '', '1', '1.2', '1.2.3.4', '01.2.3', '1.02.3', '1.2.03',
    '1.2.3-beta.1', '1.2.3+build.1', '-1.2.3', '1.-2.3', '1.2.-3',
    '9007199254740992.0.0', '1.9007199254740992.0', '1.2.9007199254740992',
  ]
  for (const version of invalidVersions) {
    assert.throws(() => releaseUpdateFeedJson({ baseUrl: validBaseUrl, version, artifact: validArtifact }), version)
  }

  const invalidArtifacts = [
    { ...validArtifact, architecture: 'x86' },
    { ...validArtifact, archiveName: '../Agent-Commons-1.2.3-macos-arm64.zip' },
    { ...validArtifact, archiveName: 'Agent-Commons-1.2.3-macos-x64.zip' },
    { ...validArtifact, archiveName: 'Agent-Commons-1.2.3-macos-arm64.zip/' },
    { ...validArtifact, bytes: 0 },
    { ...validArtifact, bytes: -1 },
    { ...validArtifact, bytes: 1.5 },
    { ...validArtifact, bytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...validArtifact, sha256: 'A'.repeat(64) },
    { ...validArtifact, sha256: 'a'.repeat(63) },
    { ...validArtifact, sha256: `${'a'.repeat(63)}g` },
    { ...validArtifact, unexpected: true },
    { architecture: 'arm64', archiveName: validArtifact.archiveName, bytes: 1234 },
  ]
  for (const artifact of invalidArtifacts) {
    assert.throws(() => releaseUpdateFeedJson({ baseUrl: validBaseUrl, version: validVersion, artifact }), 'expected malformed artifact rejection')
  }

  for (const baseUrl of ['https://updates.example/releases', 'https://updates.example/releases/%2e%2e/']) {
    assert.throws(() => releaseUpdateFeedJson({ baseUrl, version: validVersion, artifact: validArtifact }), baseUrl)
  }
})

test('feed output is detached from later input mutation and supports both release architectures', () => {
  const artifact = { ...validArtifact }
  const first = releaseUpdateFeedJson({ baseUrl: validBaseUrl, version: validVersion, artifact })
  artifact.archiveName = 'changed.zip'
  artifact.sha256 = 'b'.repeat(64)
  artifact.bytes = 4321
  assert.deepEqual(JSON.parse(first).releases[0].updateTo, {
    version: validVersion,
    url: `${validBaseUrl}${validArtifact.archiveName}`,
    name: validVersion,
    sha256: validArtifact.sha256,
    size: validArtifact.bytes,
  })

  const x64 = releaseUpdateFeedJson({
    baseUrl: validBaseUrl,
    version: '0.0.1',
    artifact: {
      architecture: 'x64',
      archiveName: 'Agent-Commons-0.0.1-macos-x64.zip',
      bytes: 1,
      sha256: '0'.repeat(64),
    },
  })
  assert.equal(JSON.parse(x64).releases[0].updateTo.url, `${validBaseUrl}Agent-Commons-0.0.1-macos-x64.zip`)
})
