import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import type * as Views from './LocalFolderConnections.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { AtomicResourcePage } from './ResourcePage.tsx'
import { BackButton } from './BackButton.tsx'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader.ts'

const load = () => import('./LocalFolderConnections.tsx')
const Connect = lazy(() => load().then(m => ({ default: m.LocalFolderConnect })))
const Detail = lazy(() => load().then(m => ({ default: m.LocalFolderDetail })))
const Row = lazy(() => load().then(m => ({ default: m.LocalFolderRow })))
const Status = lazy(() => load().then(m => ({ default: m.LocalFolderStatus })))

/** Native controls and their commands become available together. Chunk failure
 * never grants access or starts a capture; navigation remains available. */
class Boundary extends Component<{ children: ReactNode; navigation?: Pick<ComponentProps<typeof Views.LocalFolderDetail>, 'onBack' | 'backTo'> }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  notice(failed: boolean) {
    const notice = <InlineOperationStatus tone={failed ? 'alert' : 'status'}
      message={failed ? 'Couldn’t load local folder controls. Saved copies are unchanged. Copy unsent text before reloading.' : 'Loading local folder controls…'}
      action={failed ? { label: 'Reload controls', onClick: () => window.location.reload() } : undefined} />
    const navigation = this.props.navigation
    return navigation ? <AtomicResourcePage>
      <header className={PAGE_HEADER_CLASS}><BackButton to={navigation.backTo} onBack={navigation.onBack} /><h1 className={PAGE_TITLE_CLASS}>Local folder</h1></header>
      {notice}
    </AtomicResourcePage> : notice
  }
  render() { return this.state.failed ? this.notice(true) : <Suspense fallback={this.notice(false)}>{this.props.children}</Suspense> }
}

export function LocalFolderConnect(props: ComponentProps<typeof Views.LocalFolderConnect>) { return <Boundary><Connect {...props} /></Boundary> }
export function LocalFolderDetail(props: ComponentProps<typeof Views.LocalFolderDetail>) {
  return <Boundary navigation={props}><Detail {...props} /></Boundary>
}
export function LocalFolderRow(props: ComponentProps<typeof Views.LocalFolderRow>) { return <Boundary><Row {...props} /></Boundary> }
export function LocalFolderStatus() { return <Boundary><Status /></Boundary> }
