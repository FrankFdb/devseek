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

test('MemoryService: filters prompt context to the current project anchors', () => {
  withTempWorkspace((workspace) => {
    write(workspace, '.devseek/memory.md', [
      '# Legacy',
      '',
      '2026-05-27 在 code/file_counter/ 目录下创建了 C++ 文件计数程序。',
      '',
      '2026-05-29 在 code/joke_program/ 目录下创建了挣钱笑话生成器。',
      '',
      '2026-06-26 在 code/shape_manager/ 目录下完成了三维图形展示程序增强。',
    ].join('\n'));
    const service = new MemoryService({ workspaceRoot: workspace });
    service.appendAgentMemory('在 code/shape_manager/ 目录下，使用 build/bin/shape_manager 运行验证。');
    service.appendAgentMemory('在 code/file_counter/ 目录下，使用 g++ 编译 file_counter。');

    const context = service.retrievePromptContext({
      query: '通过鼠标点击选择三维图形',
      relatedPaths: [path.join(workspace, 'code/shape_manager/main.cpp')],
    });

    assert.match(context, /shape_manager/);
    assert.doesNotMatch(context, /file_counter/);
    assert.doesNotMatch(context, /joke_program/);
  });
});

test('MemoryService: omits prompt memory when strict context has no project anchor', () => {
  withTempWorkspace((workspace) => {
    write(workspace, '.devseek/memory.md', [
      '# Legacy',
      '',
      '2026-05-27 在 code/file_counter/ 目录下创建了 C++ 文件计数程序。',
      '',
      '2026-05-29 在 code/joke_program/ 目录下创建了挣钱笑话生成器。',
    ].join('\n'));
    const service = new MemoryService({ workspaceRoot: workspace });
    service.appendAgentMemory('在 code/file_counter/ 目录下，使用 g++ 编译 file_counter。');

    const context = service.retrievePromptContext({
      query: '改成鼠标点击选择图形',
      requireContextMatch: true,
    });

    assert.equal(context, null);
  });
});

test('MemoryService: ignores injected session history while choosing memory anchors', () => {
  withTempWorkspace((workspace) => {
    write(workspace, '.devseek/memory.md', [
      '# Legacy',
      '',
      '2026-05-29 在 code/weekend_feeling.c 程序成功编译并运行测试。',
      '',
      '2026-06-26 在 code/shape_manager/ 目录下完成了三维图形展示程序增强。',
    ].join('\n'));
    const service = new MemoryService({ workspaceRoot: workspace });
    service.appendAgentMemory('在 code/shape_manager/ 目录下，使用 build/bin/shape_manager 运行验证。');
    service.appendAgentMemory('在 code/weekend_feeling.c 文件中使用 gcc 编译。');

    const context = service.retrievePromptContext({
      query: [
        '通过数字能选择描画的三维图形，能够改为通过鼠标点击选择对应图形吗',
        '',
        '【同一会话续作上下文】',
        '最近对话摘要：已修改 code/weekend_feeling.c。',
      ].join('\n'),
      relatedPaths: [path.join(workspace, 'code/shape_manager/main.cpp')],
      requireContextMatch: true,
    });

    assert.match(context, /shape_manager/);
    assert.doesNotMatch(context, /weekend_feeling/);
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
