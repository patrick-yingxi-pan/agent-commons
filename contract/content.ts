/** ── Contract: artifact bodies ─────────────────────────────────────────────
 *  The rendered content of an artifact (a doc's blocks, a sheet's rows, a deck's
 *  slides, a figure's series). The mock backend serves hand-authored bodies; a
 *  real backend would render/extract the actual file. Shared so the server's
 *  payload and the UI's renderer agree on shape. */

export type DocBlock =
  | { h: string } // section heading
  | { p: string } // paragraph
  | { ul: string[] } // bullet list
  | { code: string[] } // monospace block (config, headers, signatures)
  | { email: { to: string; subject: string } } // an email's To/Subject header

export type FigureShape = 'hero' | 'bars' | 'line' | 'funnel'

export type ArtifactContent =
  | { type: 'doc'; title: string; blocks: DocBlock[] }
  | { type: 'sheet'; columns: string[]; rows: string[][]; note?: string }
  | { type: 'slides'; slides: { title: string; bullets: string[] }[] }
  | {
      type: 'figure'
      shape: FigureShape
      caption: string
      headline?: string
      labels?: string[]
      series?: number[]
      series2?: number[]
      legend?: [string, string]
    }

/** The whole artifact-body library, keyed by file name. */
export type ArtifactContentLibrary = Record<string, ArtifactContent>
