import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { ChevronDown, ChevronsDown, ChevronsUp } from 'lucide-react'
import { BackButton, PageBackContext } from './BackButton'
import { FOLD_HEADER_CLASS, SECTION_BODY_CLASS, SECTION_GAP, SECTION_RULE_SPACE } from '../lib/foldHeader'
import { SECTION_REVEAL, SECTION_REVEAL_GROUP } from '../lib/hoverReveal'
import { INLINE_ACTION_CLASS } from '../lib/inlineAction'
import { LEDGER_LIST_CLASS, LEDGER_RULE_CLASS } from '../lib/ledger'
import { PAGE_HEADER_CLASS, PAGE_TITLE_CLASS } from '../lib/pageHeader'
import { isSectionFolded, pageFoldWork, setSectionFolded } from '../lib/sectionFold'
import { subscribeLayout } from '../lib/uiPrefs'
import { useSectionFold } from '../lib/useSectionFold'

/** The two main-page templates are semantic specializations of this one frame.
 *
 * The shared frame owns resource identity and its DOM review handle. Reading
 * pages also inherit the container query, reading width and responsive inset;
 * an atomic conversation selects the workspace layout because its independently
 * scrolling transcript and fixed composer are real behavior, not another visual
 * representation of a reading page. `CompositeResourcePage` additionally opens
 * structural-section scope; `AtomicResourcePage` deliberately does not.
 */
