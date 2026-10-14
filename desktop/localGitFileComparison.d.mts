import type { LocalGitFileComparison, LocalGitFileComparisonSelection } from '../contract/localGitFileComparison.mjs'

export function readLocalGitFileComparison(
  root: unknown,
  selection: LocalGitFileComparisonSelection,
  options?: Record<string, unknown>,
): Promise<LocalGitFileComparison>
