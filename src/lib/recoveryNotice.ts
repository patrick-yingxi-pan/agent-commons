/** Recovery retains authority across navigation, but never owns the workspace.
 * Text gets a readable flex basis before actions wrap; stacked notices have a
 * bounded, keyboard-scrollable region. Pair with a named region and tabIndex. */
export const RECOVERY_NOTICE_REGION_CLASS = 'min-h-0 max-h-[35dvh] overflow-y-auto overscroll-contain'
export const RECOVERY_NOTICE_MESSAGE_CLASS = 'min-w-0 grow basis-64 break-words [overflow-wrap:anywhere]'
