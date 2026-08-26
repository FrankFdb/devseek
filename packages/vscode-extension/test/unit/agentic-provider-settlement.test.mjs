/**
 * Unit tests for agentic provider-failure settlement.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const bundlePath = path.join(rootDir, 'test/unit/agentic-provider-settlement.bundle.cjs');
const initialBundlePath = path.join(rootDir, 'test/unit/agentic-provider-settlement-initial.bundle.cjs');
const actionBundlePath = path.join(rootDir, 'test/unit/agentic-provider-settlement-action.bundle.cjs');

for (const [entry, outfile] of [
  ['src/agent/agentic-provider-settlement.ts', bundlePath],
  ['src/intent/model-led-semantic-contract.ts', initialBundlePath],
  ['src/intent/model-action-semantic-contract.ts', actionBundlePath],
]) {
  execSync(
    `npx esbuild ${entry} --bundle --outfile=${outfile} --format=cjs --platform=node`,
    { cwd: rootDir, stdio: 'pipe' },
  );
}

const req = createRequire(import.meta.url);
const { settleProviderFailureFromCompletedEvidence } = req(bundlePath);
const { createModelLedTurnSemanticContract } = req(initialBundlePath);
const { projectModelActionSemanticContract } = req(actionBundlePath);

function filePrompt() {
  return [
    'UI-R1A1B-CLEAN2-20260715-4a148c',
    '请在当前工作区创建 ui-r1a1b-clean2-4a148c.txt。',
    '文件内容必须精确包含一行 UI_R1A1B_CLEAN2_OK。',
    '完成写入和读回验证后结束任务，不要修改其他用户文件。',
  ].join(' ');
}

test('provider failure settlement completes only after local file-check evidence satisfies the task', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-'));
  try {
    const file = path.join(root, 'ui-r1a1b-clean2-4a148c.txt');
    writeFileSync(file, 'UI_R1A1B_CLEAN2_OK\n');
    const writtenFiles = [{ path: file, basename: 'ui-r1a1b-clean2-4a148c.txt', linesAdded: 1, linesRemoved: 0, action: 'create' }];
    const terminalEvidence = [{
      command: "test -f 'ui-r1a1b-clean2-4a148c.txt' && wc -c 'ui-r1a1b-clean2-4a148c.txt' && sed -n '1,80p' 'ui-r1a1b-clean2-4a148c.txt'",
      kind: 'other',
      ok: true,
      exitCode: 0,
    }];

    const result = settleProviderFailureFromCompletedEvidence({
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      currentWriteCohortValidated: true,
      semanticContract: fileArtifactContract(filePrompt(), file),
      writtenFiles,
      terminalEvidence,
      readEvidencePaths: [],
      workspaceRoot: root,
    });

    assert.equal(result.completed, true);
    assert.match(result.summary, /处理 1 个文件/);
    assert.match(result.summary, /验证证据已通过/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('completed local evidence cannot bypass an independent completion blocker', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-gated-'));
  try {
    const file = path.join(root, 'ui-r1a1b-clean2-4a148c.txt');
    writeFileSync(file, 'UI_R1A1B_CLEAN2_OK\n');
    const result = settleProviderFailureFromCompletedEvidence({
      providerFailureStatus: 'invalid-tool-block',
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      currentWriteCohortValidated: true,
      semanticContract: fileArtifactContract(filePrompt(), file),
      writtenFiles: [{ path: file, basename: path.basename(file), linesAdded: 1, linesRemoved: 0, action: 'create' }],
      terminalEvidence: [{
        command: "test -f 'ui-r1a1b-clean2-4a148c.txt'",
        kind: 'other',
        ok: true,
        exitCode: 0,
      }],
      readEvidencePaths: [],
      workspaceRoot: root,
      completionBlockers: ['independent requirement review still has blocking findings'],
    });

    assert.equal(result.completed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider failure settlement completes scoped Markdown deliverable before starting another recovery', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-scoped-md-'));
  try {
    const matrix = path.join(root, 'docs', 'r3-iteration', 'deepseek-login-ready-state-matrix.md');
    const contract = path.join(root, 'src', 'deepseek-web-health', 'deepseek-login-ready-state-contract.ts');
    const report = path.join(root, 'docs', 'r3-iteration', 'r3-live-deepseek-login-ready-state.md');
    mkdirSync(path.dirname(matrix), { recursive: true });
    mkdirSync(path.dirname(contract), { recursive: true });
    writeFileSync(matrix, 'R3-LIVE-DEEPSEEK-LOGIN-READY-STATE\n');
    writeFileSync(contract, 'export const owner = "BridgeHealthCheck";\n');
    writeFileSync(report, '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE\n\nBridgeHealthCheck\n');
    const prompt = [
      `请基于 ${matrix} 和 ${contract} 创建 Markdown 审计报告。`,
      `请把报告保存到 ${report}。`,
      '本次只允许创建这一份 Markdown 文件；不要修改任何源码，不要运行编译或测试命令。',
      '报告正文请使用与本测试 case 相同的中文撰写；技术标识符、协议名、文件路径和验收锚点保持原文。',
    ].join('\n');
    const result = settleProviderFailureFromCompletedEvidence({
      providerFailureStatus: 'incomplete-tool-block',
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      currentWriteCohortValidated: true,
      semanticContract: fileArtifactContract(prompt, report),
      writtenFiles: [{ path: report, basename: path.basename(report), linesAdded: 3, linesRemoved: 0, action: 'create' }],
      terminalEvidence: [{
        command: "test -f 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md' && wc -c 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md' && sed -n '1,80p' 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md'",
        kind: 'other',
        ok: true,
        exitCode: 0,
      }],
      readEvidencePaths: [matrix, contract],
      workspaceRoot: root,
    });

    assert.equal(result.completed, true);
    assert.match(result.summary, /处理 1 个文件/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('tool protocol failure cannot settle from read-only evidence while an action remains unresolved', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-read-only-'));
  try {
    const source = path.join(root, 'README.md');
    writeFileSync(source, '# Evidence\n');
    const semanticContract = projectModelActionSemanticContract(
      createModelLedTurnSemanticContract('读取 README.md 后继续完成任务。'),
      {
        version: 'devseek.semantic-intent/v1',
        source: 'provider',
        mode: 'inspect',
        taskKind: 'read-only-analysis',
        confidence: 0.98,
        mutation: 'none',
        targetPaths: [source],
        requiresWorkspace: true,
        requiresTerminal: false,
        requiresExternalEffect: false,
        requiresClarification: false,
        reason: 'normalized observation action',
      },
    );

    const result = settleProviderFailureFromCompletedEvidence({
      providerFailureStatus: 'invalid-tool-block',
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      currentWriteCohortValidated: true,
      semanticContract,
      writtenFiles: [],
      terminalEvidence: [],
      readEvidencePaths: [source],
      workspaceRoot: root,
    });

    assert.equal(result.completed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('observed invalid mutation proposal cannot settle from earlier successful validation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-unsettled-action-'));
  try {
    const source = path.join(root, 'src', 'main.cpp');
    mkdirSync(path.dirname(source), { recursive: true });
    writeFileSync(source, 'int main() { return 0; }\n');
    const semanticContract = projectModelActionSemanticContract(
      createModelLedTurnSemanticContract('继续修改现有 C++ 程序并执行公开验证。'),
      {
        version: 'devseek.semantic-intent/v1',
        source: 'provider',
        mode: 'run',
        taskKind: 'workspace-command',
        confidence: 0.98,
        mutation: 'none',
        targetPaths: [],
        requiresWorkspace: true,
        requiresTerminal: true,
        requiresExternalEffect: false,
        requiresClarification: false,
        reason: 'the model validated before proposing a source mutation',
      },
    );

    const result = settleProviderFailureFromCompletedEvidence({
      providerFailureStatus: 'invalid-tool-block',
      unsettledToolProposal: true,
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      currentWriteCohortValidated: true,
      semanticContract,
      writtenFiles: [],
      terminalEvidence: [{ command: './test.sh', kind: 'test', ok: true, exitCode: 0 }],
      readEvidencePaths: [source],
      workspaceRoot: root,
    });

    assert.equal(result.completed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider-authored tool transcript cannot settle from otherwise sufficient read evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-polluted-'));
  try {
    const source = path.join(root, 'README.md');
    writeFileSync(source, '# Trusted local evidence\n');
    const semanticContract = projectModelActionSemanticContract(
      createModelLedTurnSemanticContract('读取 README.md 并说明标题。'),
      {
        version: 'devseek.semantic-intent/v1',
        source: 'provider',
        mode: 'inspect',
        taskKind: 'read-only-analysis',
        confidence: 0.98,
        mutation: 'none',
        targetPaths: [source],
        requiresWorkspace: true,
        requiresTerminal: false,
        requiresExternalEffect: false,
        requiresClarification: false,
        reason: 'normalized observation action',
      },
    );

    const result = settleProviderFailureFromCompletedEvidence({
      providerFailureStatus: 'provider-authored-tool-transcript',
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      currentWriteCohortValidated: true,
      semanticContract,
      writtenFiles: [],
      terminalEvidence: [],
      readEvidencePaths: [source],
      workspaceRoot: root,
    });

    assert.equal(result.completed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider failure settlement refuses missing or failed validation evidence', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-blocked-'));
  try {
    const file = path.join(root, 'ui-r1a1b-clean2-4a148c.txt');
    writeFileSync(file, 'UI_R1A1B_CLEAN2_OK\n');
    const base = {
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      currentWriteCohortValidated: true,
      semanticContract: fileArtifactContract(filePrompt(), file),
      writtenFiles: [{ path: file, basename: 'ui-r1a1b-clean2-4a148c.txt', linesAdded: 1, linesRemoved: 0, action: 'create' }],
      readEvidencePaths: [],
      workspaceRoot: root,
    };

    assert.equal(settleProviderFailureFromCompletedEvidence({ ...base, terminalEvidence: [] }).completed, false);
    assert.equal(settleProviderFailureFromCompletedEvidence({
      ...base,
      terminalEvidence: [{ command: 'g++ broken.cpp', kind: 'compile', ok: false, exitCode: 1 }],
    }).completed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('provider corruption cannot settle from validation that predates the latest write cohort', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'devseek-provider-settlement-stale-validation-'));
  try {
    const file = path.join(root, 'ui-r1a1b-clean2-4a148c.txt');
    writeFileSync(file, 'UI_R1A1B_CLEAN2_OK\n');
    const result = settleProviderFailureFromCompletedEvidence({
      providerFailureStatus: 'invalid-tool-block',
      promptRequiresTools: true,
      sawWorkTool: true,
      aborted: false,
      currentWriteCohortValidated: false,
      semanticContract: fileArtifactContract(filePrompt(), file),
      writtenFiles: [{ path: file, basename: path.basename(file), linesAdded: 1, linesRemoved: 0, action: 'replace' }],
      terminalEvidence: [{
        command: "test -f 'ui-r1a1b-clean2-4a148c.txt'",
        kind: 'other',
        ok: true,
        exitCode: 0,
      }],
      readEvidencePaths: [],
      workspaceRoot: root,
    });

    assert.equal(result.completed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function fileArtifactContract(prompt, target) {
  return projectModelActionSemanticContract(
    createModelLedTurnSemanticContract(prompt),
    {
      version: 'devseek.semantic-intent/v1',
      source: 'provider',
      mode: 'edit',
      taskKind: 'file-artifact',
      confidence: 0.98,
      mutation: 'create-file',
      targetPaths: [target],
      requiresWorkspace: true,
      requiresTerminal: false,
      requiresExternalEffect: false,
      requiresClarification: false,
      reason: 'normalized file artifact action',
    },
  );
}
