import { Github, Plug, Server } from 'lucide-react'
import type { Connector } from '../types'

/** Pick the chip icon for a connector based on its kind. Keeps the icon
 *  consistent everywhere a connector is shown (composer chips, panel header). */
export function connectorIconFor(kind: Connector['kind']) {
  if (kind === 'mcp') return Server
  if (kind === 'connector') return Plug
  return Github
}
