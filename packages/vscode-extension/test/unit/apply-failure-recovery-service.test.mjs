import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/apply-failure-recovery-service.bundle.cjs');

execSync(
  `npx esbuild src/app/apply-failure-recovery-service.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

class Uri {
  constructor(fsPath) {
    this.fsPath = path.resolve(fsPath);
  }
  static file(fsPath) {
    return new Uri(fsPath);
  }
  static joinPath(base, ...segments) {
    return new Uri(path.join(base.fsPath, ...segments));
  }
}

const fakeWorkspace = {
  workspaceFolders: [],
  getWorkspaceFolder(uri) {
    return this.workspaceFolders.find((folder) => {
      const rel = path.relative(folder.uri.fsPath, uri.fsPath);
      return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
    });
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') {
    return {
      Uri,
      workspace: fakeWorkspace,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const { recoverApplyFailureIfPossible } = req(bundlePath);

function truncatingApply(detail = '原文件约 70 行，新提交约 14 行。') {
  return {
    applied: false,
    changeCount: 0,
    changedPaths: [],
    failureReason: 'truncating-overwrite',
    failureDetail: detail,
    blockedChangePaths: ['code/shape_manager/CMakeLists.txt'],
  };
}

test('ApplyFailureRecoveryService: retries truncating overwrite as minimum unified diff', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-apply-recovery-'));
  const targetDir = path.join(root, 'code', 'shape_manager');
  const targetFile = path.join(targetDir, 'CMakeLists.txt');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(
    targetFile,
    Array.from({ length: 80 }, (_, index) => `set(SHAPE_SOURCE_${index} file_${index}.cpp)`).join('\n') + '\n',
  );
  fakeWorkspace.workspaceFolders = [{ uri: Uri.file(root), name: 'root', index: 0 }];

  const prompts = [];
  const statuses = [];
  try {
    const result = await recoverApplyFailureIfPossible({
      reporter: (status) => statuses.push(status),
      originalPrompt: '编译测试，修正问题',
      failedResponse: [
        '文件 1: code/shape_manager/CMakeLists.txt',
        '```cmake',
        'cmake_minimum_required(VERSION 3.16)',
        'project(shape_manager)',
        '```',
      ].join('\n'),
      failedApply: truncatingApply(),
      preferredAbsolutePaths: [targetFile],
      chat: async (repairPrompt) => {
        prompts.push(repairPrompt);
        return prompts.length === 1
          ? 'code/shape_manager/CMakeLists.txt\n```cmake\nproject(still_short)\n```'
          : '```diff\ndiff --git a/code/shape_manager/CMakeLists.txt b/code/shape_manager/CMakeLists.txt\n--- a/code/shape_manager/CMakeLists.txt\n+++ b/code/shape_manager/CMakeLists.txt\n@@ -1,1 +1,1 @@\n-set(SHAPE_SOURCE_0 file_0.cpp)\n+set(SHAPE_SOURCE_0 fixed.cpp)\n```';
      },
      apply: async () => {
        return prompts.length === 1
          ? truncatingApply('仍是缩略版整文件。')
          : { applied: true, changeCount: 1, changedPaths: ['code/shape_manager/CMakeLists.txt'] };
      },
    });

    assert.equal(result?.applied, true);
    assert.equal(prompts.length, 2);
    assert.match(prompts[0], /当前真实文件内容/);
    assert.match(prompts[0], /只允许输出 unified diff/);
    assert.match(prompts[1], /上一轮修复仍被判定为疑似截断覆盖/);
    assert.match(prompts[1], /禁止再次输出完整文件代码块/);
    assert.equal(
      statuses.some((status) => status.title === '安全补丁仍是截断覆盖，继续要求最小 diff'),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
