// Temporary build-tool mitigation for GHSA-fc5q-39xc-vjpf. Every reviewed
// parser and its fast path normalize their input at this exact statement.
// Reject repeated extglob openers before either path can compile a pattern.
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const anchor = 'input = REPLACEMENTS[input] || input;'
const guarded = `if (input.includes('+(') || input.includes('*(')) throw new SyntaxError('Repeated extglobs are disabled in this build toolchain'); ${anchor}`

// [package-relative file, expected number of parser entries, pristine SHA-256]
// The digests refer to the published JS, including copies bundled by Rollup
// and Playwright. Changes to these packages need a fresh inventory review.
const packages = {
  vite: { version: '6.4.6', files: [] },
  tinyglobby: { version: '0.2.17', files: [] },
  fdir: { version: '6.5.0', files: [] },
  '@playwright/test': { version: '1.61.1', files: [] },
  picomatch: { version: '4.0.4', files: [
    ['lib/parse.js', 2, 'ce57c04e04994b83e2ca566170fa192e6fe19d710bea6da00ce2f76d01c0dea4'],
  ] },
  rollup: { version: '4.62.0', files: [
    ['dist/es/shared/node-entry.js', 2, 'ff87480287712c570ac947e7e450ac1e737ea81b8ceb86430fbc5c24ccc23698'],
    ['dist/es/shared/watch.js', 4, 'd37d24655f1944939656efdd43eb987a7fc68b7e8e64f15da8f965e5b9b641de'],
    ['dist/shared/index.js', 4, '97964e88ccbffbca630f21315545c525bc367c938e11d620ecaa3a59566b16cf'],
    ['dist/shared/rollup.js', 2, '9eb8be0aa6bb8c9100cabc60ad84aec7de35213406fe8955f379a0ef5e513292'],
  ] },
  playwright: { version: '1.61.1', files: [
    ['lib/matchers/expect.js', 2, '78fb9c8cb3214b6ff753e8444034f60ad740e5f16225bac879bb7bca3055fb62'],
  ] },
  'playwright-core': { version: '1.61.1', files: [
    ['lib/serverRegistry.js', 4, '85f63dbf8dc73fa651dcf046a732d78a86dbda401084b1d144d5a1ef1a59730d'],
    ['lib/utilsBundle.js', 4, '1295945f0054d2504c9b751945b15aa3c672530ad5a340f3f9636e5e238f304a'],
  ] },
}

function localFile(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || relative(path, realpathSync(path)) !== '') throw new Error(`Expected a regular, local package file: ${path}`)
  return stat
}

function replacement(path, mode, source) {
  // Replace the directory entry, even for hard-linked cache files. Never edit
  // package bytes in place. Keep staging files in the destination directory.
  localFile(path)
  const temporary = join(dirname(path), `.matcher-${randomUUID()}.tmp`)
  const fd = openSync(temporary, 'wx', mode)
  try {
    try { writeFileSync(fd, source) } finally { closeSync(fd) }
    renameSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}

function harden(root, checkOnly, allowProductionOmission) {
  const modules = join(root, 'node_modules')
  const names = Object.keys(packages)
  const omitDev = (process.env.npm_config_omit || '').split(/\s+/).includes('dev') || process.env.NODE_ENV === 'production'
  if (allowProductionOmission && omitDev && names.every(name => !lstatSync(join(modules, name), { throwIfNoEntry: false }))) return

  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'))
  const pending = []
  for (const [name, { version, files }] of Object.entries(packages)) {
    const location = `node_modules/${name}`
    const installedLocations = Object.keys(lock.packages).filter(key => key === location || key.endsWith(`/${location}`))
    if (installedLocations.length !== 1 || lock.packages[location]?.version !== version) throw new Error(`Review matcher guard for changed dependency: ${name}`)
    const manifest = join(modules, name, 'package.json')
    localFile(manifest)
    const metadata = JSON.parse(readFileSync(manifest, 'utf8'))
    if (metadata.name !== name || metadata.version !== version) throw new Error(`Expected installed ${name}@${version}`)
    if (['vite', 'tinyglobby', 'fdir'].includes(name)) {
      const matcher = createRequire(manifest).resolve('picomatch/package.json')
      if (relative(join(modules, 'picomatch/package.json'), matcher) !== '') throw new Error(`Unexpected picomatch resolution from ${name}`)
    }
    for (const [file, count, sha256] of files) {
      const path = join(modules, name, file)
      const stat = localFile(path)
      const source = readFileSync(path, 'utf8')
      const pristine = source.replaceAll(guarded, anchor)
      if (createHash('sha256').update(pristine).digest('hex') !== sha256 || pristine.split(anchor).length !== count + 1) {
        throw new Error(`Review matcher source before hardening: ${name}/${file}`)
      }
      const protectedSource = pristine.replaceAll(anchor, guarded)
      if (source === protectedSource) continue
      if (source !== pristine || checkOnly) throw new Error(`Matcher guard missing or incomplete: ${name}/${file}`)
      pending.push({ path, mode: stat.mode, source: protectedSource })
    }
  }
  // Inspect every target before touching any file. An interrupted multi-file
  // install can be safely resumed; --check refuses an incomplete install.
  for (const { path, mode, source } of pending) replacement(path, mode, source)
}

/** Verify the actual installation before using development tooling, including
 * when a prior npm install explicitly skipped lifecycle scripts. */
export function checkBuildMatchers(root) {
  if (!isAbsolute(root)) throw new Error('Expected an absolute project installation path')
  harden(realpathSync(root), true, false)
}

export function checkProjectBuildMatchers(configURL, tool) {
  if (!['vite', 'playwright', '@playwright/test'].includes(tool)) throw new Error('Unknown build tool')
  const manifest = createRequire(configURL).resolve(`${tool}/package.json`)
  checkBuildMatchers(resolve(dirname(manifest), tool.startsWith('@') ? '../../..' : '../..'))
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  if (args.length && !(args.length === 1 && args[0] === '--check')) throw new Error('Usage: node scripts/hardenBuildMatchers.mjs [--check]')
  harden(realpathSync(fileURLToPath(new URL('../', import.meta.url))), args[0] === '--check', true)
}
