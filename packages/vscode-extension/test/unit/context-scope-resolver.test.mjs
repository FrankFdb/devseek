/**
 * Unit tests for app/context-scope-resolver.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/context-scope-resolver.bundle.cjs');

execSync(
  `npx esbuild src/app/context-scope-resolver.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { ContextScopeResolver } = req(bundlePath);

function source(id, kind, content, overrides = {}) {
  return {
    id,
    kind,
    label: id,
    content,
    ...overrides,
  };
}

test('ContextScopeResolver: always keeps project instructions and attachments', () => {
  const result = new ContextScopeResolver().resolve({
    prompt: '继续优化当前任务',
    sources: [
      source('rules', 'project-instruction', 'Use build/.'),
      source('attachment', 'attachment', 'User attached current transcript.'),
      source('old-memory', 'memory', 'Old shape_manager context.'),
    ],
  });

  assert.deepEqual(result.sources.map(s => s.id), ['rules', 'attachment']);
  assert.equal(result.reports.find(r => r.id === 'old-memory')?.reason, 'no-context-anchor');
});

test('ContextScopeResolver: filters scoped sources to current project anchors', () => {
  const result = new ContextScopeResolver().resolve({
    workspaceRoot: '/repo',
    prompt: '请修复 /repo/code/shape_manager/main.cpp 的 title 乱码',
    sources: [
      source('shape-session', 'session', 'Last step changed code/shape_manager/main.cpp.'),
      source('other-session', 'session', 'Last step changed code/other/main.cpp.'),
      source('active-editor', 'active-editor', 'glutCreateWindow("Shape Manager")', {
        path: '/repo/code/shape_manager/main.cpp',
      }),
      source('diagnostics', 'diagnostics', 'main.cpp:92 expected primary-expression'),
    ],
  });

  assert.deepEqual(result.sources.map(s => s.id), ['shape-session', 'active-editor', 'diagnostics']);
  assert.equal(result.reports.find(r => r.id === 'other-session')?.reason, 'not-relevant-to-current-scope');
});

test('ContextScopeResolver: related paths can scope follow-up requests', () => {
  const result = new ContextScopeResolver().resolve({
    workspaceRoot: '/repo',
    prompt: '请重新编译确认',
    relatedPaths: ['/repo/code/shape_manager/CMakeLists.txt'],
    sources: [
      source('current-memory', 'memory', 'CMake file lives at code/shape_manager/CMakeLists.txt.'),
      source('stale-memory', 'memory', 'Old web app package.json task.'),
    ],
  });

  assert.deepEqual(result.sources.map(s => s.id), ['current-memory']);
  assert.equal(result.reports.find(r => r.id === 'stale-memory')?.reason, 'not-relevant-to-current-scope');
});

console.log('\nContext scope resolver tests passed.\n');
