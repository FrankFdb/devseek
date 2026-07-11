import * as fs from 'fs';
import * as nodePath from 'path';
import { findGeneratedSourceSanityIssue, repairGeneratedSourceTransportEscapes } from './source-sanity';
import {
  captureCanonicalPathRouteIdentity,
  isCanonicalPathInsideRoot,
  isSameCanonicalPathRoute,
  type CanonicalPathRouteIdentity,
} from './path-containment';

export interface WorkspaceWriteResult {
  existed: boolean;
  oldContent: string;
  newContent: string;
  normalization?: WorkspaceWriteNormalization;
}

export interface WorkspaceWriteNormalization {
  kind: 'source-transport-escape-repair';
  repairCount: number;
}

export interface WorkspaceEditProposal {
  kind: 'write-text-file';
  absPath: string;
  content: string;
}

export interface WorkspaceFileSnapshot {
  absPath: string;
  existed: boolean;
  content: string;
}

export interface WorkspaceAppliedEdit {
  proposal: WorkspaceEditProposal;
  snapshot: WorkspaceFileSnapshot;
  result: WorkspaceWriteResult;
}

export interface WorkspaceTextFileBaseline {
  absPath: string;
  workspaceRoot: string;
  snapshot: WorkspaceFileSnapshot;
  route: CanonicalPathRouteIdentity;
  parentRoute: CanonicalPathRouteIdentity;
  leafDevice?: string;
  leafInode?: string;
  leafMode?: number;
  leafUid?: number;
  leafGid?: number;
}

export interface WorkspaceTextFileCommitToken {
  absPath: string;
  workspaceRoot: string;
  before: WorkspaceTextFileBaseline;
  after: WorkspaceTextFileBaseline;
}

export interface WorkspaceCommittedEdit extends WorkspaceAppliedEdit {
  commitToken: WorkspaceTextFileCommitToken;
}

export interface WorkspaceRollbackResult {
  rolledBack: boolean;
  reason?: string;
}

export interface WorkspaceEditApplyOptions {
  validateSourceSanity?: boolean;
  repairSourceTransportEscapes?: boolean;
}

export class WorkspaceEditValidationError extends Error {
  constructor(readonly absPath: string, readonly detail: string) {
    super(detail);
    this.name = 'WorkspaceEditValidationError';
  }
}

export class WorkspaceEditConflictError extends Error {
  constructor(readonly absPath: string, readonly detail: string) {
    super(detail);
    this.name = 'WorkspaceEditConflictError';
  }
}

export class WorkspaceEditService {
  proposeTextFileWrite(absPath: string, content: string): WorkspaceEditProposal {
    return {
      kind: 'write-text-file',
      absPath,
      content,
    };
  }

  snapshotTextFile(absPath: string): WorkspaceFileSnapshot {
    const existed = fs.existsSync(absPath);
    return {
      absPath,
      existed,
      content: existed ? fs.readFileSync(absPath, 'utf8') : '',
    };
  }

