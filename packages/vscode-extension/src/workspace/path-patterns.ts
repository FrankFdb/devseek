export const KNOWN_WORKSPACE_FILE_EXTENSIONS_PATTERN = [
  'jsonc', 'yaml', 'toml', 'scss', 'html', 'bash',
  'tsx', 'jsx', 'mjs', 'cjs', 'cpp', 'cxx', 'hpp', 'hxx',
  'ts', 'js', 'cc', 'hh', 'py', 'java', 'go', 'rs', 'md',
  'css', 'txt', 'yml', 'ini', 'csv', 'tsv', 'log', 'xml',
  'json', 'zsh', 'sql', 'sh', 'c', 'h',
].join('|');

export const WORKSPACE_FILE_PATH_TOKEN_PATTERN = `[A-Za-z0-9_./\\\\-]+\\.(?:${KNOWN_WORKSPACE_FILE_EXTENSIONS_PATTERN})`;
const WORKSPACE_FILE_PATH_BOUNDARY_PATTERN = '(?=$|[^A-Za-z0-9_./\\\\-])';

const KNOWN_WORKSPACE_FILE_PATH_RE = new RegExp(
  `(?:~/|/|\\./|[A-Za-z0-9_.-])[\\w./@%+-]*\\.(?:${KNOWN_WORKSPACE_FILE_EXTENSIONS_PATTERN})${WORKSPACE_FILE_PATH_BOUNDARY_PATTERN}`,
  'i',
);
const SCOPED_UNKNOWN_WORKSPACE_FILE_PATH_RE = /(?:~\/|\/|\.\/|[A-Za-z0-9_.-]+\/)[\w./@%+-]*\.[A-Za-z0-9]{1,12}/i;

export const WORKSPACE_FILE_PATH_PATTERN = /(?:~\/|\/|\.\/|[A-Za-z0-9_.-])[\w./@%+-]*\.[A-Za-z0-9]{1,12}/i;

export function createWorkspaceFilePathTokenRegExp(flags = 'gi'): RegExp {
  return new RegExp(`(${WORKSPACE_FILE_PATH_TOKEN_PATTERN})${WORKSPACE_FILE_PATH_BOUNDARY_PATTERN}`, flags);
}

export function hasExplicitWorkspaceFilePath(text: string): boolean {
  const value = String(text || '');
  return KNOWN_WORKSPACE_FILE_PATH_RE.test(value) || SCOPED_UNKNOWN_WORKSPACE_FILE_PATH_RE.test(value);
}
