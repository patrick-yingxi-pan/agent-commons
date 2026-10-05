import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from 'react'
import type * as Views from './LocalGitConnections.tsx'
import { InlineOperationStatus } from './InlineOperationStatus.tsx'
import { AtomicResourcePage } from './ResourcePage.tsx'
import { BackButton } from './BackButton.tsx'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader.ts'

const load = () => import('./LocalGitConnections.tsx')
const Connect = lazy(() => load().then(m => ({ default: m.LocalGitConnect })))
const Detail = lazy(() => load().then(m => ({ default: m.LocalGitDetail })))
const Row = lazy(() => load().then(m => ({ default: m.LocalGitRow })))
const Status = lazy(() => load().then(m => ({ default: m.LocalGitStatus })))

class Boundary extends Component<{ children: ReactNode; navigation?: Pick<ComponentProps<typeof Views.LocalGitDetail>, 'onBack' | 'backTo'> }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  notice(failed: boolean) {
    const notice = <InlineOperationStatus tone={failed ? 'alert' : 'status'}
      message={failed ? 'Couldn’t load local repository controls. Saved snapshots are unchanged. Copy unsent text before reloading.' : 'Loading local repository controls…'}
      action={failed ? { label: 'Reload controls', onClick: () => window.location.reload() } : undefined} />
    const navigation = this.props.navigation
    return navigation ? <AtomicResourcePage>
      <header className={PAGE_HEADER_CLASS}><BackButton to={navigation.backTo} onBack={navigation.onBack} /><h1 className={PAGE_TITLE_CLASS}>Local repository</h1></header>
      {notice}
    </AtomicResourcePage> : notice
  }
  render() { return this.state.failed ? this.notice(true) : <Suspense fallback={this.notice(false)}>{this.props.children}</Suspense> }
}

export function LocalGitConnect() { return <Boundary><Connect /></Boundary> }
export function LocalGitDetail(props: ComponentProps<typeof Views.LocalGitDetail>) { return <Boundary navigation={props}><Detail {...props} /></Boundary> }
export function LocalGitRow(props: ComponentProps<typeof Views.LocalGitRow>) { return <Boundary><Row {...props} /></Boundary> }
export function LocalGitStatus() { return <Boundary><Status /></Boundary> }