  captureTextFileBaseline(absPath: string, workspaceRoot: string): WorkspaceTextFileBaseline {
    const resolvedPath = nodePath.resolve(absPath);
    const resolvedRoot = nodePath.resolve(workspaceRoot);
    const routeBefore = captureCanonicalPathRouteIdentity(resolvedPath);
    const parentRouteBefore = captureCanonicalPathRouteIdentity(nodePath.dirname(resolvedPath));
    if (!routeBefore || !parentRouteBefore || !isCanonicalPathInsideRoot(resolvedPath, resolvedRoot)) {
      throw new WorkspaceEditConflictError(resolvedPath, 'workspace-edit-boundary: target escapes workspace or has an unresolved route');
    }

    let existed = false;
    let content = '';
    let leafDevice: string | undefined;
    let leafInode: string | undefined;
    let leafMode: number | undefined;
    let leafUid: number | undefined;
    let leafGid: number | undefined;
    let descriptor: number | undefined;
    try {
      try {
        const leaf = fs.lstatSync(resolvedPath, { bigint: true });
        if (leaf.isSymbolicLink()) {
          throw new WorkspaceEditConflictError(resolvedPath, 'workspace-edit-boundary: symbolic-link file targets are not writable');
        }
        if (!leaf.isFile()) {
          throw new WorkspaceEditConflictError(resolvedPath, 'workspace-edit-boundary: target exists but is not a regular file');
        }
        existed = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      if (existed) {
        descriptor = fs.openSync(resolvedPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        const stats = fs.fstatSync(descriptor, { bigint: true });
        if (!stats.isFile()) {
          throw new WorkspaceEditConflictError(resolvedPath, 'workspace-edit-boundary: opened target is not a regular file');
        }
        leafDevice = stats.dev.toString();
        leafInode = stats.ino.toString();
        leafMode = Number(stats.mode & BigInt(0o7777));
        leafUid = Number(stats.uid);
        leafGid = Number(stats.gid);
        content = fs.readFileSync(descriptor, 'utf8');
      }
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }

    const routeAfter = captureCanonicalPathRouteIdentity(resolvedPath);
    const parentRouteAfter = captureCanonicalPathRouteIdentity(nodePath.dirname(resolvedPath));
    if (!routeAfter
      || !parentRouteAfter
      || !isSameCanonicalPathRoute(routeBefore, routeAfter)
      || !isSameCanonicalPathRoute(parentRouteBefore, parentRouteAfter)) {
      throw new WorkspaceEditConflictError(resolvedPath, 'workspace-edit-boundary: target route changed while capturing the baseline');
    }
    return {
      absPath: resolvedPath,
      workspaceRoot: resolvedRoot,
      snapshot: { absPath: resolvedPath, existed, content },
      route: routeAfter,
      parentRoute: parentRouteAfter,
      ...(leafDevice && leafInode ? {
        leafDevice,
        leafInode,
        leafMode,
        leafUid,
        leafGid,
      } : {}),
    };
  }

  isTextFileBaselineCurrent(baseline: WorkspaceTextFileBaseline): boolean {
    try {
      return sameTextFileBaseline(
        baseline,
        this.captureTextFileBaseline(baseline.absPath, baseline.workspaceRoot),
      );
    } catch {
      return false;
    }
  }

  commitTextFileProposal(
    proposal: WorkspaceEditProposal,
    baseline: WorkspaceTextFileBaseline,
    options: WorkspaceEditApplyOptions = {},
  ): WorkspaceCommittedEdit {
    if (nodePath.resolve(proposal.absPath) !== baseline.absPath) {
      throw new WorkspaceEditConflictError(proposal.absPath, 'workspace-edit-boundary: proposal path does not match its captured baseline');
    }

    let appliedProposal = proposal;
    let normalization: WorkspaceWriteNormalization | undefined;
    if (options.repairSourceTransportEscapes) {
      const repaired = repairGeneratedSourceTransportEscapes(proposal.absPath, proposal.content);
      if (repaired.repaired) {
        appliedProposal = { ...proposal, content: repaired.content };
        normalization = {
          kind: 'source-transport-escape-repair',
          repairCount: repaired.repairCount,
        };
      }
    }
    if (options.validateSourceSanity) this.validateTextFileProposal(appliedProposal);

    const current = this.captureTextFileBaseline(baseline.absPath, baseline.workspaceRoot);
    if (!sameTextFileBaseline(baseline, current)) {
      throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: target changed after write authority was captured');
    }

    const parent = openAuthorizedParentDirectory(baseline);
    let temporary: AnchoredTemporaryFile | undefined;
    let rollbackTemporary: AnchoredTemporaryFile | undefined;
    let renamed = false;
    let committed = false;
    try {
      const commitBaseline = this.captureTextFileBaseline(baseline.absPath, baseline.workspaceRoot);
      if (!isAuthorizedBaselineTransition(baseline, commitBaseline)
        || !parentMatchesBaseline(parent, commitBaseline)) {
        throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: parent identity changed while preparing the commit');
      }
      assertAnchoredTargetMatches(parent, commitBaseline);
      const targetName = nodePath.basename(baseline.absPath);
      if (baseline.snapshot.existed) {
        rollbackTemporary = writeAnchoredTemporaryFile(parent, targetName, baseline.snapshot.content, {
          mode: baseline.leafMode,
          uid: baseline.leafUid,
          gid: baseline.leafGid,
        });
      }
      temporary = writeAnchoredTemporaryFile(parent, targetName, appliedProposal.content, baseline.snapshot.existed
        ? { mode: baseline.leafMode, uid: baseline.leafUid, gid: baseline.leafGid }
        : undefined);
      if (!this.isTextFileBaselineCurrent(commitBaseline)) {
        throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: target changed while staging the atomic commit');
      }
      assertAnchoredTargetMatches(parent, commitBaseline);
      fs.renameSync(temporary.path, anchoredChildPath(parent, targetName));
      renamed = true;
      let after: WorkspaceTextFileBaseline;
      try {
        fsyncDirectoryBestEffort(parent.directoryFd);
        after = this.captureTextFileBaseline(baseline.absPath, baseline.workspaceRoot);
        if (!after.snapshot.existed
          || after.snapshot.content !== appliedProposal.content
          || !parentMatchesBaseline(parent, after)
          || after.leafDevice !== temporary.device
          || after.leafInode !== temporary.inode) {
          throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: committed content failed independent identity/readback verification');
        }
      } catch (error) {
        const restored = restoreBaselineAtAnchor(parent, baseline, temporary, rollbackTemporary);
        renamed = false;
        if (restored) throw error;
        throw new WorkspaceEditConflictError(
          baseline.absPath,
          `workspace-edit-boundary: commit state became indeterminate after post-rename failure: ${(error as Error).message}`,
        );
      }
      const result: WorkspaceWriteResult = {
        existed: baseline.snapshot.existed,
        oldContent: baseline.snapshot.content,
        newContent: appliedProposal.content,
        ...(normalization ? { normalization } : {}),
      };
      committed = true;
      return {
        proposal: appliedProposal,
        snapshot: baseline.snapshot,
        result,
        commitToken: {
          absPath: baseline.absPath,
          workspaceRoot: baseline.workspaceRoot,
          before: baseline,
          after,
        },
      };
    } finally {
      if (temporary && !renamed) removeAnchoredTemporaryFile(parent, temporary);
      if (rollbackTemporary) removeAnchoredTemporaryFile(parent, rollbackTemporary);
      if (!committed) cleanupCreatedDirectories(parent);
      closeAuthorizedParentDirectory(parent);
    }
  }

  rollbackTextFileCommit(token: WorkspaceTextFileCommitToken): WorkspaceRollbackResult {
    let current: WorkspaceTextFileBaseline;
    try {
      current = this.captureTextFileBaseline(token.absPath, token.workspaceRoot);
    } catch (error) {
      return { rolledBack: false, reason: `rollback-aborted: ${(error as Error).message}` };
    }
    if (!sameTextFileBaseline(token.after, current)) {
      return { rolledBack: false, reason: 'rollback-aborted: target route, identity, or content changed after commit' };
    }

    let parent: AuthorizedParentDirectory | undefined;
    let temporary: AnchoredTemporaryFile | undefined;
    let renamed = false;
    try {
      parent = openAuthorizedParentDirectory(token.after);
      if (!parentMatchesBaseline(parent, token.after)) {
        return { rolledBack: false, reason: 'rollback-aborted: parent identity differs from commit token' };
      }
      assertAnchoredTargetMatches(parent, token.after);
      const targetName = nodePath.basename(token.absPath);
      if (token.before.snapshot.existed) {
        temporary = writeAnchoredTemporaryFile(parent, targetName, token.before.snapshot.content, {
          mode: token.before.leafMode,
          uid: token.before.leafUid,
          gid: token.before.leafGid,
        });
        if (!this.isTextFileBaselineCurrent(token.after)) {
          return { rolledBack: false, reason: 'rollback-aborted: target changed while staging rollback' };
        }
        assertAnchoredTargetMatches(parent, token.after);
        fs.renameSync(temporary.path, anchoredChildPath(parent, targetName));
        renamed = true;
      } else {
        if (!this.isTextFileBaselineCurrent(token.after)) {
          return { rolledBack: false, reason: 'rollback-aborted: target changed before delete rollback' };
        }
        fs.unlinkSync(anchoredChildPath(parent, targetName));
      }
      fsyncDirectoryBestEffort(parent.directoryFd);
      return { rolledBack: true };
    } catch (error) {
      return { rolledBack: false, reason: `rollback-failed: ${(error as Error).message}` };
    } finally {
      if (parent && temporary && !renamed) removeAnchoredTemporaryFile(parent, temporary);
      if (parent) closeAuthorizedParentDirectory(parent);
    }
  }

  validateTextFileProposal(proposal: WorkspaceEditProposal): void {
    const issue = findGeneratedSourceSanityIssue(proposal.absPath, proposal.content);
    if (!issue) return;
    throw new WorkspaceEditValidationError(proposal.absPath, issue.detail);
  }

  applyTextFileProposal(
    proposal: WorkspaceEditProposal,
    snapshot = this.snapshotTextFile(proposal.absPath),
    options: WorkspaceEditApplyOptions = {},
  ): WorkspaceAppliedEdit {
    let appliedProposal = proposal;
    let normalization: WorkspaceWriteNormalization | undefined;
    if (options.repairSourceTransportEscapes) {
      const repaired = repairGeneratedSourceTransportEscapes(proposal.absPath, proposal.content);
      if (repaired.repaired) {
        appliedProposal = { ...proposal, content: repaired.content };
        normalization = {
          kind: 'source-transport-escape-repair',
          repairCount: repaired.repairCount,
        };
      }
    }
    if (options.validateSourceSanity) {
      this.validateTextFileProposal(appliedProposal);
    }
    const dir = nodePath.dirname(appliedProposal.absPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(appliedProposal.absPath, appliedProposal.content, 'utf8');
    return {
      proposal: appliedProposal,
      snapshot,
      result: {
        existed: snapshot.existed,
        oldContent: snapshot.content,
        newContent: appliedProposal.content,
        ...(normalization ? { normalization } : {}),
      },
    };
  }

  writeTextFileSync(absPath: string, content: string, options: WorkspaceEditApplyOptions = {}): WorkspaceWriteResult {
    return this.applyTextFileProposal(this.proposeTextFileWrite(absPath, content), undefined, options).result;
  }
}

interface CreatedDirectoryAnchor {
  parentFd: number;
  name: string;
  device: string;
  inode: string;
}

interface AuthorizedParentDirectory {
  directoryFd: number;
  directoryCanonicalPath: string;
  openFds: number[];
  createdDirectories: CreatedDirectoryAnchor[];
  useProcFd: boolean;
}

interface AnchoredTemporaryFile {
  path: string;
  name: string;
  device: string;
  inode: string;
}

function openAuthorizedParentDirectory(baseline: WorkspaceTextFileBaseline): AuthorizedParentDirectory {
  const route = baseline.parentRoute;
  if (route.existingAncestorFingerprint.endsWith(':symlink')) {
    throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: symlink parent routes are not writable');
  }
  const useProcFd = process.platform === 'linux' && fs.existsSync('/proc/self/fd');
  if (!useProcFd && route.missingSegments.length > 0) {
    throw new WorkspaceEditConflictError(
      baseline.absPath,
      'workspace-edit-boundary: secure parent creation is unavailable on this platform',
    );
  }

  const openFds: number[] = [];
  const createdDirectories: CreatedDirectoryAnchor[] = [];
  let directoryFd: number | undefined;
  let directoryCanonicalPath = route.existingAncestorCanonicalPath;
  try {
    directoryFd = fs.openSync(
      route.existingAncestorCanonicalPath,
      fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0),
    );
    openFds.push(directoryFd);
    const ancestor = fs.fstatSync(directoryFd, { bigint: true });
    if (!ancestor.isDirectory()
      || ancestor.dev.toString() !== route.existingAncestorDevice
      || ancestor.ino.toString() !== route.existingAncestorInode) {
      throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: opened parent ancestor differs from the authorized route');
    }

    for (const segment of route.missingSegments) {
      if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) {
        throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: unsafe missing parent segment');
      }
      const childPath = anchoredDirectoryPath(directoryFd, directoryCanonicalPath, segment, useProcFd);
      fs.mkdirSync(childPath);
      const childFd = fs.openSync(
        childPath,
        fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0),
      );
      const child = fs.fstatSync(childFd, { bigint: true });
      if (!child.isDirectory()) {
        fs.closeSync(childFd);
        throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: created parent segment is not a directory');
      }
      createdDirectories.push({
        parentFd: directoryFd,
        name: segment,
        device: child.dev.toString(),
        inode: child.ino.toString(),
      });
      directoryCanonicalPath = nodePath.join(directoryCanonicalPath, segment);
      directoryFd = childFd;
      openFds.push(childFd);
    }

    if (!isCanonicalPathInsideRoot(directoryCanonicalPath, baseline.workspaceRoot)) {
      throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: authorized parent escaped workspace');
    }
    return { directoryFd, directoryCanonicalPath, openFds, createdDirectories, useProcFd };
  } catch (error) {
    const partial: AuthorizedParentDirectory | undefined = directoryFd === undefined
      ? undefined
      : { directoryFd, directoryCanonicalPath, openFds, createdDirectories, useProcFd };
    if (partial) {
      cleanupCreatedDirectories(partial);
      closeAuthorizedParentDirectory(partial);
    }
    throw error;
  }
}

