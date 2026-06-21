import type { Connector } from '../../contract/entities.ts'

/** Mock detail shown in a connector / MCP sidebar. */
export interface ConnectorDetail {
  blurb: string
  access: string[]
  itemsLabel: string
  items: { label: string; meta?: string }[]
}

/** Derive sidebar content from a connector's label/kind. Keyed loosely so both
 *  connectors (Slack, Drive…) and MCP servers (filesystem, postgres…) resolve. */
export function connectorDetail(connector: Connector): ConnectorDetail {
  const key = connector.label.replace(/^MCP\s*·\s*/i, '').trim().toLowerCase()
  switch (key) {
    case 'github':
      return {
        blurb: 'Read and act on repositories, issues, and pull requests.',
        access: ['Search code & repositories', 'Read & comment on issues / PRs', 'Open branches & pull requests'],
        itemsLabel: 'Recent',
        items: [
          { label: 'patrick-yingxi-pan/web-app', meta: 'repo' },
          { label: '#482 Fix flaky insights test', meta: 'issue' },
          { label: 'PR #517 Add insights route', meta: 'pull request' },
        ],
      }
    case 'slack':
      return {
        blurb: 'Read channels and post messages on your behalf.',
        access: ['Read channel history', 'Post messages', 'Search across messages'],
        itemsLabel: 'Channels',
        items: [
          { label: '#launch', meta: '42 members' },
          { label: '#eng', meta: '128 members' },
          { label: '#product', meta: '63 members' },
        ],
      }
    case 'google drive':
      return {
        blurb: 'Read documents and files from your Drive.',
        access: ['Search files', 'Read docs, sheets & slides'],
        itemsLabel: 'Recent files',
        items: [
          { label: 'Launch plan', meta: 'Doc' },
          { label: 'Metrics Q3', meta: 'Sheet' },
          { label: 'Board deck', meta: 'Slides' },
        ],
      }
    case 'notion':
      return {
        blurb: 'Read and update Notion pages and databases.',
        access: ['Search pages', 'Read & edit pages', 'Query databases'],
        itemsLabel: 'Recent pages',
        items: [{ label: 'Launch runbook' }, { label: 'PRD: Insights' }, { label: 'Engineering wiki' }],
      }
    case 'linear':
      return {
        blurb: 'Read and manage Linear issues and projects.',
        access: ['Search issues', 'Create & update issues', 'Read projects'],
        itemsLabel: 'Assigned to you',
        items: [
          { label: 'INS-12 Dashboard route', meta: 'In Progress' },
          { label: 'INS-9 Feature flag', meta: 'Todo' },
        ],
      }
    case 'filesystem':
      return {
        blurb: 'Local files and directories, via the Model Context Protocol.',
        access: ['Scoped to the attached directory'],
        itemsLabel: 'Tools',
        items: [
          { label: 'read_file' },
          { label: 'write_file' },
          { label: 'list_directory' },
          { label: 'search_files' },
        ],
      }
    case 'postgres':
      return {
        blurb: 'Query a Postgres database, via the Model Context Protocol.',
        access: ['Read-only connection'],
        itemsLabel: 'Tools',
        items: [{ label: 'query' }, { label: 'list_tables' }, { label: 'describe_table' }],
      }
    case 'puppeteer':
      return {
        blurb: 'Headless browser automation, via the Model Context Protocol.',
        access: ['Runs in a sandboxed browser'],
        itemsLabel: 'Tools',
        items: [{ label: 'navigate' }, { label: 'screenshot' }, { label: 'click' }, { label: 'evaluate' }],
      }
    default:
      return connector.kind === 'mcp'
        ? { blurb: 'A Model Context Protocol server.', access: ['Exposes tools to this conversation'], itemsLabel: 'Tools', items: [] }
        : { blurb: 'A connected service.', access: ['Read data', 'Take actions'], itemsLabel: 'Resources', items: [] }
  }
}
