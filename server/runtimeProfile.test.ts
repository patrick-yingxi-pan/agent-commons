import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveRuntimeProfile } from './runtimeProfile.ts'

const generated = 'generated-desktop-secret-32-chars'

test('desktop is a loopback-only, native, ungated SQLite profile with a pinned origin', () => {
  const input = {}
  const resolved = resolveRuntimeProfile('desktop', input, () => generated)
  assert.deepEqual(resolved, {
    DEPLOYMENT_PROFILE: 'desktop',
    PORT: '8787',
    HOST: '127.0.0.1',
    BACKEND: 'mock',
    AUTH_GATE: 'off',
    IDENTITY_HEADERS: 'deny',
    AUTH_SECRET: generated,
    AUTH_COOKIE_SECURE: 'off',
    PERSIST_BACKEND: 'sqlite',
    CORS_ORIGIN: 'http://127.0.0.1:8787',
  })
  assert.deepEqual(input, {}, 'profile resolution never mutates the caller environment')
})

test('desktop derives its default origin from PORT and permits a future shell origin override', () => {
  assert.equal(resolveRuntimeProfile('desktop', { PORT: '9123' }, () => generated).CORS_ORIGIN, 'http://127.0.0.1:9123')
  assert.equal(
    resolveRuntimeProfile('desktop', { CORS_ORIGIN: 'tauri://localhost', AUTH_SECRET: 'kept' }, () => generated).CORS_ORIGIN,
    'tauri://localhost',
  )
  assert.equal(resolveRuntimeProfile('desktop', { AUTH_SECRET: 'kept' }, () => generated).AUTH_SECRET, 'kept')
})

test('desktop refuses a wildcard origin and invalid ports', () => {
  assert.throws(() => resolveRuntimeProfile('desktop', { CORS_ORIGIN: '*' }, () => generated), /wildcard access is refused/)
  assert.throws(
    () => resolveRuntimeProfile('desktop', { CORS_ORIGIN: 'http://127.0.0.1:8787/path' }, () => generated),
    /must be an exact origin/,
  )
  assert.throws(() => resolveRuntimeProfile('desktop', { PORT: '0' }, () => generated), /PORT must be an integer/)
  assert.throws(() => resolveRuntimeProfile('desktop', { PORT: 'nope' }, () => generated), /PORT must be an integer/)
})

test('web fails closed without a strong secret, exact origin, and HTTPS', () => {
  assert.throws(() => resolveRuntimeProfile('web', {}, () => generated), /requires AUTH_SECRET/)
  assert.throws(
    () => resolveRuntimeProfile('web', { AUTH_SECRET: 'x'.repeat(32), CORS_ORIGIN: '*' }, () => generated),
    /wildcard access is refused/,
  )
  assert.throws(
    () => resolveRuntimeProfile('web', { AUTH_SECRET: 'x'.repeat(32), CORS_ORIGIN: 'http://app.example' }, () => generated),
    /requires an https:\/\/ CORS_ORIGIN/,
  )
  assert.throws(
    () =>
      resolveRuntimeProfile(
        'web',
        { AUTH_SECRET: 'x'.repeat(32), CORS_ORIGIN: 'https://app.example', PERSIST_BACKEND: 'postgres' },
        () => generated,
      ),
    /supports PERSIST_BACKEND=json or sqlite/,
  )
})

test('web is auth-gated, remote-capability, Secure-cookie, and SQLite by default', () => {
  const resolved = resolveRuntimeProfile(
    'web',
    { AUTH_SECRET: 'a-production-secret-that-is-long-enough', CORS_ORIGIN: 'https://app.example', PORT: '9000' },
    () => generated,
  )
  assert.equal(resolved.DEPLOYMENT_PROFILE, 'web')
  assert.equal(resolved.HOST, '0.0.0.0')
  assert.equal(resolved.PORT, '9000')
  assert.equal(resolved.BACKEND, 'remote')
  assert.equal(resolved.AUTH_GATE, 'require')
  assert.equal(resolved.IDENTITY_HEADERS, 'deny')
  assert.equal(resolved.AUTH_COOKIE_SECURE, 'on')
  assert.equal(resolved.PERSIST_BACKEND, 'sqlite')
  assert.equal(resolved.CORS_ORIGIN, 'https://app.example')
})

test('the release commands enter through the profile launcher before server evaluation', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.scripts.start, 'node scripts/start.mjs desktop')
  assert.equal(pkg.scripts['start:desktop'], pkg.scripts.start)
  assert.equal(pkg.scripts['start:web'], 'node scripts/start.mjs web')

  const launcher = readFileSync(new URL('../scripts/start.mjs', import.meta.url), 'utf8')
  const applyAt = launcher.indexOf('process.env[key] = value')
  const importAt = launcher.indexOf("await import('../server/index.ts')")
  assert.ok(applyAt >= 0, 'the resolved profile is applied to process.env')
  assert.ok(importAt > applyAt, 'the server is dynamically imported only after the profile is applied')
})
