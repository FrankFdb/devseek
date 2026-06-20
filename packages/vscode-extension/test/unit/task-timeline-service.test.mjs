import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/task-timeline-service.bundle.cjs');

execSync(
  `npx esbuild src/agent/task-timeline-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { TaskTimelineService } = req(bundlePath);

test('TaskTimelineService: appends normalized timeline events in chronological order', () => {
  const service = new TaskTimelineService();
  service.append({ taskId: 'task-1', kind: 'validation', title: 'compile', status: 'failed', createdAt: 20 });
  service.append({ taskId: 'task-1', kind: 'workflow', title: 'plan approved', status: 'completed', createdAt: 10 });

  const items = service.list('task-1');

  assert.equal(items[0].kind, 'workflow');
  assert.equal(items[1].kind, 'validation');
});

test('TaskTimelineService: evidence refs are de-duplicated and summarized', () => {
  const service = new TaskTimelineService();
  const item = service.append({
    taskId: 'task-1',
    kind: 'quality',
    title: 'QualityGate',
    status: 'blocked',
    evidenceRefs: ['qg-1', 'qg-1', 'validation-1'],
    createdAt: 1,
  });

  assert.deepEqual(item.evidenceRefs, ['qg-1', 'validation-1']);
  assert.equal(service.summarize('task-1'), 'quality:blocked:QualityGate');
});

console.log('\nTask timeline service tests passed.\n');
