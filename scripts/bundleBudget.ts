/** Production JavaScript budgets (PD67).
 *
 * The build is the only trustworthy place to measure minified chunks (PD67): source
 * line counts, gzip estimates, and Vite warnings are useful diagnostics but are
 * not gates. Keep the policy pure for its node lock; `bundleBudgetPlugin` is the
 * thin Rollup adapter that makes an oversized production artifact fail loudly.
 */
import type { Plugin } from 'vite'

/** A physical chunk above Vite's warning line is too coarse for caching and
 * evaluation, even when it is lazy. */
export const CHUNK_BUDGET_BYTES = 500_000
/** Sum of the entry and every static import a cold browser must fetch. This is
 * deliberately separate from the physical chunk cap so vendor splitting cannot
 * masquerade as removing boot bytes. Baseline before PD67: 1,047,560 bytes. */
export const INITIAL_GRAPH_BUDGET_BYTES = 800_000
/** Additional static graph reached by one dynamic import, excluding chunks the
 * cold boot already paid for. */
export const ASYNC_GRAPH_BUDGET_BYTES = 500_000
/** A document parser runs only after explicit file selection, in a separate
 * worker. Count its emitted JavaScript asset too; assets cannot be a loophole
 * around the unchanged UI graph budgets. PDF.js baseline: 1,220,555 bytes. */
/** DOCX adds a bounded ZIP/XML worker beside the existing PDF worker. The
 * measured combined total is 1,309,617 B; 1.4 MB leaves a narrow reviewable
 * margin without changing the physical, initial, or async graph gates. */
export const WORKER_BUDGET_BYTES = 1_400_000

export interface BundleChunkMeasure {
  fileName: string
  isEntry: boolean
  bytes: number
  imports?: string[]
  dynamicImports?: string[]
}

export interface BundleBudgetViolation extends BundleChunkMeasure {
  limit: number
  kind: 'chunk' | 'initial-graph' | 'async-graph' | 'worker'
  reason: string
}

export function workerBudgetViolations(assets: Array<{ fileName: string; bytes: number }>): BundleBudgetViolation[] {
  const scripts = assets.filter((asset) => /\.[cm]?js$/.test(asset.fileName))
  const bytes = scripts.reduce((sum, asset) => sum + asset.bytes, 0)
  return bytes > WORKER_BUDGET_BYTES
    ? [{ fileName: scripts.map((asset) => asset.fileName).join(', '), bytes, isEntry: false, limit: WORKER_BUDGET_BYTES, kind: 'worker', reason: `worker JavaScript assets total ${bytes} bytes; budget is ${WORKER_BUDGET_BYTES}` }]
    : []
}

export function bundleBudgetViolations(chunks: BundleChunkMeasure[]): BundleBudgetViolation[] {
  const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
  const closure = (root: string, excluded = new Set<string>()): Set<string> => {
    const reached = new Set<string>()
    const visit = (name: string) => {
      if (reached.has(name) || excluded.has(name)) return
      const chunk = byName.get(name)
      if (!chunk) return
      reached.add(name)
      for (const imported of chunk.imports ?? []) visit(imported)
    }
    visit(root)
    return reached
  }
  const bytesOf = (names: Set<string>) => [...names].reduce((total, name) => total + (byName.get(name)?.bytes ?? 0), 0)

  const violations: BundleBudgetViolation[] = chunks.flatMap((chunk) =>
    chunk.bytes > CHUNK_BUDGET_BYTES
      ? [{
          ...chunk,
          limit: CHUNK_BUDGET_BYTES,
          kind: 'chunk' as const,
          reason: `chunk is ${chunk.bytes} bytes; budget is ${CHUNK_BUDGET_BYTES}`,
        }]
      : [],
  )

  const initialRoots = chunks.filter((chunk) => chunk.isEntry)
  const initialFiles = new Set<string>()
  for (const entry of initialRoots) {
    const graph = closure(entry.fileName)
    for (const name of graph) initialFiles.add(name)
    const bytes = bytesOf(graph)
    if (bytes > INITIAL_GRAPH_BUDGET_BYTES) {
      violations.push({
        ...entry,
        bytes,
        limit: INITIAL_GRAPH_BUDGET_BYTES,
        kind: 'initial-graph',
        reason: `initial graph is ${bytes} bytes; budget is ${INITIAL_GRAPH_BUDGET_BYTES}`,
      })
    }
  }

  const dynamicRoots = new Set(chunks.flatMap((chunk) => chunk.dynamicImports ?? []))
  for (const root of dynamicRoots) {
    const graph = closure(root, initialFiles)
    const bytes = bytesOf(graph)
    if (bytes > ASYNC_GRAPH_BUDGET_BYTES) {
      const chunk = byName.get(root)
      if (!chunk) continue
      violations.push({
        ...chunk,
        bytes,
        limit: ASYNC_GRAPH_BUDGET_BYTES,
        kind: 'async-graph',
        reason: `async graph is ${bytes} bytes; budget is ${ASYNC_GRAPH_BUDGET_BYTES}`,
      })
    }
  }
  return violations
}

export function bundleBudgetPlugin(): Plugin {
  return {
    name: 'agent-commons-bundle-budget',
    apply: 'build',
    generateBundle(_options, bundle) {
      const encoder = new TextEncoder()
      const chunks: BundleChunkMeasure[] = Object.values(bundle).flatMap((item) =>
        item.type === 'chunk'
          ? [{
              fileName: item.fileName,
              isEntry: item.isEntry,
              bytes: encoder.encode(item.code).byteLength,
              imports: item.imports,
              dynamicImports: item.dynamicImports,
            }]
          : [],
      )
      const assets = Object.values(bundle).flatMap((item) => item.type === 'asset'
        ? [{ fileName: item.fileName, bytes: typeof item.source === 'string' ? encoder.encode(item.source).byteLength : item.source.byteLength }]
        : [])
      const violations = [...bundleBudgetViolations(chunks), ...workerBudgetViolations(assets)]
      if (violations.length) {
        const diagnostics = violations.flatMap((violation) => {
          const chunk = bundle[violation.fileName]
          if (!chunk || chunk.type !== 'chunk') return []
          const largest = Object.entries(chunk.modules)
            .map(([id, info]) => ({ id, bytes: info.renderedLength }))
            .filter((item) => item.bytes > 0)
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 8)
          return largest.length
            ? [`  largest modules in ${violation.fileName}:`, ...largest.map((item) => `  - ${item.bytes} B ${item.id}`)]
            : []
        })
        this.error(
          `JavaScript bundle budget exceeded:\n${violations
            .map((item) => `- ${item.fileName}: ${item.reason}`)
            .join('\n')}${diagnostics.length ? `\n${diagnostics.join('\n')}` : ''}`,
        )
      }
    },
  }
}
