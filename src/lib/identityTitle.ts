/** Native disclosure for a visually truncated identity heading. The data
 * marker lets rendered checks find the exact heading without adding UI chrome. */
export function identityTitleProps(value: string): { title: string; 'data-identity-title': '' } {
  return { title: value, 'data-identity-title': '' }
}

/** Home breadcrumbs share the title column with fixed-width sibling actions.
 * Bound both the button and its text; an intrinsic word width must not paint
 * underneath the actions, even when the pane is narrower than the viewport. */
export function identityBreadcrumbProps(title: string) {
  return {
    title,
    'data-identity-breadcrumb': '',
    className: 'inline-flex min-w-0 max-w-full w-fit items-center gap-1 text-[12px] text-ink-faint transition hover:text-ink',
  }
}

export const IDENTITY_BREADCRUMB_TEXT_CLASS = 'min-w-0 truncate'

/** Intrinsic wrapping preserves identity room in narrow panes, not merely at
 * viewport breakpoints. Actions remain one coherent, right-aligned cluster. */
export const IDENTITY_HEADER_GROUP_CLASS = 'flex min-w-0 flex-[1_1_12rem] items-center gap-1.5'
export const IDENTITY_HEADER_ACTIONS_CLASS = 'ml-auto flex shrink-0 items-center gap-1.5'
