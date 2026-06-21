/** Cache keys + API paths, defined once so a query and the event that invalidates
 *  it can't drift. `keys.*` index the client cache; `paths.*` are the URLs under
 *  `API_BASE`. Both grow per resource as reads migrate. */
export const keys = {
  capabilities: 'capabilities',
  sessions: 'sessions',
  session: (id: string) => `session:${id}`,
  dispatch: 'dispatch',
}

export const paths = {
  capabilities: '/capabilities',
  sessions: '/sessions',
  session: (id: string) => `/sessions/${encodeURIComponent(id)}`,
  dispatch: '/dispatch',
}
