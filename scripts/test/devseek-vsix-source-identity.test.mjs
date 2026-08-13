import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  computeVsixDirtyRuntimeFingerprint,
  isAllowedVsixUnpackagedNonRuntimePath,
  sameVsixSourceFingerprint,
  VSIX_SOURCE_FINGERPRINT_VERSION,
} from '../lib/devseek-vsix-source-identity.mjs';

test('VSIX source identity fingerprints dirty runtime paths but ignores nonruntime evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-vsix-source-identity-'));
  try {
    const runtimePath = 'packages/vscode-extension/src/agent/simple-file-intent.ts';
    const docsPath = 'docs/testing/report.md';
    mkdirSync(path.dirname(path.join(root, runtimePath)), { recursive: true });
    mkdirSync(path.dirname(path.join(root, docsPath)), { recursive: true });
    writeFileSync(path.join(root, runtimePath), 'export const marker = 1;\n', 'utf8');
    writeFileSync(path.join(root, docsPath), '# Report\n', 'utf8');

    const fingerprint = computeVsixDirtyRuntimeFingerprint({
      repoRoot: root,
      dirtyTrackedPaths: [runtimePath, docsPath, 'scripts/package-vsix.mjs'],
    });

    assert.equal(fingerprint.version, VSIX_SOURCE_FINGERPRINT_VERSION);
    assert.deepEqual(fingerprint.dirtyRuntimePaths, [runtimePath]);
    assert.equal(isAllowedVsixUnpackagedNonRuntimePath(docsPath), true);
    assert.equal(isAllowedVsixUnpackagedNonRuntimePath('scripts/package-vsix.mjs'), true);
    assert.equal(sameVsixSourceFingerprint(fingerprint, { ...fingerprint }), true);

    writeFileSync(path.join(root, runtimePath), 'export const marker = 2;\n', 'utf8');
    const changed = computeVsixDirtyRuntimeFingerprint({
      repoRoot: root,
      dirtyTrackedPaths: [runtimePath, docsPath, 'scripts/package-vsix.mjs'],
    });
    assert.equal(sameVsixSourceFingerprint(fingerprint, changed), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
