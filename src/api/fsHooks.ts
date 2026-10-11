/** Filesystem queries load with optional pickers/previews, not the app shell. */
import { useEffect, useState } from 'react'
import type { FsCatalog, FsFileContent, FsFolderContents, FsSource } from '../../contract/fs.ts'
import { useQuery, type QueryState } from './cache.ts'
import { apiGet, apiUrl } from './client.ts'
import { keys, paths } from './keys.ts'
import { readFsCatalog, readFsSources } from './fsReads.ts'

/** Unlike ordinary stale-while-revalidate views, picker rows confer new intake
 * authority. Suppress cached success even on the first render, before useQuery's
 * passive mount effect begins revalidation. Key changes get the same fence. */
function useFsQuery<T>(key: string, fetcher: () => Promise<T>, enabled = true): QueryState<T> {
  const state = useQuery(key, fetcher, enabled, true)
  const [admitted, setAdmitted] = useState<string | null>(null)
  useEffect(() => { setAdmitted(enabled ? key : null) }, [key, enabled])
  return !enabled || admitted === key ? state : { ...state, status: 'loading' }
}

/** Server-known sources; the picker appends its own explicit UI-host source. */
export function useFsSources(): QueryState<FsSource[]> {
  return useFsQuery(keys.fsSources, readFsSources)
}

/** Every picker mount rechecks disk contents and current runner grants. */
export function useFsCatalog(source: string, enabled = true): QueryState<FsCatalog> {
  return useFsQuery(keys.fsCatalog(source), () => readFsCatalog(source), enabled)
}

export function useFsFolder(source: string, path: string, enabled = true): QueryState<FsFolderContents> {
  return useQuery(keys.fsFolder(source, path), () => apiGet<FsFolderContents>(paths.fsFolder(source, path)), enabled)
}

export function useFsText(source: string, path: string, enabled = true): QueryState<FsFileContent> {
  return useQuery(keys.fsText(source, path), () => apiGet<FsFileContent>(paths.fsText(source, path)), enabled)
}

/** Raw served bytes (an image), resolved through the shared API origin. */
export function fsContentUrl(source: string, path: string): string {
  return apiUrl(paths.fsContent(source, path))
}
