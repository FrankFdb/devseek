import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/run-changed-path-recorder.bundle.cjs');

execSync(
  `npx esbuild src/app/run-changed-path-recorder.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  projectRunChangedPaths,
  RunChangedPathRecorder,
} = req(bundlePath);

test('Run changed paths: projection normalizes, deduplicates, and rejects workspace escape', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-run-changes-'));
  try {
    const projection = projectRunChangedPaths(root, [
      'src/math.js',
      path.join(root, 'src', 'math.js'),
      '../outside.txt',
      '',
    ]);

    assert.deepEqual(projection.relativePaths, ['src/math.js']);
    assert.deepEqual(projection.absolutePaths, [path.join(root, 'src', 'math.js')]);
    assert.deepEqual(projectRunChangedPaths('', ['src/math.js']), {
      relativePaths: [],
      absolutePaths: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Run changed paths: an empty next result replaces stale prior-run state without fake events', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-run-changes-state-'));
  try {
    let lastChangedPaths = ['stale/previous.js'];
    const registered = [];
    const cochangeEvents = [];
    const recorder = new RunChangedPathRecorder({
      replaceLastChangedPaths: (paths) => { lastChangedPaths = paths; },
      registerRecentFile: (pathValue) => { registered.push(pathValue); },
      emitFilesCoChanged: (paths) => { cochangeEvents.push(paths); },
    });

    assert.deepEqual(recorder.record({
      workspaceRoot: root,
      changedPaths: ['src/math.js'],
    }), ['src/math.js']);
    assert.deepEqual(lastChangedPaths, ['src/math.js']);
    assert.deepEqual(registered, [path.join(root, 'src', 'math.js')]);
    assert.deepEqual(cochangeEvents, [['src/math.js']]);

    assert.deepEqual(recorder.record({ workspaceRoot: root, changedPaths: [] }), []);
    assert.deepEqual(lastChangedPaths, []);
    assert.deepEqual(registered, [path.join(root, 'src', 'math.js')]);
    assert.deepEqual(cochangeEvents, [['src/math.js']]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Run changed paths: chat scope accumulates current-run paths and preserves memory when no file changed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-run-changes-scope-'));
  try {
    let lastChangedPaths = ['src/previous.js'];
    const recorder = new RunChangedPathRecorder({
      replaceLastChangedPaths: (paths) => { lastChangedPaths = paths; },
      registerRecentFile: () => {},
      emitFilesCoChanged: () => {},
    });

    assert.deepEqual(recorder.openScope(root).commit(), []);
    assert.deepEqual(lastChangedPaths, ['src/previous.js']);

    const scope = recorder.openScope(root);
    scope.add(['src/next.js']);
    scope.add(['src/next.js', '../outside.js']);
    assert.deepEqual(scope.commit(), ['src/next.js']);
    assert.deepEqual(lastChangedPaths, ['src/next.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
