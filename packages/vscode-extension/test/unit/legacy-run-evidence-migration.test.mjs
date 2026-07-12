import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(__dirname, '../..');
const bundlePath = path.join(extensionRoot, 'test/unit/legacy-run-evidence-migration.bundle.cjs');
execSync(
  `npx esbuild src/app/legacy-run-evidence-migration.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: extensionRoot, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { LegacyRunEvidenceMigrationService } = req(bundlePath);
const { FileSystemRunEvidenceLedger, productRunEvidenceRoot } = req(path.join(extensionRoot, '../shared/dist/index.js'));

test('VS Code legacy migration adapter preserves old projections only as sealed unverified imports', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-legacy-migration-'));
  try {
    const migration = new LegacyRunEvidenceMigrationService({
      workspaceRoot,
      migrationRunId: 'migration-1',
    });
    migration.importTaskHistory([{
      id: 'task-1',
      workspaceId: 'workspace-1',
      title: 'old task',
      userGoal: 'secret old goal',
      provider: { type: 'bridge' },
      status: 'completed',
      workflowMode: 'edit',
      todos: [],
      changedFiles: ['secret.cpp'],
      operationRefs: [],
      changeSetRefs: [],
      validationRefs: [],
      evidenceRefs: [],
      createdAt: 1,
      updatedAt: 2,
    }]);
    migration.importReviewLedger({
      files: { changedPaths: ['secret.cpp'], operations: [], stats: { added: 1, modified: 0, deleted: 0 } },
      validation: { ran: true, ok: true, command: 'test', exitCode: 0, cwd: '', summary: 'ok', failureFiles: [] },
      qualityGate: { status: 'pass', summary: 'ok', evidenceRefs: [], risks: [], alternativeChecks: [], requiredActions: [] },
      unfinishedItems: [],
    }, 'review:task-1');
    migration.importDiagnosticJsonl('{"runId":"old-run","source":"extension","phase":"tool"}\n', 'old-run.log');
    migration.complete();

    const ledger = new FileSystemRunEvidenceLedger({ rootDir: productRunEvidenceRoot(workspaceRoot) });
    const events = ledger.read('migration-1');
    assert.deepEqual(events.map(event => event.type), [
      'run.opened',
      'legacy.imported',
      'legacy.imported',
      'legacy.imported',
      'run.settled',
    ]);
    assert.equal(ledger.verify('migration-1').status, 'valid-sealed');
    assert.equal(events.slice(1, 4).every(event => event.payload.trust === 'legacy-unverified'), true);
    assert.equal(JSON.stringify(events).includes('secret old goal'), false);
    assert.equal(JSON.stringify(events).includes('secret.cpp'), false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
