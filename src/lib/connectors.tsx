import { Github, Plug, Server } from 'lucide-react'
import type { Connector } from '../types'

/** The single GitHub connector identity, shared everywhere it's referenced so a
 *  repo's GitHub remote and a standalone GitHub connector resolve to one chip. */
export const GITHUB_CONNECTOR_ID = 'gh-mcp'
export const GITHUB_CONNECTOR: Connector = {
  id: GITHUB_CONNECTOR_ID,
  label: 'GitHub',
  kind: 'github',
}

/** Pick the chip icon for a connector based on its kind. Keeps the icon
 *  consistent everywhere a connector is shown (composer chips, panel header). */
export function connectorIconFor(kind: Connector['kind']) {
  if (kind === 'mcp') return Server
  if (kind === 'connector') return Plug
  return Github
}
