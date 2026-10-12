import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import type { EditableArtifactBody } from '../../contract/index.ts'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { MAX_DRAFT_HISTORY_STATES } from '../lib/draftHistory'

export interface ArtifactDraftHistoryActions {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

/** One keyboard/focus scope for every full saved-artifact editor. The shared
 * account-scoped store owns history; unmounting a pane does not discard it. */
export function ArtifactDraftHistory({ body, onChange, history, disabled, children }: {
  body: EditableArtifactBody
  onChange: (body: EditableArtifactBody, group?: symbol) => void
  history: ArtifactDraftHistoryActions
  disabled: boolean
  children: (change: (body: EditableArtifactBody) => void) => ReactNode
}) {
  const scope = useRef<HTMLDivElement>(null)
  const group = useRef<symbol | undefined>(undefined)
  const clipboardEdit = useRef(false)
  const clicked = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    const control = clicked.current
    clicked.current = null
    // A structural deletion can remove its own focused button. Retain the
    // keyboard scope without taking focus from another still-mounted control.
    if (control && !control.isConnected && control.ownerDocument.activeElement === control.ownerDocument.body) {
      scope.current?.focus({ preventScroll: true })
    }
  }, [body])
  const traverse = (direction: 'undo' | 'redo') => {
    group.current = scope.current?.ownerDocument.activeElement?.matches('input, textarea, select') ? Symbol('field edit') : undefined
    if (disabled) return
    if (direction === 'undo' && history.canUndo) history.onUndo()
    if (direction === 'redo' && history.canRedo) history.onRedo()
  }
  return <div ref={scope} tabIndex={-1} role="group" aria-label="Artifact draft editing" data-artifact-draft-history className="min-w-0 space-y-3"
    onFocusCapture={event => {
      group.current = event.target.matches('input, textarea, select') ? Symbol('field edit') : undefined
    }}
    onBlurCapture={() => { group.current = undefined }}
    onPasteCapture={() => { group.current = Symbol('paste'); clipboardEdit.current = true }}
    onPaste={() => {
      // Custom grid paste changes synchronously in the child's paste handler;
      // rejected paste still ends that transaction. Native paste is identified
      // separately by the subsequent input event.
      group.current = Symbol('field edit')
      clipboardEdit.current = false
    }}
    onInputCapture={event => {
      const type = (event.nativeEvent as InputEvent).inputType
      if (type === 'insertFromPaste' || type === 'deleteByCut') {
        group.current = Symbol('clipboard edit')
        clipboardEdit.current = true
      }
    }}
    onClickCapture={event => {
      const button = (event.target as Element).closest('button')
      if (button) { group.current = undefined; clicked.current = button }
    }}
    onKeyDownCapture={event => {
      if (event.altKey || event.nativeEvent.isComposing || !(event.metaKey || event.ctrlKey)) return
      const key = event.key.toLowerCase()
      const direction = key === 'z' ? (event.shiftKey ? 'redo' : 'undo')
        : key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey ? 'redo' : undefined
      if (!direction) return
      const target = event.target
      if (target instanceof Element && target.closest('[data-artifact-transient-input]')) return
      event.preventDefault()
      event.stopPropagation()
      traverse(direction)
    }}>
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" data-inline-action className={INLINE_ACTION_CLASS} disabled={disabled || !history.canUndo}
        aria-keyshortcuts="Control+z Meta+z" title="Undo unsaved edit (⌘Z / Ctrl+Z)" onClick={() => traverse('undo')}>
        <Undo2 size={13} /> Undo
      </button>
      <button type="button" data-inline-action className={INLINE_ACTION_CLASS} disabled={disabled || !history.canRedo}
        aria-keyshortcuts="Control+Shift+z Meta+Shift+z Control+y" title="Redo unsaved edit (⇧⌘Z / Ctrl+Shift+Z / Ctrl+Y)" onClick={() => traverse('redo')}>
        <Redo2 size={13} /> Redo
      </button>
      <span className="text-[11px] text-ink-faint" title={`Up to ${MAX_DRAFT_HISTORY_STATES} recent steps, within the memory limit. Navigation keeps history; changing accounts clears it.`}>
        Unsaved edits · cleared by Save or Cancel
      </span>
    </div>
    {children(next => {
      onChange(next, group.current)
      if (clipboardEdit.current) {
        group.current = Symbol('field edit')
        clipboardEdit.current = false
      }
    })}
  </div>
}
