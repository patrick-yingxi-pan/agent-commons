/** One disclosure for native Git intake and saved-copy previews. */
export function GitSnapshotPolicy() {
  return <details data-git-snapshot-policy className="py-1 text-[12px] leading-snug text-ink-soft">
    <summary className="cursor-pointer py-1">Capture limits and exclusions</summary>
    <div className="space-y-2 py-2">
      <p>Tracked working-tree files include uncommitted edits; nested paths are preserved. Untracked files and files matched by .gitignore or .git/info/exclude are excluded. Other repository and global Git configuration is not used.</p>
      <p>Repositories with more than 500 tracked entries cannot be captured. Within that limit, save up to 24 readable text files, 64 KiB per file and 128 KiB total. Other files retain an omission notice.</p>
      <p>Unsupported files, submodules, symlinks, sparse-only entries and deletions supply no text. Originals never change. Only saved text feeds the model; Attach or Refresh explicitly captures later edits.</p>
    </div>
  </details>
}
