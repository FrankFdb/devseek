import * as fs from 'fs';
import * as nodePath from 'path';

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
  return relative === '' || (!!relative && !relative.startsWith('..') && !nodePath.isAbsolute(relative));
}

/**
 * Resolve a lexical path through its nearest existing ancestor. Missing suffixes
 * remain lexical, while every existing symlink is resolved by realpath.
 */
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
 * Capture the route that an eventual filesystem mutation would traverse.
 *
 * The nearest existing ancestor identity is intentionally part of the snapshot:
 * replacing a missing parent with a directory or symlink during an async
 * authorization wait must invalidate the original write authority, even if the
 * final lexical path still appears to be inside the workspace.
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
      // An existing but dangling/unresolvable symlink is never a safe mutation route.
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
