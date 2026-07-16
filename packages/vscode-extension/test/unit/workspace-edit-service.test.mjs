/**
 * Unit tests for workspace/edit-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/workspace-edit-service.bundle.cjs');

execSync(
  `npx esbuild src/workspace/edit-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' }
);

const req = createRequire(import.meta.url);
const { WorkspaceEditService } = req(bundlePath);

function commitText(service, target, workspaceRoot, content, options = {}) {
  const baseline = service.captureTextFileBaseline(target, workspaceRoot);
  return service.commitTextFileProposal(
    service.proposeTextFileWrite(target, content),
    baseline,
    options,
  );
}

test('WorkspaceEditService: creates parent directories and writes text files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'nested', 'hello.txt');
    const service = new WorkspaceEditService();
    const result = commitText(service, target, dir, 'hello').result;
    assert.deepEqual(result, { existed: false, oldContent: '', newContent: 'hello' });
    assert.equal(readFileSync(target, 'utf8'), 'hello');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: returns old content when overwriting', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'hello.txt');
    const service = new WorkspaceEditService();
    commitText(service, target, dir, 'old');
    const result = commitText(service, target, dir, 'new').result;
    assert.deepEqual(result, { existed: true, oldContent: 'old', newContent: 'new' });
    assert.equal(readFileSync(target, 'utf8'), 'new');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: proposes text writes without touching disk', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'draft.txt');
    const service = new WorkspaceEditService();
    const proposal = service.proposeTextFileWrite(target, 'draft');

    assert.equal(proposal.kind, 'write-text-file');
    assert.equal(proposal.absPath, target);
    assert.equal(proposal.content, 'draft');
    assert.equal(readFileSyncSafe(target), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: captures file state and route identity before committing a proposal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'hello.txt');
    const service = new WorkspaceEditService();

    assert.deepEqual(service.captureTextFileBaseline(target, dir).snapshot, {
      absPath: target,
      existed: false,
      content: '',
    });

    commitText(service, target, dir, 'old');
    assert.deepEqual(service.captureTextFileBaseline(target, dir).snapshot, {
      absPath: target,
      existed: true,
      content: 'old',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: commits proposals with attached baseline evidence', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'nested', 'hello.txt');
    const service = new WorkspaceEditService();
    const proposal = service.proposeTextFileWrite(target, 'new');
    const baseline = service.captureTextFileBaseline(target, dir);
    const applied = service.commitTextFileProposal(proposal, baseline);

    assert.equal(applied.proposal, proposal);
    assert.deepEqual(applied.snapshot, {
      absPath: target,
      existed: false,
      content: '',
    });
    assert.deepEqual(applied.result, {
      existed: false,
      oldContent: '',
      newContent: 'new',
    });
    assert.equal(readFileSync(target, 'utf8'), 'new');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: secure commit is CAS-bound, atomic, mode-preserving, and rollback-tokened', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-secure-'));
  const target = path.join(dir, 'hello.txt');
  try {
    writeFileSync(target, 'old');
    chmodSync(target, 0o644);
    const service = new WorkspaceEditService();
    const baseline = service.captureTextFileBaseline(target, dir);
    const committed = service.commitTextFileProposal(service.proposeTextFileWrite(target, 'new'), baseline);

    assert.equal(readFileSync(target, 'utf8'), 'new');
    assert.equal(statSync(target).mode & 0o777, 0o644);
    assert.deepEqual(committed.result, { existed: true, oldContent: 'old', newContent: 'new' });
    assert.deepEqual(service.rollbackTextFileCommit(committed.commitToken), { rolledBack: true });
    assert.equal(readFileSync(target, 'utf8'), 'old');
    assert.equal(statSync(target).mode & 0o777, 0o644);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: secure commit creates missing parents through an anchored directory handle', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-secure-parent-'));
  const target = path.join(dir, 'nested', 'deeper', 'hello.txt');
  try {
    const service = new WorkspaceEditService();
    const baseline = service.captureTextFileBaseline(target, dir);
    const committed = service.commitTextFileProposal(service.proposeTextFileWrite(target, 'hello'), baseline);

    assert.equal(readFileSync(target, 'utf8'), 'hello');
    assert.equal(statSync(target).mode & 0o777, 0o666 & ~process.umask());
    assert.equal(committed.result.existed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: secure commit rejects a stale baseline without overwriting newer content', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-conflict-'));
  const target = path.join(dir, 'hello.txt');
  try {
    writeFileSync(target, 'old');
    const service = new WorkspaceEditService();
    const baseline = service.captureTextFileBaseline(target, dir);
    writeFileSync(target, 'newer-user-content');
    assert.throws(
      () => service.commitTextFileProposal(service.proposeTextFileWrite(target, 'agent-content'), baseline),
      /target changed after write authority was captured/,
    );
    assert.equal(readFileSync(target, 'utf8'), 'newer-user-content');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: secure commit rejects a missing target swapped to an outside symlink', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-symlink-root-'));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-symlink-outside-'));
  const target = path.join(workspaceRoot, 'hello.txt');
  const outsideTarget = path.join(outsideRoot, 'outside.txt');
  try {
    writeFileSync(outsideTarget, 'outside-content');
    const service = new WorkspaceEditService();
    const baseline = service.captureTextFileBaseline(target, workspaceRoot);
    symlinkSync(outsideTarget, target, 'file');

    assert.throws(
      () => service.commitTextFileProposal(service.proposeTextFileWrite(target, 'agent-content'), baseline),
      /symbolic-link|target changed|route changed|boundary/i,
    );
    assert.equal(readFileSync(outsideTarget, 'utf8'), 'outside-content');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: secure commit rejects an existing target swapped to a symlink', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-leaf-swap-root-'));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-leaf-swap-outside-'));
  const target = path.join(workspaceRoot, 'hello.txt');
  const outsideTarget = path.join(outsideRoot, 'outside.txt');
  try {
    writeFileSync(target, 'old');
    writeFileSync(outsideTarget, 'outside-content');
    const service = new WorkspaceEditService();
    const baseline = service.captureTextFileBaseline(target, workspaceRoot);
    unlinkSync(target);
    symlinkSync(outsideTarget, target, 'file');

    assert.throws(
      () => service.commitTextFileProposal(service.proposeTextFileWrite(target, 'agent-content'), baseline),
      /symbolic-link|target changed|route changed|boundary/i,
    );
    assert.equal(readFileSync(outsideTarget, 'utf8'), 'outside-content');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: secure commit rejects parent-directory replacement after baseline capture', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-parent-swap-'));
  const parent = path.join(workspaceRoot, 'safe');
  const movedParent = path.join(workspaceRoot, 'safe-before-swap');
  const target = path.join(parent, 'hello.txt');
  try {
    mkdirSync(parent);
    writeFileSync(target, 'old');
    const service = new WorkspaceEditService();
    const baseline = service.captureTextFileBaseline(target, workspaceRoot);
    renameSync(parent, movedParent);
    mkdirSync(parent);

    assert.throws(
      () => service.commitTextFileProposal(service.proposeTextFileWrite(target, 'agent-content'), baseline),
      /target changed|parent identity|route changed|boundary/i,
    );
    assert.equal(readFileSync(path.join(movedParent, 'hello.txt'), 'utf8'), 'old');
    assert.equal(readFileSyncSafe(target), undefined);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: validates generated C++ source before writing when requested', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'main.cpp');
    const service = new WorkspaceEditService();
    assert.throws(
      () => commitText(service, target, dir, [
        '#include <iostream>',
        'int main() {',
        '  std::cout << "',
        'broken";',
        '}',
      ].join('\n'), { validateSourceSanity: true }),
      /字符串字面量/,
    );
    assert.equal(readFileSyncSafe(target), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: repairs source transport escapes before validation when requested', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'main.cpp');
    const service = new WorkspaceEditService();
    const result = commitText(service, target, dir, [
      '#include <cstdio>',
      'int main() {',
      '  printf("ready',
      '");',
      '}',
    ].join('\n'), {
      validateSourceSanity: true,
      repairSourceTransportEscapes: true,
    }).result;

    assert.equal(result.normalization?.kind, 'source-transport-escape-repair');
    assert.equal(result.normalization?.repairCount, 1);
    assert.match(readFileSync(target, 'utf8'), /printf\("ready\\n"\);/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: blocks tool protocol contamination in generated C++ source', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'proc_license_main.cpp');
    const service = new WorkspaceEditService();
    assert.throws(
      () => commitText(service, target, dir, [
        '#include <iostream>',
        'int main() { return 0; }[调用 create_file] {"path":"/workspace/docs/out.md","content":"# report"}',
      ].join('\n'), {
        validateSourceSanity: true,
        repairSourceTransportEscapes: true,
      }),
      /工具调用协议文本/,
    );
    assert.equal(readFileSyncSafe(target), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: blocks C++ preprocessor directives collapsed onto one line', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'MaintenanceTypes.hpp');
    const service = new WorkspaceEditService();
    assert.throws(
      () => commitText(service, target, dir, [
        '#ifndef MAINTENANCE_TYPES_HPP#define MAINTENANCE_TYPES_HPP',
        '#include <cstddef>#include <cstdint>',
        '#pragma pack(push, 1)struct Header { int value; };#pragma pack(pop)',
        '#endif',
      ].join('\n'), {
        validateSourceSanity: true,
        repairSourceTransportEscapes: true,
      }),
      /预处理指令必须独占物理行/,
    );
    assert.equal(readFileSyncSafe(target), undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: allows valid preprocessor directives and macro stringification', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'valid.hpp');
    const service = new WorkspaceEditService();
    commitText(service, target, dir, [
      '#pragma once',
      '#include <cstdint>',
      '#define STRINGIFY_INNER(x) #x',
      '#define STRINGIFY(x) STRINGIFY_INNER(x)',
      'struct Header { std::uint8_t value; };',
    ].join('\n'), { validateSourceSanity: true });
    assert.match(readFileSync(target, 'utf8'), /struct Header/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: directory creation uses canonical containment, not a string prefix', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'devseek-directory-boundary-'));
  const workspaceRoot = path.join(parent, 'workspace');
  const prefixSibling = path.join(parent, 'workspace-evil');
  mkdirSync(workspaceRoot);
  mkdirSync(prefixSibling);
  try {
    const target = path.join(prefixSibling, 'created-by-prefix-bypass');
    assert.throws(
      () => new WorkspaceEditService().createWorkspaceDirectory(target, workspaceRoot),
      /escapes workspace|boundary/,
    );
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: directory creation rejects a workspace symlink escape', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-directory-workspace-'));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), 'devseek-directory-outside-'));
  try {
    symlinkSync(outsideRoot, path.join(workspaceRoot, 'linked'), 'dir');
    const target = path.join(workspaceRoot, 'linked', 'outside-child');
    assert.throws(
      () => new WorkspaceEditService().createWorkspaceDirectory(target, workspaceRoot),
      /changed before commit|escapes workspace|canonical|symbolic/i,
    );
    assert.equal(existsSync(path.join(outsideRoot, 'outside-child')), false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
    rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: directory creation supports missing anchored parents and verifies readback', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-directory-workspace-'));
  try {
    const target = path.join(workspaceRoot, 'one', 'two', 'three');
    const result = new WorkspaceEditService().createWorkspaceDirectory(target, workspaceRoot);
    assert.equal(result.created, true);
    assert.equal(statSync(result.canonicalPath).isDirectory(), true);
    assert.equal(result.canonicalPath, target);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: directory creation returns route, absence and inode commit evidence', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-directory-transaction-'));
  try {
    const target = path.join(workspaceRoot, 'one', 'two', 'three');
    const result = new WorkspaceEditService().createWorkspaceDirectory(target, workspaceRoot);

    assert.equal(result.created, true);
    assert.equal(result.commitToken.absPath, target);
    assert.equal(result.commitToken.workspaceRoot, workspaceRoot);
    assert.equal(result.commitToken.before.snapshot.existed, false);
    assert.deepEqual(result.commitToken.before.route.missingSegments, ['one', 'two', 'three']);
    assert.equal(result.commitToken.after.snapshot.existed, true);
    assert.equal(result.commitToken.after.snapshot.canonicalPath, target);
    assert.match(result.commitToken.after.snapshot.device, /^\d+$/);
    assert.match(result.commitToken.after.snapshot.inode, /^\d+$/);
    assert.equal(statSync(target).ino.toString(), result.commitToken.after.snapshot.inode);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: delete returns CAS-bound content, inode and absence commit evidence', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-delete-transaction-'));
  try {
    const target = path.join(workspaceRoot, 'obsolete.txt');
    writeFileSync(target, 'delete me\n', 'utf8');
    const before = statSync(target);

    const result = new WorkspaceEditService().deleteTextFile(target, workspaceRoot);

    assert.equal(result.deleted, true);
    assert.equal(result.commitToken.absPath, target);
    assert.equal(result.commitToken.workspaceRoot, workspaceRoot);
    assert.equal(result.commitToken.before.snapshot.existed, true);
    assert.equal(result.commitToken.before.snapshot.content, 'delete me\n');
    assert.equal(result.commitToken.before.leafInode, before.ino.toString());
    assert.equal(result.commitToken.after.snapshot.existed, false);
    assert.equal(result.commitToken.after.snapshot.content, '');
    assert.equal(existsSync(target), false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

function readFileSyncSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

console.log('\nWorkspace edit service tests passed.\n');
