import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const execFile = promisify(execFileCallback);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('top-agent user simulation runner plans targeted checks before broad controlled VSIX suites', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['scripts/devseek-top-agent-user-simulation-runner.mjs', '--dry-run'],
    { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
  );
  const report = JSON.parse(stdout);

  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.equal(report.execution_mode, 'dry-run');
  assert.equal(report.schema_version, 'devseek.top-agent-user-simulation-runner/v1');
  assert.equal(report.strategy.name, 'targeted-before-broad-user-simulation');
  assert.equal(report.strategy.qualification_effect, 'NONE');
  assert.equal(report.strategy.claims_permitted, false);
  assert.equal(report.plan.strategy, 'fixpoint-before-broad-regression');
  assert.equal(report.plan.user_simulation_boundary.includes('not T5 live DeepSeek Web'), true);
  assert.equal(report.plan.steps[0].id, 'targeted-local-contracts');
  assert.equal(report.plan.steps[0].kind, 'targeted-local-contract');

  const controlledSuites = report.plan.steps
    .filter(step => step.kind === 'controlled-vsix-user-simulation')
    .map(step => step.command[step.command.indexOf('--suite') + 1]);
  assert.deepEqual(controlledSuites, [
    'r2-07e-stream-protocol',
    'journey-core',
    'realistic-product',
    'coding-conformance-product',
    'r2-07f-connector-security',
  ]);
  assert.deepEqual(report.process_monitoring.snapshot_stages, [
    'start',
    'before-each-step',
    'after-each-step',
    'end',
  ]);
});

