/**
 * Unit tests for AgentFileWritePolicy.
 *
 * Claude Code/Codex-style contract: user-requested document artifacts are
 * runtime deliverables with write/read-back evidence, while normal source edits
 * remain blocked in plan mode and protected paths still hard-block.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agent-file-write-policy.bundle.cjs');

execSync(
  `npx esbuild src/app/agent-file-write-policy.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: rootDir, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const { decideAgentFileWrite, detectIsolatedArtifactWriteScope } = req(bundlePath);

const planPolicy = {
  mode: 'plan',
  allowedToolKinds: ['read', 'search', 'diagnostics', 'network', 'plan', 'memory'],
  requireConfirmationKinds: [],
  deniedToolKinds: ['edit', 'terminal', 'vscode', 'vscode-command', 'mcp'],
  requireUserConfirmation: false,
};

test('AgentFileWritePolicy: plan mode blocks ordinary workspace edits', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/src/main.cpp',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    context: { purpose: 'workspace-edit', userRequested: true },
  });

  assert.equal(decision.action, 'deny');
  assert.match(decision.reason, /(?:tool-kind-denied|tool-kind-not-allowed-for-plan):edit/);
});

test('AgentFileWritePolicy: plan mode hard-blocks even explicit Markdown deliverable artifacts', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/docs/warranty-maintenance-advice.md',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    context: {
      purpose: 'markdown-deliverable',
      userRequested: true,
      taskAction: 'create',
      displayName: 'docs/warranty-maintenance-advice.md',
    },
  });

  assert.equal(decision.action, 'deny');
  assert.match(decision.reason, /(?:tool-kind-denied|tool-kind-not-allowed-for-plan):edit/);
});

test('AgentFileWritePolicy: a misleading mode label cannot bypass a deny-list', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/docs/warranty-maintenance-advice.md',
    workspaceRoot: '/workspace',
    toolPolicy: {
      ...planPolicy,
      mode: 'fast',
    },
    context: {
      purpose: 'markdown-deliverable',
      userRequested: true,
      taskAction: 'create',
      displayName: 'docs/warranty-maintenance-advice.md',
    },
  });

  assert.equal(decision.action, 'deny');
  assert.match(decision.reason, /tool-kind-denied:edit/);
});

test('AgentFileWritePolicy: Markdown deliverable cannot escape workspace', () => {
  const decision = decideAgentFileWrite({
    absPath: '/tmp/warranty-maintenance-advice.md',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    context: { purpose: 'markdown-deliverable', userRequested: true },
  });

  assert.equal(decision.action, 'deny');
  assert.equal(decision.reason, 'target-outside-workspace');
});

test('AgentFileWritePolicy: workspace symlinks cannot redirect deliverables outside the workspace', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-write-containment-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outsideRoot = path.join(tempRoot, 'outside');
  mkdirSync(workspaceRoot);
  mkdirSync(outsideRoot);
  symlinkSync(outsideRoot, path.join(workspaceRoot, 'linked'));
  try {
    const decision = decideAgentFileWrite({
      absPath: path.join(workspaceRoot, 'linked', 'report.md'),
      workspaceRoot,
      toolPolicy: planPolicy,
      context: { purpose: 'markdown-deliverable', userRequested: true },
    });
    assert.equal(decision.action, 'deny');
    assert.equal(decision.reason, 'target-outside-workspace');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('AgentFileWritePolicy: prohibited and unrequested Markdown targets fail at the final write boundary', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-write-contract-'));
  const allowedTarget = path.join(workspaceRoot, 'a.md');
  const deniedTarget = path.join(workspaceRoot, 'b.md');
  try {
    const prohibited = decideAgentFileWrite({
      absPath: deniedTarget,
      workspaceRoot,
      context: {
        purpose: 'tool-write',
        requestPrompt: `不允许生成 Markdown 报告 ${deniedTarget}。`,
      },
    });
    assert.equal(prohibited.action, 'deny');
    assert.equal(prohibited.reason, 'markdown-artifact-write-prohibited');

    const mixedPrompt = `请创建 Markdown 报告 ${allowedTarget}，不要修改 ${deniedTarget}。`;
    const allowed = decideAgentFileWrite({
      absPath: allowedTarget,
      workspaceRoot,
      context: { purpose: 'tool-write', requestPrompt: mixedPrompt },
    });
    assert.equal(allowed.action, 'allow');

    const wrongTarget = decideAgentFileWrite({
      absPath: deniedTarget,
      workspaceRoot,
      context: { purpose: 'tool-write', requestPrompt: mixedPrompt },
    });
    assert.equal(wrongTarget.action, 'deny');
    assert.equal(wrongTarget.reason, 'markdown-artifact-write-prohibited');

    for (const requestPrompt of [
      '不要创建任何文件。',
      '禁止写入文件。',
      'Do not create any files.',
    ]) {
      const genericProhibition = decideAgentFileWrite({
        absPath: deniedTarget,
        workspaceRoot,
        context: { purpose: 'tool-write', requestPrompt },
      });
      assert.equal(genericProhibition.action, 'deny', requestPrompt);
      assert.equal(genericProhibition.reason, 'markdown-artifact-write-prohibited', requestPrompt);
    }

    const targetSpecific = decideAgentFileWrite({
      absPath: deniedTarget,
      workspaceRoot,
      context: {
        purpose: 'tool-write',
        requestPrompt: `请创建一个 Markdown 报告，但不要修改 ${deniedTarget}。`,
      },
    });
    assert.equal(targetSpecific.action, 'deny');
    assert.equal(targetSpecific.reason, 'markdown-artifact-write-prohibited');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('AgentFileWritePolicy: no-source and no-other-file contracts protect sibling write paths', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-write-scope-'));
  const source = path.join(workspaceRoot, 'source.hpp');
  const report = path.join(workspaceRoot, 'report.md');
  const extra = path.join(workspaceRoot, 'notes.txt');
  try {
    for (const requestPrompt of [
      `读取 ${source}，创建 Markdown 报告 ${report}；不得修改任何源码，不要创建其他文件。`,
      `Read ${source} and create Markdown report ${report}; do not modify any source files and do not create other files.`,
    ]) {
      assert.equal(decideAgentFileWrite({
        absPath: report,
        workspaceRoot,
        context: { purpose: 'markdown-deliverable', userRequested: true, requestPrompt },
      }).action, 'allow', requestPrompt);

      const sourceWrite = decideAgentFileWrite({
        absPath: source,
        workspaceRoot,
        context: { purpose: 'tool-write', requestPrompt },
      });
      assert.equal(sourceWrite.action, 'deny', requestPrompt);
      assert.match(sourceWrite.reason, /(?:source-file|artifact-other-file)-write-prohibited/, requestPrompt);

      const extraWrite = decideAgentFileWrite({
        absPath: extra,
        workspaceRoot,
        context: { purpose: 'tool-write', requestPrompt },
      });
      assert.equal(extraWrite.action, 'deny', requestPrompt);
      assert.equal(extraWrite.reason, 'artifact-other-file-write-prohibited', requestPrompt);
    }
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('AgentFileWritePolicy: neutral Markdown and non-Markdown prohibitions fail closed', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-write-neutral-'));
  try {
    for (const requestPrompt of ['只读 report.md。', '请读取 report.md 并汇总内容告诉我。', '解释问题。']) {
      assert.equal(decideAgentFileWrite({
        absPath: path.join(workspaceRoot, 'report.md'),
        workspaceRoot,
        context: { purpose: 'tool-write', requestPrompt },
      }).action, 'deny', requestPrompt);
    }
    for (const [requestPrompt, relativeTarget] of [
      ['不要创建文件。', 'notes.txt'],
      ['Do not create files.', 'notes.txt'],
      ['请创建 report.md；不要修改 src/main.ts。', 'src/main.ts'],
      ['请创建 report.md；禁止覆盖 config.json。', 'config.json'],
    ]) {
      assert.equal(decideAgentFileWrite({
        absPath: path.join(workspaceRoot, relativeTarget),
        workspaceRoot,
        context: { purpose: 'tool-write', requestPrompt },
      }).action, 'deny', requestPrompt);
    }
    const scopedSourceProhibition = decideAgentFileWrite({
      absPath: path.join(workspaceRoot, 'src/main.ts'),
      workspaceRoot,
      context: {
        purpose: 'tool-write',
        requestPrompt: '不要修改正式源码目录里的既有文件。',
      },
    });
    assert.equal(scopedSourceProhibition.action, 'deny');
    assert.equal(scopedSourceProhibition.reason, 'source-file-write-prohibited');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('AgentFileWritePolicy: simple programming prompts authorize bounded source artifacts', () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'devseek-code-artifact-'));
  try {
    const requestPrompt = '编写一个 C++ 程序，打印下午好';
    const allowHello = decideAgentFileWrite({
      absPath: path.join(workspaceRoot, 'hello.cpp'),
      workspaceRoot,
      context: {
        purpose: 'tool-write',
        userRequested: false,
        taskAction: 'create',
        displayName: 'hello.cpp',
        requestPrompt,
      },
    });
    assert.equal(allowHello.action, 'allow');

    const allowScopedSource = decideAgentFileWrite({
      absPath: path.join(workspaceRoot, 'code/hello_afternoon.cpp'),
      workspaceRoot,
      context: {
        purpose: 'tool-write',
        userRequested: false,
        taskAction: 'create',
        displayName: 'code/hello_afternoon.cpp',
        requestPrompt,
      },
    });
    assert.equal(allowScopedSource.action, 'allow');

    const unrelated = decideAgentFileWrite({
      absPath: path.join(workspaceRoot, 'notes.txt'),
      workspaceRoot,
      context: {
        purpose: 'tool-write',
        userRequested: false,
        taskAction: 'create',
        displayName: 'notes.txt',
        requestPrompt,
      },
    });
    assert.equal(unrelated.action, 'deny');
    assert.equal(unrelated.reason, 'target-file-write-prohibited');

    const noFiles = decideAgentFileWrite({
      absPath: path.join(workspaceRoot, 'hello.cpp'),
      workspaceRoot,
      context: {
        purpose: 'tool-write',
        userRequested: false,
        taskAction: 'create',
        displayName: 'hello.cpp',
        requestPrompt: `${requestPrompt}，不要创建文件。`,
      },
    });
    assert.equal(noFiles.action, 'deny');
    assert.equal(noFiles.reason, 'all-file-writes-prohibited');
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('AgentFileWritePolicy: global directory prohibitions reach the final directory boundary', () => {
  for (const requestPrompt of [
    '不要创建任何目录。',
    'Do not create any directories.',
  ]) {
    const decision = decideAgentFileWrite({
      absPath: '/workspace/generated',
      workspaceRoot: '/workspace',
      context: {
        purpose: 'tool-write',
        taskAction: 'create_directory',
        requestPrompt,
      },
    });
    assert.equal(decision.action, 'deny', requestPrompt);
    assert.equal(decision.reason, 'all-file-writes-prohibited', requestPrompt);
  }
});

test('AgentFileWritePolicy: scoped source protection follows directory role, not filename extension', () => {
  const cases = [
    ['/workspace/src/NOTICE.txt', false],
    ['/workspace/app/config/app.properties', false],
    ['/workspace/docs/NOTICE.txt', true],
    ['/workspace/generated/app.properties', true],
  ];
  for (const [absPath, allowed] of cases) {
    const requestPrompt = `不要修改正式源码目录里的既有文件；请更新 ${absPath}。`;
    const decision = decideAgentFileWrite({
      absPath,
      workspaceRoot: '/workspace',
      context: { purpose: 'tool-write', taskAction: 'update', requestPrompt },
    });
    assert.equal(decision.action, allowed ? 'allow' : 'deny', absPath);
    if (!allowed) assert.equal(decision.reason, 'source-file-write-prohibited', absPath);
  }
});

test('AgentFileWritePolicy: protected files hard-block even explicit deliverables', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/docs/warranty-maintenance-advice.md',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    protectedPath: true,
    context: { purpose: 'markdown-deliverable', userRequested: true },
  });

  assert.equal(decision.action, 'deny');
  assert.equal(decision.reason, 'protected-files-match');
});

test('AgentFileWritePolicy: explicit deliverable exception is limited to Markdown files', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/docs/warranty-maintenance-advice.txt',
    workspaceRoot: '/workspace',
    toolPolicy: planPolicy,
    context: { purpose: 'markdown-deliverable', userRequested: true },
  });

  assert.equal(decision.action, 'deny');
  assert.match(decision.reason, /(?:tool-kind-denied|tool-kind-not-allowed-for-plan):edit/);
});

test('AgentFileWritePolicy: detects isolated artifact output roots from Chinese project prompts', () => {
  const prompt = [
    '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/workspace/src/oam/src/lifting/zc_maintenance/202607101807',
    '- 设计/实施 Markdown 文档放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs',
    '- 代码和测试文件放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/src',
    '不要修改正式源码目录里的既有文件；如需改原项目关联代码，请写入原有代码修改清单。',
    '必须创建主设计 Markdown 文档：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs/01-warranty-remote-controller-interface-design.md',
  ].join('\n');

  const scope = detectIsolatedArtifactWriteScope(prompt, '/workspace');

  assert.equal(scope.required, true);
  assert.equal(scope.allowedRoots.includes('/workspace/src/oam/src/lifting/zc_maintenance/202607101807'), false);
  assert.ok(scope.allowedRoots.includes('/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs'));
  assert.ok(scope.allowedRoots.includes('/workspace/src/oam/src/lifting/zc_maintenance/202607101807/src'));
});

test('AgentFileWritePolicy: isolated output roots preserve relative and quoted path boundaries', () => {
  const cases = [
    ['所有新增产物必须放在：isolated/output', '/workspace/isolated/output'],
    ['所有新增产物必须放在：./isolated/output', '/workspace/isolated/output'],
    ['所有新增产物必须放在："/workspace/my output"', '/workspace/my output'],
    ['All new artifacts must be placed in "./isolated output".', '/workspace/isolated output'],
    ['所有生成文件必须放在：isolated/output。', '/workspace/isolated/output'],
    ['All generated artifacts must be placed in isolated/output.', '/workspace/isolated/output'],
  ];
  for (const [requestPrompt, expectedRoot] of cases) {
    assert.deepEqual(
      detectIsolatedArtifactWriteScope(requestPrompt, '/workspace'),
      { required: true, allowedRoots: [expectedRoot] },
      requestPrompt,
    );
  }
});

test('AgentFileWritePolicy: ambiguous unquoted space roots fail closed instead of widening scope', () => {
  const requestPrompt = 'All new artifacts must be placed in /workspace/my output. Create /workspace/my/evil.txt.';
  assert.deepEqual(
    detectIsolatedArtifactWriteScope(requestPrompt, '/workspace'),
    { required: true, allowedRoots: [] },
  );
  const decision = decideAgentFileWrite({
    absPath: '/workspace/my/evil.txt',
    workspaceRoot: '/workspace',
    context: { purpose: 'tool-write', requestPrompt },
  });
  assert.equal(decision.action, 'deny');
  assert.equal(decision.reason, 'invalid-isolated-artifact-scope');
});

test('AgentFileWritePolicy: generated-artifact wording enforces the parsed isolated root', () => {
  for (const requestPrompt of [
    'All generated artifacts must be placed in isolated/output. Create outside/a.txt.',
    'All generated outputs must be placed in isolated/output. Create outside/a.txt.',
    '所有生成文件必须放在：isolated/output。请创建 outside/a.txt。',
    '所有输出必须放在：isolated/output。请创建 outside/a.txt。',
  ]) {
    const decision = decideAgentFileWrite({
      absPath: '/workspace/outside/a.txt',
      workspaceRoot: '/workspace',
      context: { purpose: 'tool-write', requestPrompt },
    });
    assert.equal(decision.action, 'deny', requestPrompt);
    assert.equal(decision.reason, 'isolated-artifact-scope', requestPrompt);
  }
});

test('AgentFileWritePolicy: explicit isolated probe file path survives no-other-file constraints', () => {
  const marker = 'CLOSE02-20260713-manual-probe';
  const target = `/workspace/.devseek-close02-probe/${marker}/probe.js`;
  const requestPrompt = [
    marker,
    '请只在这个隔离路径创建一个最小 JavaScript probe 文件：',
    `.devseek-close02-probe/${marker}/probe.js`,
    '内容要求：',
    '1. 定义函数 close02Add(a, b)，返回 a + b。',
    `2. 最后一行打印：${marker}: 2+3=5`,
    '3. 不修改任何其他文件，不运行网络，不安装依赖，不修改 git，不触碰产品源码。',
    '4. 完成后只告诉我创建的文件路径和最终状态。',
  ].join('\n');

  assert.deepEqual(
    detectIsolatedArtifactWriteScope(requestPrompt, '/workspace'),
    { required: true, allowedRoots: [target] },
  );
  assert.deepEqual(
    detectIsolatedArtifactWriteScope(requestPrompt.replace(/\n/g, ' '), '/workspace'),
    { required: true, allowedRoots: [target] },
  );

  const allowed = decideAgentFileWrite({
    absPath: target,
    workspaceRoot: '/workspace',
    context: { purpose: 'tool-write', taskAction: 'create', requestPrompt },
  });
  assert.equal(allowed.action, 'allow', allowed.reason);

  const flattenedAllowed = decideAgentFileWrite({
    absPath: target,
    workspaceRoot: '/workspace',
    context: {
      purpose: 'tool-write',
      taskAction: 'create',
      requestPrompt: requestPrompt.replace(/\n/g, ' '),
    },
  });
  assert.equal(flattenedAllowed.action, 'allow', flattenedAllowed.reason);

  const sibling = decideAgentFileWrite({
    absPath: `/workspace/.devseek-close02-probe/${marker}/probe_mermaid.js`,
    workspaceRoot: '/workspace',
    context: { purpose: 'tool-write', taskAction: 'create', requestPrompt },
  });
  assert.equal(sibling.action, 'deny');
  assert.equal(sibling.reason, 'isolated-artifact-scope');

  const source = decideAgentFileWrite({
    absPath: '/workspace/src/probe.js',
    workspaceRoot: '/workspace',
    context: { purpose: 'tool-write', taskAction: 'create', requestPrompt },
  });
  assert.equal(source.action, 'deny');
  assert.equal(source.reason, 'isolated-artifact-scope');
});

test('AgentFileWritePolicy: isolated directories do not override explicit only-target constraints', () => {
  const requestPrompt = [
    '所有新增产物必须放在：isolated/output。',
    '请只创建 isolated/output/report.js，不要创建其他文件。',
  ].join('\n');

  const allowed = decideAgentFileWrite({
    absPath: '/workspace/isolated/output/report.js',
    workspaceRoot: '/workspace',
    context: { purpose: 'tool-write', taskAction: 'create', requestPrompt },
  });
  assert.equal(allowed.action, 'allow', allowed.reason);

  const extra = decideAgentFileWrite({
    absPath: '/workspace/isolated/output/extra.js',
    workspaceRoot: '/workspace',
    context: { purpose: 'tool-write', taskAction: 'create', requestPrompt },
  });
  assert.equal(extra.action, 'deny');
  assert.equal(extra.reason, 'artifact-other-file-write-prohibited');
});

test('AgentFileWritePolicy: a latest standalone stop or cancel steer revokes the original target', () => {
  for (const revoke of [
    '停止写入。',
    '停止。',
    '取消任务。',
    '不要继续。',
    '算了。',
    '不用了。',
    'Stop writing.',
    'Stop.',
    'Cancel the task.',
    'Do not continue.',
    'Never mind.',
  ]) {
    const requestPrompt = [
      '请创建 report.md。',
      '【用户实时补充/纠偏】',
      revoke,
      '',
      '请将以上内容作为当前任务的最新约束继续执行；如它与旧计划冲突，以这条补充为准。不要从头开启新任务。',
    ].join('\n');
    const decision = decideAgentFileWrite({
      absPath: '/workspace/report.md',
      workspaceRoot: '/workspace',
      autopilotMode: true,
      context: {
        purpose: 'markdown-deliverable',
        userRequested: true,
        taskAction: 'create',
        requestPrompt,
      },
    });
    assert.equal(decision.action, 'deny', revoke);
    assert.equal(decision.reason, 'all-file-writes-prohibited', revoke);
  }
});

test('AgentFileWritePolicy: an unparseable required isolated scope fails closed', () => {
  const requestPrompt = '所有新增产物必须放在指定的隔离目录。';
  const scope = detectIsolatedArtifactWriteScope(requestPrompt, '/workspace');
  assert.equal(scope.required, true);
  assert.deepEqual(scope.allowedRoots, []);

  const decision = decideAgentFileWrite({
    absPath: '/workspace/docs/report.md',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'markdown-deliverable',
      userRequested: true,
      requestPrompt,
    },
  });
  assert.equal(decision.action, 'deny');
  assert.equal(decision.reason, 'invalid-isolated-artifact-scope');
});

test('AgentFileWritePolicy: isolated artifact scope blocks writes to formal source directories', () => {
  const requestPrompt = [
    '本次测试所有新增设计文档、实施文档、代码和验证脚本必须放在：/workspace/src/oam/src/lifting/zc_maintenance/202607101807',
    '- 设计/实施 Markdown 文档放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs',
    '- 代码和测试文件放入：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/src',
    '不要修改正式源码目录里的既有文件；如需改原项目关联代码，请写入原有代码修改清单。',
    '必须创建主设计 Markdown 文档：/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs/01-warranty-remote-controller-interface-design.md',
  ].join('\n');

  const denied = decideAgentFileWrite({
    absPath: '/workspace/src/oam/src/license/proc_license_main.cpp',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'tool-write',
      userRequested: false,
      displayName: 'src/oam/src/license/proc_license_main.cpp',
      requestPrompt,
    },
  });

  assert.equal(denied.action, 'deny');
  assert.equal(denied.reason, 'isolated-artifact-scope');

  const deniedContainerRootArtifact = decideAgentFileWrite({
    absPath: '/workspace/src/oam/src/lifting/zc_maintenance/202607101807/warranty_types.hpp',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'tool-write',
      userRequested: false,
      displayName: 'src/oam/src/lifting/zc_maintenance/202607101807/warranty_types.hpp',
      requestPrompt,
    },
  });

  assert.equal(deniedContainerRootArtifact.action, 'deny');
  assert.equal(deniedContainerRootArtifact.reason, 'isolated-artifact-scope');

  const allowedSourceArtifact = decideAgentFileWrite({
    absPath: '/workspace/src/oam/src/lifting/zc_maintenance/202607101807/src/warranty_manager.cpp',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'tool-write',
      userRequested: false,
      displayName: 'src/oam/src/lifting/zc_maintenance/202607101807/src/warranty_manager.cpp',
      requestPrompt,
    },
  });

  assert.equal(allowedSourceArtifact.action, 'allow');

  const allowedDocArtifact = decideAgentFileWrite({
    absPath: '/workspace/src/oam/src/lifting/zc_maintenance/202607101807/docs/01-warranty-remote-controller-interface-design.md',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'markdown-deliverable',
      userRequested: true,
      displayName: 'src/oam/src/lifting/zc_maintenance/202607101807/docs/01-warranty-remote-controller-interface-design.md',
      requestPrompt,
    },
  });

  assert.equal(allowedDocArtifact.action, 'allow');
});

test('AgentFileWritePolicy: isolated artifact symlinks cannot redirect writes into another workspace directory', () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-isolated-containment-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const allowedRoot = path.join(workspaceRoot, 'isolated', 'docs');
  const formalRoot = path.join(workspaceRoot, 'src');
  mkdirSync(allowedRoot, { recursive: true });
  mkdirSync(formalRoot, { recursive: true });
  symlinkSync(formalRoot, path.join(allowedRoot, 'linked'));
  const requestPrompt = [
    `本次测试所有新增设计文档必须放在：${allowedRoot}`,
    `- 设计文档放入：${allowedRoot}`,
    '不要修改正式源码目录里的既有文件。',
  ].join('\n');
  try {
    const decision = decideAgentFileWrite({
      absPath: path.join(allowedRoot, 'linked', 'report.md'),
      workspaceRoot,
      context: {
        purpose: 'markdown-deliverable',
        userRequested: true,
        requestPrompt,
      },
    });
    assert.equal(decision.action, 'deny');
    assert.equal(decision.reason, 'isolated-artifact-scope');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('AgentFileWritePolicy: ordinary prompts keep normal workspace write behavior', () => {
  const decision = decideAgentFileWrite({
    absPath: '/workspace/src/main.cpp',
    workspaceRoot: '/workspace',
    context: {
      purpose: 'workspace-edit',
      userRequested: true,
      requestPrompt: '请修复 src/main.cpp 的编译错误。',
    },
  });

  assert.equal(decision.action, 'allow');
  assert.equal(decision.reason, 'workspace-write-allowed');
});

test('AgentFileWritePolicy: implementation prompts allow explicitly named source and test files', () => {
  const requestPrompt = '请实现 src/repeat-label.js，并新增 test/repeat-label.test.js。repeatLabel("devseek", 3) 应返回 devseek-devseek-devseek。对非法负数 count 抛出错误，改完运行 node test/repeat-label.test.js。';
  const decide = relPath => decideAgentFileWrite({
    absPath: path.join('/workspace', relPath),
    workspaceRoot: '/workspace',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'create_file',
      displayName: relPath,
      requestPrompt,
    },
  });

  assert.equal(decide('src/repeat-label.js').action, 'allow');
  assert.equal(decide('test/repeat-label.test.js').action, 'allow');
  const unrelated = decide('src/other.js');
  assert.equal(unrelated.action, 'deny');
  assert.equal(unrelated.reason, 'target-file-write-prohibited');
});

test('AgentFileWritePolicy: validation health repair permits discovered source targets only', () => {
  const requestPrompt = 'CI is red, get it green.';
  const decide = (relPath, prompt = requestPrompt) => decideAgentFileWrite({
    absPath: path.join('/workspace', relPath),
    workspaceRoot: '/workspace',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'replace_in_file',
      displayName: relPath,
      requestPrompt: prompt,
    },
  });

  assert.equal(decide('src/parser.js').action, 'allow');
  const nonSource = decide('README.md');
  assert.equal(nonSource.action, 'deny');
  assert.equal(nonSource.reason, 'markdown-artifact-target-not-requested');
  const noWrite = decide('src/parser.js', 'CI is red, get it green, but do not change files.');
  assert.equal(noWrite.action, 'deny');
  assert.equal(noWrite.reason, 'all-file-writes-prohibited');
});

test('AgentFileWritePolicy: repair prompts allow the named source file and block sibling writes', () => {
  const requestPrompt = '请修复 src/math.js 中 add(a, b) 的明显错误。要求 add(2, 3) 返回 5，修改后用 node 命令验证并结束任务。不要修改其他文件。';
  const allowed = decideAgentFileWrite({
    absPath: '/workspace/src/math.js',
    workspaceRoot: '/workspace',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'replace_in_file',
      displayName: 'src/math.js',
      requestPrompt,
    },
  });
  assert.equal(allowed.action, 'allow');

  const extra = decideAgentFileWrite({
    absPath: '/workspace/src/other.js',
    workspaceRoot: '/workspace',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'replace_in_file',
      displayName: 'src/other.js',
      requestPrompt,
    },
  });
  assert.equal(extra.action, 'deny');
  assert.equal(extra.reason, 'artifact-other-file-write-prohibited');
});

test('AgentFileWritePolicy: explicit nested standalone source target survives no-other-file constraint', () => {
  const requestPrompt = [
    '我在真实项目里需要一个小 Python 命令行工具 tools/log_summary.py。',
    '它从 stdin 读取日志文本，统计包含 ERROR 和 WARN 的行数，输出格式先用 ERROR=<n> WARN=<n>。',
    '请实现最小版本并用 python 命令自测；不要引入依赖，不要改其他文件。',
  ].join('');
  const allowed = decideAgentFileWrite({
    absPath: '/workspace/project/tools/log_summary.py',
    workspaceRoot: '/workspace/project',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'create',
      displayName: 'tools/log_summary.py',
      requestPrompt,
    },
  });
  assert.equal(allowed.action, 'allow');

  const extra = decideAgentFileWrite({
    absPath: '/workspace/project/tools/other.py',
    workspaceRoot: '/workspace/project',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'create',
      displayName: 'tools/other.py',
      requestPrompt,
    },
  });
  assert.equal(extra.action, 'deny');
  assert.equal(extra.reason, 'artifact-other-file-write-prohibited');
});

test('AgentFileWritePolicy: no-new-file follow-up still allows editing the named existing target', () => {
  const requestPrompt = [
    '继续刚才的工具：下游系统现在只接受一行 JSON。',
    '请把 tools/log_summary.py 的输出改成 JSON 对象，保留从 stdin 读取日志的行为。',
    '不要新增文件，改完用 python 命令自测。',
  ].join('');

  const updateExisting = decideAgentFileWrite({
    absPath: '/workspace/project/tools/log_summary.py',
    workspaceRoot: '/workspace/project',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'replace_in_file',
      displayName: 'tools/log_summary.py',
      requestPrompt,
    },
  });
  assert.equal(updateExisting.action, 'allow');

  const createMissingTarget = decideAgentFileWrite({
    absPath: '/workspace/project/tools/log_summary.py',
    workspaceRoot: '/workspace/project',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'create',
      displayName: 'tools/log_summary.py',
      requestPrompt,
    },
  });
  assert.equal(createMissingTarget.action, 'deny');
  assert.equal(createMissingTarget.reason, 'all-file-writes-prohibited');
});

test('AgentFileWritePolicy: an explicit source directory authorizes nested semantic owners only', () => {
  const requestPrompt = [
    '请直接修改当前既有 Node.js 项目。',
    '只允许修改 `src/` 下的生产代码，不得修改 `tests/`、`package.json`。',
  ].join('\n');
  const decide = relativePath => decideAgentFileWrite({
    absPath: `/workspace/${relativePath}`,
    workspaceRoot: '/workspace',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'replace_in_file',
      displayName: relativePath,
      requestPrompt,
    },
  });

  assert.equal(decide('src/domain/maintenance-window.js').action, 'allow');
  assert.equal(decide('src/index.js').action, 'allow');
  assert.equal(decide('tests/maintenance-window.test.js').action, 'deny');
  assert.equal(decide('package.json').action, 'deny');
});

test('AgentFileWritePolicy: unquoted C++ source directories authorize nested files', () => {
  const requestPrompt = [
    '请完成现有 C++17 调度器。',
    '只允许修改 include/ 和 src/。不得修改 CMakeLists.txt、test.sh 或 tests/。',
  ].join('\n');
  const decide = relativePath => decideAgentFileWrite({
    absPath: `/workspace/${relativePath}`,
    workspaceRoot: '/workspace',
    autopilotMode: true,
    context: {
      purpose: 'tool-write',
      userRequested: false,
      taskAction: 'replace_in_file',
      displayName: relativePath,
      requestPrompt,
    },
  });

  assert.equal(decide('src/domain/job_scheduler.cpp').action, 'allow');
  assert.equal(decide('include/job_scheduler.hpp').action, 'allow');
  assert.equal(decide('tests/job_scheduler.test.cpp').action, 'deny');
});

console.log('\nAgent file write policy tests passed.\n');
