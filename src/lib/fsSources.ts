/** The picker's filesystem source list (contract/fs.ts): the server-known sources
 *  (the web backend's cloud storage + any fs-capable runner, from `/fs/sources`)
 *  followed by the client-side UI host. The UI host is appended here, not served,
 *  because a web backend can't read the browser's disk (see lib/uiHostFs.ts). */
import { useFsSources } from '../api/hooks'
import type { FsSource } from '../types'

/** The UI-host source — the machine the UI runs on (read client-side). */
export const UI_HOST_SOURCE: FsSource = { id: 'ui-host', kind: 'ui-host', label: 'This computer' }

/** The default source the file/photo/folder pickers open on — `cloud` is present
 *  on every backend and shows real content immediately. */
export const DEFAULT_FS_SOURCE_ID = 'cloud'

/** The ordered source list for the picker's switcher: cloud, then any runners,
 *  then the UI host. */
export function useFsSourceList(): FsSource[] {
  const sources = useFsSources()
  return [...(sources.data ?? []), UI_HOST_SOURCE]
}