test('top-agent user simulation runner can narrow to one focused controlled suite', async () => {
  const { stdout } = await execFile(
    process.execPath,
    [
      'scripts/devseek-top-agent-user-simulation-runner.mjs',
      '--dry-run',
      '--skip-targeted',
      '--controlled-suites',
      'realistic-product',
    ],
    { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
  );
  const report = JSON.parse(stdout);

  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.equal(report.plan.steps.length, 1);
  assert.equal(report.plan.steps[0].id, 'controlled-realistic-product');
  assert.equal(report.plan.steps[0].command.includes('--report'), true);
  assert.equal(report.plan.steps[0].live_provider, false);
});

test('top-agent user simulation runner rejects unsupported arguments', async () => {
  await assert.rejects(
    execFile(
      process.execPath,
      ['scripts/devseek-top-agent-user-simulation-runner.mjs', '--dry-run', '--live-provider'],
      { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
    ),
    error => {
      const report = JSON.parse(error.stdout);
      assert.equal(report.ok, false);
      assert.ok(report.errors.includes('argument:unsupported---live-provider'));
      assert.equal(report.strategy.qualification_effect, 'NONE');
      return true;
    },
  );
});

test('top-agent user simulation runner prints compact execute summaries and stores full evidence', async () => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-top-agent-runner-test-'));
  try {
    const { stdout } = await execFile(
      process.execPath,
      [
        'scripts/devseek-top-agent-user-simulation-runner.mjs',
        '--run-id',
        'compact-summary-test',
        '--skip-targeted',
        '--skip-controlled',
        '--evidence-root',
        evidenceRoot,
      ],
      { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
    );
    const summary = JSON.parse(stdout);
    const fullReportPath = path.join(evidenceRoot, 'top-agent-user-simulation-runner.report.json');
    const fullReport = JSON.parse(fs.readFileSync(fullReportPath, 'utf8'));

    assert.equal(summary.ok, true, JSON.stringify(summary.errors, null, 2));
    assert.equal(summary.execution_mode, 'execute');
    assert.equal(summary.plan, undefined);
    assert.deepEqual(summary.steps, []);
    assert.equal(summary.process_monitoring.snapshots, 2);
    assert.equal(fullReport.plan.strategy, 'fixpoint-before-broad-regression');
    assert.deepEqual(fullReport.process_monitoring.snapshot_stages, ['start', 'end']);
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
});

test('top-agent user simulation runner renders markdown from existing evidence without rerunning cases', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-top-agent-render-test-'));
  try {
    const reportPath = path.join(root, 'existing.report.json');
    const markdownPath = path.join(root, 'report.md');
    fs.writeFileSync(reportPath, `${JSON.stringify({
      ok: true,
      schema_version: 'devseek.top-agent-user-simulation-runner/v1',
      run_id: 'existing-evidence',
      started_at: '2026-08-13T00:00:00.000Z',
      ended_at: '2026-08-13T00:00:01.000Z',
      repo: { head: 'abc1234', dirty_tracked_paths: [], dirty_cached_paths: [], untracked_paths: [] },
      execution_mode: 'execute',
      evidence_root: 'code/devseek-tests/top-agent-convergence/runs/existing-evidence',
      markdown_report: null,
      strategy: {
        name: 'targeted-before-broad-user-simulation',
        reason: 'Run small replay/contract checks first, then controlled VSIX user journeys.',
        qualification_effect: 'NONE',
        claims_permitted: false,
        gate0_status_effect: 'NONE',
      },
      process_monitoring: {
        snapshot_stages: ['start', 'end'],
        high_usage_observations: [],
        controlled_residuals_terminated: [],
        residual_errors: [],
      },
      plan: {
        source_plan: 'docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md',
      },
      steps: [
        {
          id: 'controlled-realistic-product',
          kind: 'controlled-vsix-user-simulation',
          ok: true,
          stdout_log: 'evidence/realistic-product.stdout.log',
          report_path: 'evidence/realistic-product.report.json',
          controlledReport: {
            ok: true,
            scenario: {
              cases: [
                { id: 'realistic-python-log-tool' },
                { id: 'realistic-python-log-json-followup' },
              ],
            },
            bridge: { providerInvocationCount: 2 },
          },
        },
      ],
      summary: {
        ok: true,
        total_steps: 1,
        passed_steps: 1,
        failed_steps: [],
        controlled_suites: ['realistic-product'],
        controlled_cases: ['realistic-python-log-tool', 'realistic-python-log-json-followup'],
        snapshots: 2,
        high_usage_observations: 0,
        controlled_residuals_terminated: 0,
        qualification_effect: 'NONE',
        claims_permitted: false,
      },
      errors: [],
    }, null, 2)}\n`, 'utf8');

    const { stdout } = await execFile(
      process.execPath,
      [
        'scripts/devseek-top-agent-user-simulation-runner.mjs',
        '--from-report',
        reportPath,
        '--markdown',
        markdownPath,
      ],
      { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
    );
    const summary = JSON.parse(stdout);
    const markdown = fs.readFileSync(markdownPath, 'utf8');

    assert.equal(summary.ok, true, JSON.stringify(summary.errors, null, 2));
    assert.equal(summary.execution_mode, 'execute');
    assert.equal(summary.report_render_mode, 'from-report');
    assert.equal(summary.steps.length, 1);
    assert.match(markdown, /## Actual User Cases/);
    assert.match(markdown, /Report render mode: `from-report`/);
    assert.match(markdown, /## Findings And Fixes/);
    assert.match(markdown, /does not overwrite the original execution evidence/);
    assert.match(markdown, /realistic-python-log-json-followup/);
    assert.equal(fs.existsSync(path.join(repoRoot, 'code/devseek-tests/top-agent-convergence/runs', summary.run_id)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('top-agent user simulation runner reuses a passing evidence root unless forced', async () => {
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-top-agent-reuse-test-'));
  try {
    const reportPath = path.join(evidenceRoot, 'top-agent-user-simulation-runner.report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify({
      ok: true,
      schema_version: 'devseek.top-agent-user-simulation-runner/v1',
      run_id: 'reuse-test',
      started_at: '2026-08-13T00:00:00.000Z',
      ended_at: '2026-08-13T00:00:01.000Z',
      repo: { head: 'abc1234', dirty_tracked_paths: [], dirty_cached_paths: [], untracked_paths: [] },
      execution_mode: 'execute',
      evidence_root: evidenceRoot,
      markdown_report: null,
      strategy: {
        name: 'targeted-before-broad-user-simulation',
        reason: 'Run small replay/contract checks first, then controlled VSIX user journeys.',
        qualification_effect: 'NONE',
        claims_permitted: false,
        gate0_status_effect: 'NONE',
      },
      process_monitoring: {
        snapshot_stages: ['start', 'end'],
        high_usage_observations: [],
        controlled_residuals_terminated: [],
        residual_errors: [],
      },
      plan: {
        source_plan: 'docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md',
      },
      steps: [],
      summary: {
        ok: true,
        total_steps: 0,
        passed_steps: 0,
        failed_steps: [],
        controlled_suites: [],
        controlled_cases: [],
        snapshots: 2,
        high_usage_observations: 0,
        controlled_residuals_terminated: 0,
        qualification_effect: 'NONE',
        claims_permitted: false,
      },
      errors: [],
    }, null, 2)}\n`, 'utf8');

    const { stdout } = await execFile(
      process.execPath,
      [
        'scripts/devseek-top-agent-user-simulation-runner.mjs',
        '--run-id',
        'reuse-test',
        '--evidence-root',
        evidenceRoot,
      ],
      { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
    );
    const summary = JSON.parse(stdout);
    const unchangedReport = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    assert.equal(summary.ok, true, JSON.stringify(summary.errors, null, 2));
    assert.equal(summary.execution_mode, 'execute');
    assert.equal(summary.report_render_mode, 'reuse-existing');
    assert.equal(summary.summary.snapshots, 2);
    assert.deepEqual(summary.steps, []);
    assert.equal(unchangedReport.execution_mode, 'execute');
    assert.equal(unchangedReport.report_render_mode, undefined);
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
  }
});
