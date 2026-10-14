export const FS_SOURCE_GROUP_CLASS =
  'mb-2 flex flex-wrap items-center gap-0.5 rounded-lg bg-panel-2 p-0.5'

export const FS_SOURCE_OPTION_CLASS =
  'flex min-w-0 max-w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition'

/** Compact native picker rows reserve a complete line for connection identity;
 * action growth wraps below instead of squeezing or fragmenting the label. */
export const FS_LOCAL_CONNECTION_ROW_CLASS =
  'min-w-0 border-b border-line py-2'

export const FS_LOCAL_CONNECTION_IDENTITY_CLASS =
  'w-full min-w-0'

export const FS_LOCAL_CONNECTION_NAME_CLASS =
  'block break-words [overflow-wrap:anywhere] text-[13px] text-ink'

export const FS_LOCAL_CONNECTION_STATUS_CLASS =
  'block w-full whitespace-nowrap text-[11px] leading-tight text-ink-soft'

export const FS_LOCAL_CONNECTION_ACTIONS_CLASS =
  'flex w-full min-w-0 flex-wrap items-center gap-2 pt-2'

/** Reserve the picker heading, padding and Done footer outside a single scroll
 * owner, including source choices, native setup and asynchronous read errors. */
export const FS_PICKER_BODY_CLASS =
  'max-h-[min(420px,calc(var(--popover-available-height,100dvh)-100px))] overflow-y-auto'
