import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/deterministic-analyze-execution.bundle.cjs');

execSync(
  `npx esbuild src/agent/deterministic-analyze-execution.ts --bundle ` +
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
}

const fakeVscode = {
  Uri,
  workspace: {
    workspaceFolders: [],
  },
};

const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') return fakeVscode;
  return originalLoad.call(this, request, parent, isMain);
};

const req = createRequire(import.meta.url);
const { tryExecuteDeterministicAnalyzeExecution } = req(bundlePath);

test('deterministic analyze execution: advisory plan request never triggers local validation', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-deterministic-plan-'));
  try {
    fakeVscode.workspace.workspaceFolders = [{ uri: Uri.file(workspaceRoot), name: 'root', index: 0 }];
    const statuses = [];
    const result = await tryExecuteDeterministicAnalyzeExecution({
      task: {
        id: 't1',
        file: path.basename(workspaceRoot),
        action: 'analyze',
        desc: '分析需求、现有实现和主控职责，输出对策检讨与任务建议，并确认不执行编译验证',
        absPath: workspaceRoot,
      },
      taskIndex: 1,
      taskTotal: 1,
      userPrompt: '请分析 /tmp/project/docs/plan.md，给出新需求的实现对策建议，并从主控需要实现功能角度给出task 当前不准备落地修改',
      workspaceRoot: Uri.file(workspaceRoot),
      callbacks: {
        onAgentStatus: async status => statuses.push(status),
      },
      workdir: workspaceRoot,
    });

    assert.equal(result, undefined);
    assert.deepEqual(statuses, []);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