function closeAuthorizedParentDirectory(parent: AuthorizedParentDirectory): void {
  for (const descriptor of [...parent.openFds].reverse()) {
    try { fs.closeSync(descriptor); } catch { /* already closed */ }
  }
  parent.openFds.length = 0;
}

function fsyncDirectoryBestEffort(directoryFd: number): void {
  try {
    fs.fsyncSync(directoryFd);
  } catch {
    // The file payload is already fsynced and the rename is visible. Directory
    // durability errors must not rewrite a successful logical commit as failed.
  }
}

function cleanupCreatedDirectories(parent: AuthorizedParentDirectory): void {
  for (const created of [...parent.createdDirectories].reverse()) {
    try {
      const pathValue = anchoredDirectoryPath(
        created.parentFd,
        '',
        created.name,
        parent.useProcFd,
      );
      const stats = fs.lstatSync(pathValue, { bigint: true });
      if (stats.isDirectory()
        && stats.dev.toString() === created.device
        && stats.ino.toString() === created.inode) {
        fs.rmdirSync(pathValue);
      }
    } catch {
      // Only remove an empty directory whose inode still matches our creation.
    }
  }
}

function anchoredDirectoryPath(
  directoryFd: number,
  canonicalDirectory: string,
  childName: string,
  useProcFd: boolean,
): string {
  return nodePath.join(useProcFd ? `/proc/self/fd/${directoryFd}` : canonicalDirectory, childName);
}

