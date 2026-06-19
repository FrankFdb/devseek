/**
 * Architecture boundary guards for ARCH-05 Phase 0.
 *
 * These tests make the intended refactor path executable: new business should
 * move into domain services instead of growing extension.ts or agent-loop.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../');

function read(relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}

function physicalLineCount(content) {
  const lines = content.split(/\r?\n/).length;
  return content.endsWith('\n') ? lines - 1 : lines;
}

function nonBlankLineCount(content) {
  return content.split(/\r?\n/).filter(line => line.trim().length > 0).length;
}

test('Phase 0: composition-root files cannot grow past the baseline', () => {
  const budgets = [
    {
      file: 'src/extension.ts',
      maxPhysicalLines: 5511,
      maxNonBlankLines: 5185,
      target: 'move VS Code business into app, ui, workspace, llm, memory, or agent services',
    },
    {
      file: 'src/agent-loop.ts',
      maxPhysicalLines: 3609,
      maxNonBlankLines: 3350,
      target: 'move agent business into runtime, tools, workflow, quality, or memory services',
    },
  ];

  for (const budget of budgets) {
    const content = read(budget.file);
    assert.ok(
      physicalLineCount(content) <= budget.maxPhysicalLines,
      `${budget.file} grew past ${budget.maxPhysicalLines} physical lines; ${budget.target}`,
    );
    assert.ok(
      nonBlankLineCount(content) <= budget.maxNonBlankLines,
      `${budget.file} grew past ${budget.maxNonBlankLines} non-blank lines; ${budget.target}`,
    );
  }
});

test('Phase 0: domain roots expose explicit public boundaries', () => {
  const boundaries = {
    'src/app/index.ts': [
      './chat-controller',
      './permission-service',
      './session-service',
      './task-ledger',
      './workflow-service',
    ],
    'src/agent/index.ts': [
      './events',
      './fake-tool-parser',
      './tool-call-normalizer',
      './tool-executor',
      './tool-registry',
    ],
    'src/workspace/index.ts': [
      './change-set',
      './edit-service',
      './path-resolver',
      './review-ledger',
    ],
    'src/llm/index.ts': [
      './provider-router',
      './types',
    ],
    'src/memory/index.ts': [
      './memory-store',
      './sensitive-memory-guard',
      './types',
    ],
  };

  for (const [file, expectedExports] of Object.entries(boundaries)) {
    const absPath = path.join(root, file);
    assert.ok(existsSync(absPath), `${file} must exist as the public boundary`);
    const content = read(file);
    for (const expectedExport of expectedExports) {
      assert.match(content, new RegExp(`export \\* from ['"]${expectedExport}['"];`), `${file} exports ${expectedExport}`);
    }
    assert.doesNotMatch(content, /extension|agent-loop/, `${file} must not re-export legacy entry points`);
  }
});

test('Phase 0: domain modules do not import legacy entry points or UI internals', () => {
  const domainDirs = ['src/app', 'src/agent', 'src/workspace', 'src/llm', 'src/memory'];
  const forbidden = [
    '../extension',
    '../agent-loop',
    '../ui/',
    '../../media/',
  ];
  const violations = [];

  for (const dir of domainDirs) {
    const absDir = path.join(root, dir);
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const relPath = path.join(dir, entry.name);
      const content = read(relPath);
      for (const needle of forbidden) {
        if (content.includes(needle)) {
          violations.push(`${relPath} imports ${needle}`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('Phase 2: memory boundary exposes schema, store, and guard only', () => {
  const memoryFiles = readdirSync(path.join(root, 'src/memory')).filter(name => name.endsWith('.ts')).sort();
  assert.deepEqual(memoryFiles, ['index.ts', 'memory-store.ts', 'sensitive-memory-guard.ts', 'types.ts']);

  const types = read('src/memory/types.ts');
  for (const field of ['id', 'type', 'scope', 'content', 'source', 'confidence', 'createdAt', 'updatedAt', 'ttl', 'lastUsedAt', 'status', 'tags']) {
    assert.match(types, new RegExp(`\\b${field}\\b`), `MemoryRecord includes ${field}`);
  }
});

test('Phase 2: agent loop memory_write does not know persistence file paths', () => {
  const agentLoop = read('src/agent-loop.ts');
  assert.doesNotMatch(agentLoop, /\.devseek\/memory\.md|memory\.md/, 'agent-loop must not mention legacy memory file paths');
  assert.doesNotMatch(agentLoop, /appendFileSync|writeFileSync|mkdirSync/, 'agent-loop must not persist memory directly');
  assert.match(agentLoop, /onMemoryWrite\?: \(proposal: MemoryWriteProposal\)/, 'agent-loop emits structured memory proposals');
});
