import * as fs from 'fs';
import * as nodePath from 'path';

export function isCanonicalPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const canonicalRoot = canonicalizeThroughExistingAncestor(rootPath);
  const canonicalTarget = canonicalizeThroughExistingAncestor(targetPath);
  if (!canonicalRoot || !canonicalTarget) return false;
  const relative = nodePath.relative(canonicalRoot, canonicalTarget);
  return relative === '' || (!!relative && !relative.startsWith('..') && !nodePath.isAbsolute(relative));
}

function canonicalizeThroughExistingAncestor(inputPath: string): string | undefined {
  let cursor = nodePath.resolve(inputPath);
  const missingSegments: string[] = [];
  while (!fs.existsSync(cursor)) {
    const parent = nodePath.dirname(cursor);
    if (parent === cursor) return undefined;
    missingSegments.unshift(nodePath.basename(cursor));
    cursor = parent;
  }
  try {
    return nodePath.resolve(fs.realpathSync.native(cursor), ...missingSegments);
  } catch {
    return undefined;
  }
}
