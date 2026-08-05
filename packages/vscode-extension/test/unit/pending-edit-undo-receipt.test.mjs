import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/pending-edit-undo-receipt.bundle.cjs');

execSync(
  `npx esbuild src/app/pending-edit-undo-receipt.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  buildPendingEditResolutionProof,
  buildPendingEditUndoProof,
} = req(bundlePath);

function baseline({ existed, content, inode }) {
  return {
    absPath: '/workspace/src/generated.txt',
    workspaceRoot: '/workspace',
    snapshot: { absPath: '/workspace/src/generated.txt', existed, content },
    route: {
      canonicalPath: '/workspace/src/generated.txt',
      existingAncestorCanonicalPath: '/workspace/src',
      existingAncestorDevice: '8',
      existingAncestorInode: '80',
      existingAncestorFingerprint: '8:80',
      missingSegments: [],
    },
    parentRoute: {
      canonicalPath: '/workspace/src',
      existingAncestorCanonicalPath: '/workspace/src',
      existingAncestorDevice: '8',
      existingAncestorInode: '80',
      existingAncestorFingerprint: '8:80',
      missingSegments: [],
    },
    ...(inode ? { leafDevice: '8', leafInode: inode, leafMode: 0o644 } : {}),
  };
}

function canonicalReceipt(actionId) {
  return {
    version: 'devseek.coding-workspace-mutation-receipt/v1',
    runId: 'pending-run-1',
    sequence: 1,
    actionId,
    idempotencyKey: `pending-run-1:${actionId}`,
    status: 'committed',
    paths: ['src/generated.txt'],
    baselineRef: `vscode-text-baseline:${actionId}`,
    readbackRef: `vscode-text-readback:${actionId}`,
    evidenceRefs: [`pending-edit-authority:${actionId}`, `workspace-readback:${actionId}`],
  };
}

test('Pending edit undo receipt binds record, operation and commit-token evidence', () => {
  const proof = buildPendingEditUndoProof({
    recordId: 'pending-1',
    recordPath: 'src/generated.txt',
    expectedContentLength: 0,
    postcondition: 'absent',
    transaction: {
      operation: 'delete-created-file',
      targetPath: '/workspace/src/generated.txt',
      result: {
        deleted: true,
        commitToken: {
          absPath: '/workspace/src/generated.txt',
          workspaceRoot: '/workspace',
          before: baseline({ existed: true, content: 'generated\n', inode: '81' }),
          after: baseline({ existed: false, content: '', inode: undefined }),
        },
      },
      canonicalReceipt: canonicalReceipt('delete-pending-1'),
    },
  });

  assert.equal(proof.kind, 'workspace-pending-edit-undo-transaction');
  assert.equal(proof.record_id, 'pending-1');
  assert.equal(proof.record_path, 'src/generated.txt');
  assert.equal(proof.operation, 'delete-created-file');
  assert.equal(proof.postcondition, 'absent');
  assert.equal(proof.expected_content_length, 0);
  assert.equal(proof.commit_token.before.existed, true);
  assert.equal(proof.commit_token.before.content_sha256.length, 64);
  assert.equal(proof.commit_token.before.leaf_inode, '81');
  assert.equal(proof.commit_token.after.existed, false);
  assert.equal(proof.commit_token.after.content_length, 0);
  assert.equal(proof.canonical_mutation_receipt.action_id, 'delete-pending-1');
  assert.match(proof.canonical_mutation_receipt.readback_ref, /^vscode-text-readback:/);
});

test('R2-09B pending edit receipt binds hunk undo scope to mutation commit evidence', () => {
  const proof = buildPendingEditResolutionProof({
    action: 'undo',
    scope: 'hunk',
    recordId: 'pending-2',
    recordPath: 'src/generated.txt',
    expectedContentLength: 4,
    postcondition: 'content-readback',
    selectedHunk: {
      id: 'pending-2-h2',
      index: 2,
      title: '修改点 2',
      resolution: 'undone',
      oldStart: 5,
      oldEnd: 6,
      newStart: 5,
      newEnd: 6,
      oldLineCount: 1,
      newLineCount: 1,
    },
    transaction: {
      operation: 'restore-text-file',
      targetPath: '/workspace/src/generated.txt',
      result: {
        proposal: { kind: 'write-text-file', absPath: '/workspace/src/generated.txt', content: 'old\n' },
        snapshot: { absPath: '/workspace/src/generated.txt', existed: true, content: 'new\n' },
        result: { existed: true, oldContent: 'new\n', newContent: 'old\n' },
        commitToken: {
          absPath: '/workspace/src/generated.txt',
          workspaceRoot: '/workspace',
          before: baseline({ existed: true, content: 'new\n', inode: '82' }),
          after: baseline({ existed: true, content: 'old\n', inode: '83' }),
        },
      },
      canonicalReceipt: canonicalReceipt('restore-pending-2-h2'),
    },
  });

  assert.equal(proof.action, 'undo');
  assert.equal(proof.scope, 'hunk');
  assert.equal(proof.selected_hunk.id, 'pending-2-h2');
  assert.equal(proof.selected_hunk.resolution, 'undone');
  assert.equal(proof.commit_token.after.content_sha256.length, 64);
  assert.equal(proof.canonical_mutation_receipt.status, 'committed');
  assert.equal(proof.resolution_fingerprint.length, 64);
});

test('R2-09B pending edit keep receipt binds file/all resolution to source commit evidence', () => {
  const sourceCommitToken = {
    absPath: '/workspace/src/generated.txt',
    workspaceRoot: '/workspace',
    before: baseline({ existed: false, content: '', inode: undefined }),
    after: baseline({ existed: true, content: 'generated\n', inode: '81' }),
  };
  const resolvedHunks = [{
    id: 'pending-3-h1',
    index: 1,
    title: '修改点 1',
    resolution: 'kept',
    oldStart: 1,
    oldEnd: 1,
    newStart: 1,
    newEnd: 2,
    oldLineCount: 0,
    newLineCount: 1,
  }];
  const fileProof = buildPendingEditResolutionProof({
    action: 'keep',
    scope: 'file',
    recordId: 'pending-3',
    recordPath: 'src/generated.txt',
    targetPath: '/workspace/src/generated.txt',
    expectedContentLength: 'generated\n'.length,
    sourceCommitToken,
    resolvedHunks,
  });
  const allProof = buildPendingEditResolutionProof({
    action: 'keep',
    scope: 'all',
    recordId: 'pending-3',
    recordPath: 'src/generated.txt',
    targetPath: '/workspace/src/generated.txt',
    expectedContentLength: 'generated\n'.length,
    sourceCommitToken,
    allRecordIds: ['pending-3', 'pending-4'],
    resolvedHunks,
  });

  assert.equal(fileProof.kind, 'workspace-pending-edit-keep-receipt');
  assert.equal(fileProof.source_commit_token.after.leaf_inode, '81');
  assert.equal(fileProof.commit_token, undefined);
  assert.deepEqual(fileProof.resolved_hunks.map(hunk => [hunk.id, hunk.resolution]), [['pending-3-h1', 'kept']]);
  assert.equal(allProof.scope, 'all');
  assert.deepEqual(allProof.all_record_ids, ['pending-3', 'pending-4']);
  assert.notEqual(allProof.resolution_fingerprint, fileProof.resolution_fingerprint);
});

test('R2-09B pending edit resolution receipt rejects UI-owned facts without owner evidence', () => {
  assert.throws(
    () => buildPendingEditResolutionProof({
      action: 'keep',
      scope: 'file',
      recordId: 'pending-4',
      recordPath: 'src/generated.txt',
      targetPath: '/workspace/src/generated.txt',
      expectedContentLength: 0,
    }),
    /source commit token/i,
  );
  assert.throws(
    () => buildPendingEditResolutionProof({
      action: 'undo',
      scope: 'hunk',
      recordId: 'pending-5',
      recordPath: 'src/generated.txt',
      expectedContentLength: 0,
      postcondition: 'absent',
      transaction: {
        operation: 'delete-created-file',
        targetPath: '/workspace/src/generated.txt',
        result: {
          deleted: true,
          commitToken: {
            absPath: '/workspace/src/generated.txt',
            workspaceRoot: '/workspace',
            before: baseline({ existed: true, content: 'generated\n', inode: '81' }),
            after: baseline({ existed: false, content: '', inode: undefined }),
          },
        },
      },
    }),
    /selected hunk/i,
  );
});
