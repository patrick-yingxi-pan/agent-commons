export const FS_SOURCE_GROUP_CLASS =
  'mb-2 flex flex-wrap items-center gap-0.5 rounded-lg bg-panel-2 p-0.5'

export const FS_SOURCE_OPTION_CLASS =
  'flex min-w-0 max-w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition'

/** Reserve the picker heading, padding and Done footer outside a single scroll
 * owner, including source choices, native setup and asynchronous read errors. */
export const FS_PICKER_BODY_CLASS =
  'max-h-[min(420px,calc(var(--popover-available-height,100dvh)-100px))] overflow-y-auto'
