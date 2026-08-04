const CODE_ARTIFACT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
  '.py', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.go', '.rs', '.cs', '.php', '.rb', '.swift', '.kt', '.kts', '.scala',
  '.html', '.css', '.scss', '.sass', '.vue', '.svelte', '.sh', '.bash', '.zsh',
]);

export function isCodeArtifactPathValue(pathValue: string): boolean {
  const normalized = String(pathValue || '').trim().replace(/[?#].*$/, '');
  const extension = /(?:^|\/)(?:[^/]+)(\.[^./]+)$/.exec(normalized)?.[1]?.toLowerCase();
  return extension ? CODE_ARTIFACT_EXTENSIONS.has(extension) : false;
}
