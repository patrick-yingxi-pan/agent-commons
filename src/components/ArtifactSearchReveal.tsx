import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ArtifactContent } from '../../contract/content.ts'
import type { ArtifactSearchTarget } from '../../contract/artifactSearch.ts'
import { artifactSearchReveal } from '../lib/artifactSearchReveal.ts'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction.ts'

const RevealContext = createContext<{ field?: string; request?: number; register?: (node: HTMLElement | null) => void }>({})

/** One field/scroll/focus funnel for every authored body, including lazily loaded
 * structured renderers. It never reads or mutates a body or uses a global selector. */
export function ArtifactSearchReveal({ body, revision, target, retained = false, children }: {
  body: ArtifactContent
  revision: number
  target: ArtifactSearchTarget
  retained?: boolean
  children: ReactNode
}) {
  const result = artifactSearchReveal(body, revision, target)
  const field = result.kind === 'ready' ? result.field : undefined
  const [node, setNode] = useState<HTMLElement | null>(null)
  const [request, setRequest] = useState(0)
  const revealed = useRef<HTMLElement | null>(null)
  const register = useCallback((element: HTMLElement | null) => {
    // Equal-shaped worksheet tabs reuse their cells. Leaving the target must
    // retire the old focus receipt even if the same DOM node later returns.
    if (!element) revealed.current = null
    setNode(element)
  }, [])
  const show = useCallback(() => {
    if (!node?.isConnected || !field) return
    node.focus({ preventScroll: true })
    node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' })
  }, [node, field])
  useEffect(() => {
    if (!node || !field || revealed.current === node) return
    revealed.current = node
    show()
  }, [node, field, show])
  const context = useMemo(() => ({ field, register, request }), [field, register, request])
  return <RevealContext.Provider value={context}>
    <div className="min-w-0 space-y-3 [&_[data-artifact-search-match]]:bg-accent-tint [&_[data-artifact-search-match]]:outline [&_[data-artifact-search-match]]:outline-2 [&_[data-artifact-search-match]]:outline-accent [&_[data-artifact-search-match]]:outline-offset-[-2px]" data-artifact-search-reveal={result.kind}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-soft" role="status">
        <span>{result.kind === 'stale'
          ? 'This artifact changed since this search result. Search again to locate a current match.'
          : result.kind === 'missing'
            ? 'This search location is not available in this body. No other text has been selected.'
            : `Search match · ${retained ? 'saved' : 'current'} version ${revision}.`}</span>
        {field && <button type="button" className={INLINE_ACTION_CLASS} onClick={() => { setRequest(value => value + 1); show() }}>Show match</button>}
      </div>
      {children}
    </div>
  </RevealContext.Provider>
}

export function useArtifactSearchFields() {
  const { field, register, request } = useContext(RevealContext)
  return {
    field,
    request,
    props: (candidate: string) => ({
      'data-artifact-search-field': candidate,
      ...(field === candidate ? { 'data-artifact-search-match': true, tabIndex: -1, ref: register } : {}),
    }),
  }
}
