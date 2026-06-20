const KNOWN_WORKSPACE_FILE_PATH_RE = /(?:~\/|\/|\.\/|[A-Za-z0-9_.-])[\w./@%+-]*\.(?:ts|tsx|js|jsx|json|jsonc|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql|txt|yaml|yml|toml|ini|csv|tsv|log|xml)/i;
const SCOPED_UNKNOWN_WORKSPACE_FILE_PATH_RE = /(?:~\/|\/|\.\/|[A-Za-z0-9_.-]+\/)[\w./@%+-]*\.[A-Za-z0-9]{1,12}/i;

export const WORKSPACE_FILE_PATH_PATTERN = /(?:~\/|\/|\.\/|[A-Za-z0-9_.-])[\w./@%+-]*\.[A-Za-z0-9]{1,12}/i;

export function hasExplicitWorkspaceFilePath(text: string): boolean {
  const value = String(text || '');
  return KNOWN_WORKSPACE_FILE_PATH_RE.test(value) || SCOPED_UNKNOWN_WORKSPACE_FILE_PATH_RE.test(value);
}
