import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { PAGE_ACTION_BUTTON_CLASS } from '../lib/button'
import type { SectionId } from '../types'
import { useCompositeCommand } from '../lib/useCompositeFeatures'

/** The one standing page-level verb. Page headers and hub toolbars use this
 *  component whether the action opens a dialog directly or first opens a
 *  picker; aria-haspopup/expanded pass through without changing its face. */
export function PageActionButton({
  icon,
  children,
  type = 'button',
  mirrorsRailFor,
  onRailInvoke,
  ...props
}: {
  icon?: ReactNode
  children: ReactNode
  /** Marks the page's primary resource action. The compact rail projection
   * invokes the SAME callback through the focused-pane command channel. */
  mirrorsRailFor?: SectionId
  onRailInvoke?: () => void
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>) {
  useCompositeCommand(mirrorsRailFor, 'primary-action', onRailInvoke ?? (() => {}), !!onRailInvoke)
  return (
    <button type={type} data-page-action className={PAGE_ACTION_BUTTON_CLASS} {...props}>
      {icon}
      {children}
    </button>
  )
}
