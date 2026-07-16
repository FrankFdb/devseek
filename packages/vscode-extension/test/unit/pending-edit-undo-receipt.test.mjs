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
const { buildPendingEditUndoProof } = req(bundlePath);

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
});