function anchoredChildPath(parent: AuthorizedParentDirectory, childName: string): string {
  return anchoredDirectoryPath(
    parent.directoryFd,
    parent.directoryCanonicalPath,
    childName,
    parent.useProcFd,
  );
}

function parentMatchesBaseline(
  parent: AuthorizedParentDirectory,
  baseline: WorkspaceTextFileBaseline,
): boolean {
  try {
    const stats = fs.fstatSync(parent.directoryFd, { bigint: true });
    return baseline.parentRoute.missingSegments.length === 0
      && baseline.parentRoute.canonicalPath === parent.directoryCanonicalPath
      && stats.isDirectory()
      && stats.dev.toString() === baseline.parentRoute.existingAncestorDevice
      && stats.ino.toString() === baseline.parentRoute.existingAncestorInode;
  } catch {
    return false;
  }
}

function isAuthorizedBaselineTransition(
  authorized: WorkspaceTextFileBaseline,
  commit: WorkspaceTextFileBaseline,
): boolean {
  if (authorized.snapshot.existed) return sameTextFileBaseline(authorized, commit);
  return !commit.snapshot.existed
    && authorized.absPath === commit.absPath
    && authorized.workspaceRoot === commit.workspaceRoot
    && authorized.route.canonicalPath === commit.route.canonicalPath;
}

