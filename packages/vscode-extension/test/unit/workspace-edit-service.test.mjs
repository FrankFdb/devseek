/**
 * Unit tests for workspace/edit-service.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
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

test('WorkspaceEditService: creates parent directories and writes text files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'nested', 'hello.txt');
    const service = new WorkspaceEditService();
    const result = service.writeTextFileSync(target, 'hello');
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
    service.writeTextFileSync(target, 'old');
    const result = service.writeTextFileSync(target, 'new');
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

test('WorkspaceEditService: snapshots file state before applying a proposal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'hello.txt');
    const service = new WorkspaceEditService();

    assert.deepEqual(service.snapshotTextFile(target), {
      absPath: target,
      existed: false,
      content: '',
    });

    service.writeTextFileSync(target, 'old');
    assert.deepEqual(service.snapshotTextFile(target), {
      absPath: target,
      existed: true,
      content: 'old',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('WorkspaceEditService: applies proposals with attached snapshot evidence', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'nested', 'hello.txt');
    const service = new WorkspaceEditService();
    const proposal = service.proposeTextFileWrite(target, 'new');
    const applied = service.applyTextFileProposal(proposal);

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

test('WorkspaceEditService: validates generated C++ source before writing when requested', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-edit-service-'));
  try {
    const target = path.join(dir, 'main.cpp');
    const service = new WorkspaceEditService();
    assert.throws(
      () => service.writeTextFileSync(target, [
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
    const result = service.writeTextFileSync(target, [
      '#include <cstdio>',
      'int main() {',
      '  printf("ready',
      '");',
      '}',
    ].join('\n'), {
      validateSourceSanity: true,
      repairSourceTransportEscapes: true,
    });

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
      () => service.writeTextFileSync(target, [
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
      () => service.writeTextFileSync(target, [
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
    service.writeTextFileSync(target, [
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

function readFileSyncSafe(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

console.log('\nWorkspace edit service tests passed.\n');
