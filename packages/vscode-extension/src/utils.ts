/**
 * utils.ts — Shared pure helpers (§2.15 rule 5)
 *
 * No VS Code API imports allowed here. No agent-loop or LLM dependencies.
 * Any function here must be a pure computation that can run in any context.
 */

/**
 * Map a filename or path to its code-fence language identifier.
 * Consolidates the duplicate fenceLangForFile (agent-loop.ts) and
 * fenceLangForPath (extension.ts) functions.
 */
export function fenceLangForFile(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', java: 'java', go: 'go', rs: 'rust', cs: 'csharp',
    cpp: 'cpp', cc: 'cpp', cxx: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
    json: 'json', md: 'markdown', css: 'css', sh: 'bash',
    yaml: 'yaml', yml: 'yaml',
  };
  return map[ext] ?? ext;
}

/**
 * Compute rough line-level diff counts for display purposes (set-based,
 * fast but approximate — repeated identical lines are collapsed).
 * Use lcsDiffOps in pending-edits logic when accuracy is required.
 */
export function roughLineDiff(
  oldText: string,
  newText: string,
): { added: number; removed: number } {
  const oldSet = new Set(oldText.split('\n'));
  const newArr = newText.split('\n');
  const newSet = new Set(newArr);
  return {
    added: newArr.filter((l) => !oldSet.has(l)).length,
    removed: oldText.split('\n').filter((l) => !newSet.has(l)).length,
  };
}
