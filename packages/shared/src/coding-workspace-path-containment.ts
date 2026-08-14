import * as fs from 'node:fs';
import * as nodePath from 'node:path';

export interface CanonicalPathRouteIdentity {
  canonicalPath: string;
  existingAncestorPath: string;
  existingAncestorCanonicalPath: string;
  existingAncestorDevice: string;
  existingAncestorInode: string;
  existingAncestorFingerprint: string;
  missingSegments: string[];
}

export function isCanonicalPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const canonicalRoot = canonicalizeThroughExistingAncestor(rootPath);
  const canonicalTarget = canonicalizeThroughExistingAncestor(targetPath);
  if (!canonicalRoot || !canonicalTarget) return false;
  const relative = nodePath.relative(canonicalRoot, canonicalTarget);
  return relative === '' || (!!relative
    && relative !== '..'
    && !relative.startsWith(`..${nodePath.sep}`)
    && !nodePath.isAbsolute(relative));
}

/** Resolve a lexical path through its nearest existing ancestor. */
export function canonicalizeThroughExistingAncestor(inputPath: string): string | undefined {
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

/**
 * Captures the route traversed by a later mutation. Replacing a missing parent
 * while authorization is pending changes this identity and invalidates the write.
 */
export function captureCanonicalPathRouteIdentity(inputPath: string): CanonicalPathRouteIdentity | undefined {
  let cursor = nodePath.resolve(inputPath);
  const missingSegments: string[] = [];
  while (true) {
    let stats: fs.BigIntStats;
    try {
      stats = fs.lstatSync(cursor, { bigint: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined;
      const parent = nodePath.dirname(cursor);
      if (parent === cursor) return undefined;
      missingSegments.unshift(nodePath.basename(cursor));
      cursor = parent;
      continue;
    }
    try {
      const canonicalAncestor = fs.realpathSync.native(cursor);
      return {
        canonicalPath: nodePath.resolve(canonicalAncestor, ...missingSegments),
        existingAncestorPath: cursor,
        existingAncestorCanonicalPath: canonicalAncestor,
        existingAncestorDevice: stats.dev.toString(),
        existingAncestorInode: stats.ino.toString(),
        existingAncestorFingerprint: [
          stats.dev,
          stats.ino,
          stats.isSymbolicLink() ? 'symlink' : stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
        ].map(value => value.toString()).join(':'),
        missingSegments,
      };
    } catch {
      return undefined;
    }
  }
}

export function isSameCanonicalPathRoute(
  left: CanonicalPathRouteIdentity,
  right: CanonicalPathRouteIdentity,
): boolean {
  return left.canonicalPath === right.canonicalPath
    && left.existingAncestorPath === right.existingAncestorPath
    && left.existingAncestorCanonicalPath === right.existingAncestorCanonicalPath
    && left.existingAncestorFingerprint === right.existingAncestorFingerprint
    && left.missingSegments.length === right.missingSegments.length
    && left.missingSegments.every((segment, index) => segment === right.missingSegments[index]);
}
