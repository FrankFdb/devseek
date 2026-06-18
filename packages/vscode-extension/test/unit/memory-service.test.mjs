/**
 * Unit tests for app/memory-service.ts and memory boundary behavior.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/memory-service.bundle.cjs');

execSync(
  `npx esbuild src/app/memory-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { MemoryService } = req(bundlePath);

function withTempWorkspace(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'devseek-memory-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function write(root, relPath, content) {
  const absPath = path.join(root, relPath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
  return absPath;
}

function readStructuredMemory(root) {
  return JSON.parse(readFileSync(path.join(root, '.devseek/memory.json'), 'utf8'));
}

test('MemoryService: writes structured memory with schema, scope, and active status', () => {
  withTempWorkspace((workspace) => {
    const service = new MemoryService({ workspaceRoot: workspace });
    const proposal = service.proposeWrite({
      content: '本仓库默认使用 npm test 做回归验证。',
      reason: 'Verified command convention',
      tags: ['test'],
    });

    assert.equal(proposal.type, 'verified-experience');
    assert.equal(proposal.scope, 'repository');
    assert.equal(proposal.requiresUserApproval, false);

    const record = service.acceptWriteProposal(proposal);
    assert.equal(record.status, 'active');
    assert.equal(record.source.kind, 'agent');
    assert.ok(record.id.startsWith('mem_'));

    const records = service.retrieve({ types: ['verified-experience'] });
    assert.equal(records.length, 1);
    assert.equal(records[0].content, '本仓库默认使用 npm test 做回归验证。');
    assert.equal(readStructuredMemory(workspace).records.length, 1);
  });
});

test('MemoryService: blocks sensitive memory writes before persistence', () => {
  withTempWorkspace((workspace) => {
    const service = new MemoryService({ workspaceRoot: workspace });

    assert.throws(
      () => service.appendAgentMemory('生产环境 api_key=sk-123456789012345678901234567890 请记住'),
      /敏感信息/,
    );
    assert.equal(service.retrieve({ includeDisabled: true }).length, 0);
  });
});

test('MemoryService: imports legacy markdown memory into prompt context', () => {
  withTempWorkspace((workspace) => {
    write(workspace, '.devseek/memory.md', '# Legacy\n\n旧记忆：修复前先运行编译。');

    const context = new MemoryService({ workspaceRoot: workspace }).retrievePromptContext();

    assert.match(context, /DevSeek legacy memory/);
    assert.match(context, /旧记忆：修复前先运行编译。/);
  });
});

test('MemoryService: supports disable and delete lifecycle operations', () => {
  withTempWorkspace((workspace) => {
    const service = new MemoryService({ workspaceRoot: workspace });
    const record = service.appendAgentMemory('优先使用 rg 做代码搜索。');

    assert.equal(service.disable(record.id), true);
    assert.equal(service.retrieve().length, 0);
    assert.equal(service.retrieve({ includeDisabled: true })[0].status, 'disabled');

    assert.equal(service.delete(record.id), true);
    assert.equal(service.retrieve({ includeDisabled: true }).length, 0);
  });
});

console.log('\nMemory service tests passed.\n');
