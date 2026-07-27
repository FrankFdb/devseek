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
const bundlePath = path.join(rootDir, 'test/unit/artifact-quality-oracle.bundle.cjs');

execSync(
  `npx esbuild src/agent/artifact-quality-oracle.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  evaluateArtifactQualityOracle,
} = createRequire(import.meta.url)(bundlePath);

function withTempWorkspace(prefix, fn) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeArtifact(root, relPath, content) {
  const absPath = path.join(root, relPath);
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, `${content.trimEnd()}\n`, 'utf8');
  return {
    path: absPath,
    basename: path.basename(absPath),
    linesAdded: content.split(/\r?\n/).length,
    linesRemoved: 0,
    action: 'create',
  };
}

test('artifact quality oracle: missing literal anchors fail the generated artifact gate', () => {
  withTempWorkspace('devseek-artifact-literal-', (root) => {
    const written = writeArtifact(root, 'docs/r3-iteration/login-ready.md', [
      '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
      '',
      'BridgeHealthCheck 已记录。',
    ].join('\n'));
    const prompt = [
      '请创建 Markdown 审计报告。',
      '报告必须逐字包含以下验收锚点：',
      '- R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
      '- BridgeHealthCheck',
      '- login-state-not-send-button',
    ].join('\n');

    const result = evaluateArtifactQualityOracle([written], root, prompt);

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /artifact_quality:missing-literal-anchor/);
    assert.match(result.feedbackForAI, /login-state-not-send-button/);
  });
});

test('artifact quality oracle: stale warranty domain anchors fail DevSeek process artifacts', () => {
  withTempWorkspace('devseek-artifact-stale-', (root) => {
    const written = writeArtifact(root, 'docs/r3-iteration/r3-08a-vscode-collaboration.md', [
      '# R3-08A-VSCODE-USER-COLLABORATION',
      '',
      '本轮继续复用 uav-warranty-reminder 的 maintenance_threshold_engine 作为验收依据。',
    ].join('\n'));
    const prompt = '请创建 DevSeek R3 VSCode collaboration 审计报告。';

    const result = evaluateArtifactQualityOracle([written], root, prompt);

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /artifact_quality:stale-domain-anchor/);
    assert.match(result.feedbackForAI, /uav-warranty-reminder/);
  });
});

test('artifact quality oracle: historical warranty meta wording is allowed when it is not a stale anchor substitute', () => {
  withTempWorkspace('devseek-artifact-stale-meta-', (root) => {
    const written = writeArtifact(root, 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md', [
      '# R3-LIVE-DEEPSEEK-LOGIN-READY-STATE',
      '',
      'uav-warranty-reminder 是历史反例，不能结算本轮 login-ready 审计。',
      'BridgeHealthCheck 和 plugin-opened DeepSeek page 才是本轮边界。',
    ].join('\n'));
    const prompt = '请创建 DevSeek R3 login-ready 审计报告。';

    const result = evaluateArtifactQualityOracle([written], root, prompt);

    assert.equal(result, undefined);
  });
});

test('artifact quality oracle: writing an input source path does not satisfy the requested output deliverable', () => {
  withTempWorkspace('devseek-artifact-deliverable-', (root) => {
    const source = writeArtifact(root, 'docs/r3-iteration/deepseek-login-ready-state-matrix.md', '# source matrix');
    const target = path.join(root, 'docs/r3-iteration/r3-live-deepseek-login-ready-state.md');
    const prompt = [
      `请基于 ${source.path} 创建 Markdown 审计报告。`,
      `请把报告保存到 ${target}。`,
    ].join('\n');

    const result = evaluateArtifactQualityOracle([source], root, prompt);

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /artifact_quality:required-deliverable-mismatch/);
    assert.match(result.feedbackForAI, /r3-live-deepseek-login-ready-state\.md/);
    assert.doesNotMatch(result.feedbackForAI, /指定交付文件：.*deepseek-login-ready-state-matrix\.md/);
  });
});

test('artifact quality oracle: generic warranty advice cannot replace source-backed warranty facts', () => {
  withTempWorkspace('devseek-artifact-warranty-generic-', (root) => {
    const report = writeArtifact(root, 'src/oam/src/lifting/zc_maintenance/docs/warranty-maintenance-advice.md', [
      '# 维保建议',
      '',
      '建议建立维保策略，做好定期检查，及时维护设备并完善保养记录。',
      '团队可以根据运行情况逐步优化保修建议。',
    ].join('\n'));
    const plan = path.join(root, 'src/oam/src/lifting/zc_maintenance/docs/uav-warranty-reminder-plan_v1.7.md');
    const oldCode = path.join(root, 'src/oam/src/lifting/maintenance/maintenance_old.cpp');
    const prompt = [
      `请基于 ${plan} 和 ${oldCode} 创建 Markdown 维保实现建议报告。`,
      `请保存到 ${report.path}。`,
    ].join('\n');

    const result = evaluateArtifactQualityOracle([report], root, prompt);

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /artifact_quality:generic-warranty-false-positive/);
    assert.match(result.feedbackForAI, /uav-warranty-reminder-plan_v1\.7\.md/);
  });
});

test('artifact quality oracle: explicit Chinese report requirement rejects English-only prose', () => {
  withTempWorkspace('devseek-artifact-zh-lang-', (root) => {
    const written = writeArtifact(root, 'docs/report.md', [
      '# Login Ready Audit',
      '',
      'This report explains provider readiness, browser state, bridge health, selector drift, completion evidence, validation risk, artifact quality, recovery actions, and final acceptance boundaries.',
      'Every section is written as English prose without localized explanation.',
    ].join('\n'));
    const prompt = '请用中文生成测试报告，技术标识符可以保持原文。';

    const result = evaluateArtifactQualityOracle([written], root, prompt);

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /artifact_quality:artifact-language-mismatch/);
    assert.match(result.feedbackForAI, /expected_language=zh/);
  });
});

test('artifact quality oracle: explicit English report requirement rejects Chinese prose', () => {
  withTempWorkspace('devseek-artifact-en-lang-', (root) => {
    const written = writeArtifact(root, 'docs/report.md', [
      '# 审计报告',
      '',
      '本报告说明登录状态、浏览器会话、桥接健康、选择器漂移、完成证据、验证风险、成果物质量、恢复动作和最终验收边界。',
      '正文使用中文描述，没有按照英文报告要求输出。',
    ].join('\n'));
    const prompt = 'Write the generated report in English; identifiers may stay unchanged.';

    const result = evaluateArtifactQualityOracle([written], root, prompt);

    assert.equal(result.qualityGate.status, 'fail');
    assert.match(result.feedbackForAI, /artifact_quality:artifact-language-mismatch/);
    assert.match(result.feedbackForAI, /expected_language=en/);
  });
});