function assertAnchoredTargetMatches(
  parent: AuthorizedParentDirectory,
  baseline: WorkspaceTextFileBaseline,
): void {
  const targetPath = anchoredChildPath(parent, nodePath.basename(baseline.absPath));
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    if (!baseline.snapshot.existed) {
      throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: target was created after authorization');
    }
    const stats = fs.fstatSync(descriptor, { bigint: true });
    const content = fs.readFileSync(descriptor, 'utf8');
    if (!stats.isFile()
      || stats.dev.toString() !== baseline.leafDevice
      || stats.ino.toString() !== baseline.leafInode
      || content !== baseline.snapshot.content) {
      throw new WorkspaceEditConflictError(baseline.absPath, 'workspace-edit-boundary: anchored target differs from authorized baseline');
    }
  } catch (error) {
    if (!baseline.snapshot.existed && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function writeAnchoredTemporaryFile(
  parent: AuthorizedParentDirectory,
  targetName: string,
  content: string,
  metadata?: { mode?: number; uid?: number; gid?: number },
): AnchoredTemporaryFile {
  const name = `.${targetName}.devseek-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}.tmp`;
  const pathValue = anchoredChildPath(parent, name);
  let descriptor: number | undefined;
  let identity: { device: string; inode: string } | undefined;
  try {
    descriptor = fs.openSync(
      pathValue,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW || 0),
      metadata?.mode ?? 0o666,
    );
    if (metadata?.mode !== undefined) fs.fchmodSync(descriptor, metadata.mode);
    if (metadata?.uid !== undefined && metadata?.gid !== undefined) {
      const current = fs.fstatSync(descriptor, { bigint: true });
      if (Number(current.uid) !== metadata.uid || Number(current.gid) !== metadata.gid) {
        fs.fchownSync(descriptor, metadata.uid, metadata.gid);
      }
    }
    const stats = fs.fstatSync(descriptor, { bigint: true });
    identity = { device: stats.dev.toString(), inode: stats.ino.toString() };
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    return { path: pathValue, name, ...identity };
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* already closed */ }
      descriptor = undefined;
    }
    if (identity) removeAnchoredTemporaryFile(parent, { path: pathValue, name, ...identity });
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function removeAnchoredTemporaryFile(
  parent: AuthorizedParentDirectory,
  temporary: AnchoredTemporaryFile,
): void {
  try {
    const stats = fs.lstatSync(temporary.path, { bigint: true });
    if (stats.isFile()
      && stats.dev.toString() === temporary.device
      && stats.ino.toString() === temporary.inode) {
      fs.unlinkSync(temporary.path);
    }
  } catch {
    // Never remove a path whose identity no longer matches our staged file.
  }
}

function restoreBaselineAtAnchor(
  parent: AuthorizedParentDirectory,
  baseline: WorkspaceTextFileBaseline,
  committed: AnchoredTemporaryFile,
  rollbackTemporary?: AnchoredTemporaryFile,
): boolean {
  const targetPath = anchoredChildPath(parent, nodePath.basename(baseline.absPath));
  try {
    const stats = fs.lstatSync(targetPath, { bigint: true });
    if (!stats.isFile()
      || stats.dev.toString() !== committed.device
      || stats.ino.toString() !== committed.inode) return false;
    if (!baseline.snapshot.existed) {
      fs.unlinkSync(targetPath);
      try {
        fs.lstatSync(targetPath);
        return false;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT';
      }
    }
    if (!rollbackTemporary) return false;
    fs.renameSync(rollbackTemporary.path, targetPath);
    const restored = fs.lstatSync(targetPath, { bigint: true });
    if (!restored.isFile()
      || restored.dev.toString() !== rollbackTemporary.device
      || restored.ino.toString() !== rollbackTemporary.inode) return false;
    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(targetPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      return fs.readFileSync(descriptor, 'utf8') === baseline.snapshot.content;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  } catch {
    return false;
  }
}

function sameTextFileBaseline(left: WorkspaceTextFileBaseline, right: WorkspaceTextFileBaseline): boolean {
  return left.absPath === right.absPath
    && left.workspaceRoot === right.workspaceRoot
    && left.snapshot.existed === right.snapshot.existed
    && left.snapshot.content === right.snapshot.content
    && left.leafDevice === right.leafDevice
    && left.leafInode === right.leafInode
    && left.leafMode === right.leafMode
    && left.leafUid === right.leafUid
    && left.leafGid === right.leafGid
    && isSameCanonicalPathRoute(left.route, right.route)
    && isSameCanonicalPathRoute(left.parentRoute, right.parentRoute);
}
