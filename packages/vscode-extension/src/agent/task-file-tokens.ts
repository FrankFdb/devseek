import * as nodePath from 'path';
import type { WrittenFileEvidence } from './completion-evidence';

const TASK_FILE_TOKEN_RE = /(?:^|[^\w/.-])((?:[\w.-]+\/)*[\w.-]+\.(?:cpp|cc|cxx|c|h|hpp|hh|hxx|txt|md|json|ya?ml|cmake)|CMakeLists\.txt)\b/gi;

export function extractTaskFileTokens(...texts: Array<string | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const text of texts) {
    let match: RegExpExecArray | null;
    TASK_FILE_TOKEN_RE.lastIndex = 0;
    while ((match = TASK_FILE_TOKEN_RE.exec(text || '')) !== null) {
      const token = normalizeEvidencePath(match[1] || '');
      if (!token) continue;
      tokens.add(token);
      tokens.add(nodePath.posix.basename(token));
    }
  }
  return tokens;
}

export function taskFileTokensMatchWrittenEvidence(
  tokens: Set<string>,
  evidence: WrittenFileEvidence,
  workspaceRoot?: string,
): boolean {
  if (tokens.size === 0) return false;
  const evidencePath = normalizeEvidencePath(evidence.path);
  const evidenceRel = makeWorkspaceRelative(evidence.path, workspaceRoot);
  const evidenceBase = nodePath.basename(evidencePath);
  return tokens.has(evidencePath)
    || Boolean(evidenceRel && tokens.has(evidenceRel))
    || tokens.has(evidenceBase)
    || [...tokens].some(token => evidencePath.endsWith(`/${token}`));
}

export function normalizeEvidencePath(filePath: string): string {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function makeWorkspaceRelative(filePath: string, workspaceRoot?: string): string | undefined {
  const normalized = normalizeEvidencePath(filePath);
  if (!normalized) return undefined;
  if (!workspaceRoot) return nodePath.isAbsolute(normalized) ? undefined : normalized;
  const root = normalizeEvidencePath(workspaceRoot);
  try {
    const rel = nodePath.relative(root, normalized).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..') && !nodePath.isAbsolute(rel)) return rel;
  } catch {
    return nodePath.isAbsolute(normalized) ? undefined : normalized;
  }
  return nodePath.isAbsolute(normalized) ? undefined : normalized;
}