function ResourcePageFrame({
  nature,
  layout = 'reading',
  children,
  className = '',
  ...rootProps
}: {
  nature: 'atomic' | 'composite'
  layout?: 'reading' | 'workspace'
  children: ReactNode
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  if (layout === 'workspace') {
    return (
      <div
        {...rootProps}
        data-resource-page
        data-resource-nature={nature}
        data-resource-layout="workspace"
        className={`flex min-h-0 min-w-0 flex-1 flex-col ${className}`}
      >
        {children}
      </div>
    )
  }

  return (
    <div
      {...rootProps}
      data-resource-page
      data-resource-nature={nature}
      data-resource-layout="reading"
      className={`flex-1 overflow-y-auto @container ${className}`}
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-5 sm:px-6 sm:py-6">{children}</div>
    </div>
  )
}

type FoldEntry = { title: string; defaultFolded: boolean }
type FoldRegister = (entry: FoldEntry) => () => void

const FoldScopeContext = createContext<FoldRegister | null>(null)
const FoldEntriesContext = createContext<readonly FoldEntry[]>([])
const CompositeSectionPageContext = createContext(false)

/** A branch page in the account-resource forest.
 *
 * Its sections self-register so the overview's fold controls enumerate what
 * actually rendered (including viewer-relative visibility) rather than a second
 * hand-maintained list. `sectionPage` is the addressable projection of one
 * structural child; that section is forced open because navigation already
 * performed the disclosure.
 */
export function CompositeResourcePage({
  children,
  sectionPage = false,
}: {
  children: ReactNode
  sectionPage?: boolean
}) {
  const [entries, setEntries] = useState<FoldEntry[]>([])
  const register = useCallback<FoldRegister>((entry) => {
    setEntries((current) =>
      current.some((candidate) => candidate.title === entry.title) ? current : [...current, entry],
    )
    return () => setEntries((current) => current.filter((candidate) => candidate.title !== entry.title))
  }, [])

  return (
    <ResourcePageFrame nature="composite">
      <FoldEntriesContext.Provider value={entries}>
        <FoldScopeContext.Provider value={register}>
          <CompositeSectionPageContext.Provider value={sectionPage}>
            {children}
          </CompositeSectionPageContext.Provider>
        </FoldScopeContext.Provider>
      </FoldEntriesContext.Provider>
    </ResourcePageFrame>
  )
}

/** A leaf page in the account-resource forest.
 *
 * The template standardizes navigation, resource identity and heading grammar
 * without prescribing the payload's form. An atomic lifecycle may be a
 * timeline; an artifact may be a document; a connector may expose settings; a
 * session may use the workspace layout for its transcript and fixed composer.
 * Information regions may still use `ResourcePageSection`, but they are facets
 * of this one resource and do not register as structural navigation children.
 */
export function AtomicResourcePage({
  children,
  layout = 'reading',
  ...frameProps
}: {
  children: ReactNode
  layout?: 'reading' | 'workspace'
} & Omit<HTMLAttributes<HTMLDivElement>, 'children'>) {
  return (
    <ResourcePageFrame nature="atomic" layout={layout} {...frameProps}>
      {children}
    </ResourcePageFrame>
  )
}

/** The one page-title header for both templates. */
export function ResourcePageHeader({
  title,
  badge,
  subtitle,
  children,
}: {
  title: ReactNode
  badge?: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
}) {
  const back = useContext(PageBackContext)
  return (
    <header className={PAGE_HEADER_CLASS}>
      <div className="flex min-w-0 grow basis-64 items-start gap-1">
        {back && <BackButton to={back.to} onBack={back.onBack} />}
        <div className="min-w-0">
          <div className="flex items-center gap-2 max-sm:hidden">
            <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
            {badge}
          </div>
          {subtitle && <p className="mt-1 text-[13px] text-ink-soft max-sm:mt-0">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="ml-auto flex min-w-0 shrink-0 flex-wrap items-center gap-2.5">{children}</div>}
    </header>
  )
}

/** The hover-revealed verb cluster shared by a page header and a section. */
export function ResourcePageActions({ children }: { children: ReactNode }) {
  return <div className={`-my-1.5 flex shrink-0 items-center gap-0.5 ${SECTION_REVEAL}`}>{children}</div>
}

export type FoldAct = { act: () => void; title: string; name?: string }

/** One Fold all · Unfold all projection, reused by pages and discussions. */
export function FoldPairRow({ fold, unfold }: { fold?: FoldAct; unfold?: FoldAct }) {
  if (!fold && !unfold) return null
  return (
    <div className="mb-2 flex items-center justify-end gap-1">
      {(
        [
          ['Fold all', ChevronsUp, fold],
          ['Unfold all', ChevronsDown, unfold],
        ] as const
      ).map(([text, Icon, action]) =>
        action ? (
          <button
            key={text}
            onClick={action.act}
            aria-label={action.name}
            title={action.title}
            className={INLINE_ACTION_CLASS}
          >
            <Icon size={12} className="shrink-0" />
            {text}
          </button>
        ) : null,
      )}
    </div>
  )
}

/** Overview controls for the structural sections that actually rendered. */
export function CompositePageFoldControls() {
  const entries = useContext(FoldEntriesContext)
  const read = useCallback(
    () => entries.map((entry) => (isSectionFolded(entry.title, entry.defaultFolded) ? '1' : '0')).join(''),
    [entries],
  )
  const bits = useSyncExternalStore(subscribeLayout, read, read)
  const titles = entries.map((entry) => entry.title)
  const { foldable, unfoldable } = pageFoldWork(titles, (title) => bits[titles.indexOf(title)] === '1')

  return (
    <FoldPairRow
      fold={
        foldable.length > 0
          ? {
              act: () => foldable.forEach((title) => setSectionFolded(title, true)),
              name: 'Fold all sections',
              title: 'Collapse every section on this page to its one-line summary',
            }
          : undefined
      }
      unfold={
        unfoldable.length > 0
          ? {
              act: () => unfoldable.forEach((title) => setSectionFolded(title, false)),
              name: 'Unfold all sections',
              title: 'Open every section on this page',
            }
          : undefined
      }
    />
  )
}

/** The complementary section primitive for both templates.
 *
 * In a composite template it registers as structural page anatomy. In an
 * atomic template it remains only a disclosure region within one leaf. That
 * contextual difference is what keeps ontology and visual layout separate.
 */
export function ResourcePageSection({
  title,
  actions,
  defaultFolded,
  persist = true,
  summary,
  children,
}: {
  title: string
  actions?: ReactNode
  defaultFolded?: boolean
  persist?: boolean
  summary: ReactNode
  children: ReactNode
}) {
  const [storedFolded, setStoredFolded] = useSectionFold(title, defaultFolded)
  const [localFolded, setLocalFolded] = useState(defaultFolded === true)
  const folded = persist ? storedFolded : localFolded
  const setFolded = persist ? setStoredFolded : setLocalFolded
  const sectionPage = useContext(CompositeSectionPageContext)
  const effectiveFolded = sectionPage ? false : folded
  const register = useContext(FoldScopeContext)

  useEffect(
    () => (persist ? register?.({ title, defaultFolded: defaultFolded === true }) : undefined),
    [register, title, defaultFolded, persist],
  )

  return (
    <section
      data-resource-page-section
      className={`${SECTION_REVEAL_GROUP} ${effectiveFolded ? SECTION_GAP.folded : SECTION_GAP.open}`}
    >
      <div
        className={`flex items-center justify-between gap-2 ${LEDGER_RULE_CLASS} ${SECTION_RULE_SPACE.above} ${effectiveFolded ? '' : SECTION_RULE_SPACE.below}`}
      >
        <button
          onClick={() => !sectionPage && setFolded(!effectiveFolded)}
          aria-expanded={!effectiveFolded}
          aria-disabled={sectionPage || undefined}
          className={`${FOLD_HEADER_CLASS} min-w-0 ${effectiveFolded ? 'flex-1' : ''}`}
        >
          <span
            data-section-title
            className="truncate text-[12px] font-semibold uppercase tracking-wide text-ink-soft"
          >
            {title}
          </span>
          <ChevronDown
            size={13}
            className={`shrink-0 text-ink-faint transition group-hover:text-ink-soft ${effectiveFolded ? '-rotate-90' : ''} ${sectionPage ? 'invisible' : ''}`}
          />
          {effectiveFolded && (
            <span className="min-w-0 flex-1 truncate text-left text-[12px] font-normal normal-case tracking-normal text-ink-faint">
              {summary}
            </span>
          )}
        </button>
        {actions && <ResourcePageActions>{actions}</ResourcePageActions>}
      </div>
      {effectiveFolded ? null : <div className={SECTION_BODY_CLASS}>{children}</div>}
    </section>
  )
}

export function ResourcePageEmpty({ children }: { children: ReactNode }) {
  return <div className="py-16 text-center text-[13px] text-ink-faint">{children}</div>
}

/** The one main-column list container, exported with the page grammar so a
 * section body cannot redraw the surrounding page's chrome. */
export function ResourcePageList({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div data-card-list className={`${LEDGER_LIST_CLASS} ${className}`}>
      {children}
    </div>
  )
}
