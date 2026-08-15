import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { PAGE_ACTION_BUTTON_CLASS } from '../lib/button'

/** The one standing page-level verb. Page headers and hub toolbars use this
 *  component whether the action opens a dialog directly or first opens a
 *  picker; aria-haspopup/expanded pass through without changing its face. */
export function PageActionButton({
  icon,
  children,
  type = 'button',
  ...props
}: {
  icon?: ReactNode
  children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>) {
  return (
    <button type={type} data-page-action className={PAGE_ACTION_BUTTON_CLASS} {...props}>
      {icon}
      {children}
    </button>
  )
}
