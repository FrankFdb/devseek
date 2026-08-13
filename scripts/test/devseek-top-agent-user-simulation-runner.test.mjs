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

test('controlled VSIX harness exposes a machine-readable suite case catalog', async () => {
  const { stdout } = await execFile(
    process.execPath,
    ['packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs', '--list-suites-json'],
    { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
  );
  const catalog = JSON.parse(stdout);

  assert.equal(catalog.schema_version, 'devseek.controlled-vsix-suite-catalog/v1');
  assert.deepEqual(
    catalog.suites['agent-fit-product'].map(entry => entry.id),
    [
      'agent-fit-ambiguous-clarify',
      'agent-fit-review-only',
      'agent-fit-multifile-with-test',
      'agent-fit-markdown-report-anchors',
      'agent-fit-openai-tool-calls-wrapper',
    ],
  );
  assert.deepEqual(
    catalog.suites['prior-task-continuation-product'].map(entry => entry.id),
    [
      'prior-plan-source-change',
      'prior-plan-go-ahead',
    ],
  );
  assert.deepEqual(
    catalog.suites['scope-replacement-product'].map(entry => entry.id),
    [
      'scope-replace-alpha-plan',
      'scope-replace-beta-instead',
    ],
  );
  assert.deepEqual(
    catalog.suites['cancellation-replacement-product'].map(entry => entry.id),
    [
      'cancel-plan-source-change',
      'cancel-review-instead',
    ],
  );
  assert.ok(catalog.suites['coding-conformance-product'].some(entry =>
    entry.id === 'conformance-verify-repair-reverify'
  ));
  assert.ok(catalog.suites['coding-conformance-product'].some(entry =>
    entry.id === 'conformance-ci-green-repair'
  ));
  assert.ok(catalog.suites['coding-conformance-product'].some(entry =>
    entry.id === 'conformance-cn-tests-pass-repair'
  ));
  assert.ok(catalog.suites['coding-conformance-product'].some(entry =>
    entry.id === 'conformance-project-health-repair'
  ));
  assert.ok(catalog.suites['coding-conformance-product'].some(entry =>
    entry.id === 'conformance-runtime-error-repair'
  ));
  assert.ok(catalog.suites['coding-conformance-product'].some(entry =>
    entry.id === 'conformance-user-symptom-repair'
  ));
});

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
  assert.equal(report.plan.coverage_profile, 'top-agent-local-acceptance');
  assert.equal(report.case_design_review.ok, true, JSON.stringify(report.case_design_review, null, 2));
  assert.equal(report.case_design_review.enforced, true);
  assert.equal(report.case_design_review.acceptance_plan_eligible, true);
  assert.equal(report.case_design_review.acceptance_execution_eligible, false);
  assert.equal(report.case_design_review.release_claim_permitted, false);
  assert.deepEqual(report.case_design_review.missing_dimensions, []);
  assert.ok(report.case_design_review.selected_cases.includes('agent-fit-openai-tool-calls-wrapper'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('conformance-verify-repair-reverify'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('conformance-ci-green-repair'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('conformance-cn-tests-pass-repair'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('conformance-project-health-repair'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('conformance-runtime-error-repair'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('conformance-user-symptom-repair'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('prior-plan-source-change'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('prior-plan-go-ahead'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('scope-replace-alpha-plan'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('scope-replace-beta-instead'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('cancel-plan-source-change'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('cancel-review-instead'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('semantic-source-proposal-route-consistency'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('semantic-readonly-proposal-route-consistency'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('semantic-workspace-answer-route-consistency'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('semantic-code-review-proposal-route-consistency'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('semantic-clarification-proposal-route-consistency'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('semantic-clarification-workspace-scope-consistency'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('semantic-terminal-validation-route-consistency'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('semantic-external-effect-confirmation-consistency'));
  assert.ok(report.case_design_review.required_acceptance_cases.includes('external-semantic-intent-routing-matrix'));
  assert.ok(report.case_design_review.selected_cases.includes('semantic-source-proposal-route-consistency'));
  assert.ok(report.case_design_review.selected_cases.includes('semantic-workspace-answer-route-consistency'));
  assert.ok(report.case_design_review.selected_cases.includes('semantic-code-review-proposal-route-consistency'));
  assert.ok(report.case_design_review.selected_cases.includes('semantic-clarification-workspace-scope-consistency'));
  assert.ok(report.case_design_review.selected_cases.includes('semantic-terminal-validation-route-consistency'));
  assert.ok(report.case_design_review.selected_cases.includes('semantic-external-effect-confirmation-consistency'));
  assert.ok(report.case_design_review.selected_cases.includes('external-semantic-intent-routing-matrix'));
  assert.equal(report.plan.steps[0].id, 'targeted-local-contracts');
  assert.equal(report.plan.steps[0].kind, 'targeted-local-contract');
  assert.deepEqual(report.plan.steps[0].case_ids, [
    'semantic-source-proposal-route-consistency',
    'semantic-readonly-proposal-route-consistency',
    'semantic-workspace-answer-route-consistency',
    'semantic-code-review-proposal-route-consistency',
    'semantic-clarification-proposal-route-consistency',
    'semantic-clarification-workspace-scope-consistency',
    'semantic-terminal-validation-route-consistency',
    'semantic-external-effect-confirmation-consistency',
    'external-semantic-intent-routing-matrix',
  ]);

  const controlledSuites = report.plan.steps
    .filter(step => step.kind === 'controlled-vsix-user-simulation')
    .map(step => step.command[step.command.indexOf('--suite') + 1]);
  assert.deepEqual(controlledSuites, [
    'r2-07e-stream-protocol',
    'journey-core',
    'realistic-product',
    'prior-task-continuation-product',
    'scope-replacement-product',
    'cancellation-replacement-product',
    'agent-fit-product',
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
  assert.equal(report.plan.coverage_profile, 'focused-regression');
  assert.equal(report.case_design_review.ok, true);
  assert.equal(report.case_design_review.enforced, false);
  assert.equal(report.case_design_review.acceptance_plan_eligible, false);
  assert.equal(report.case_design_review.acceptance_execution_eligible, false);
  assert.ok(report.case_design_review.missing_dimensions.includes('provider_reply_corruption'));
  assert.deepEqual(report.case_design_review.selected_cases, [
    'realistic-python-log-tool',
    'realistic-python-log-json-followup',
    'existing-js-fix',
    'realistic-safety-boundary',
  ]);
});

test('top-agent user simulation runner can retain only the last controlled VSIX window', async () => {
  const { stdout } = await execFile(
    process.execPath,
    [
      'scripts/devseek-top-agent-user-simulation-runner.mjs',
      '--dry-run',
      '--skip-targeted',
      '--controlled-suites',
      'journey-core,agent-fit-product',
      '--keep-last-window',
    ],
    { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
  );
  const report = JSON.parse(stdout);

  assert.equal(report.ok, true, JSON.stringify(report.errors, null, 2));
  assert.match(report.process_monitoring.window_policy, /retain the last controlled window/);
  assert.equal(report.plan.steps.length, 2);
  assert.equal(report.plan.steps[0].keep_window, false);
  assert.equal(report.plan.steps[0].command.includes('--keep-window'), false);
  assert.equal(report.plan.steps[1].keep_window, true);
  assert.equal(report.plan.steps[1].command.includes('--keep-window'), true);
  assert.equal(report.plan.steps[1].command.includes('--keep'), true);
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

test('top-agent user simulation runner prints actionable help without starting a run', async () => {
  const { stdout, stderr } = await execFile(
    process.execPath,
    ['scripts/devseek-top-agent-user-simulation-runner.mjs', '--help'],
    { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
  );

  assert.equal(stderr, '');
  assert.match(stdout, /Usage: node scripts\/devseek-top-agent-user-simulation-runner\.mjs/);
  assert.match(stdout, /--controlled-suites <a,b>/);
  assert.match(stdout, /--keep-last-window/);
  assert.match(stdout, /never grants release qualification claims/);
  assert.doesNotMatch(stdout, /"execution_mode"/);
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
        coverage_profile: 'focused-regression',
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
      case_design_review: {
        ok: true,
        enforced: false,
        coverage_profile: 'focused-regression',
        verdict: 'focused-regression-only-not-release-acceptance',
        covered_dimensions: ['incremental_followup_context'],
        missing_dimensions: [],
        release_claim_permitted: false,
        release_claim_reason: 'legacy report without case-level fields',
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
    assert.equal(summary.fixpoint_replay.needed, true);
    assert.deepEqual(summary.fixpoint_replay.failed_controlled_suites, ['realistic-product']);
    assert.deepEqual(summary.fixpoint_replay.failed_controlled_cases, [
      'realistic-python-log-tool',
      'realistic-python-log-json-followup',
    ]);
    assert.match(markdown, /## Actual User Cases/);
    assert.match(markdown, /## Case Design Review/);
    assert.match(markdown, /## Fixpoint Replay/);
    assert.match(markdown, /--controlled-suites realistic-product/);
    assert.match(markdown, /focused-regression-only-not-release-acceptance/);
    assert.match(markdown, /Selected case count: `2`/);
    assert.match(markdown, /Required acceptance case count: `40`/);
    assert.match(markdown, /Execution evidence missing:/);
    assert.match(markdown, /realistic-product:driver-cases-missing/);
    assert.match(markdown, /realistic-product:driver-case-missing:realistic-python-log-json-followup/);
    assert.match(markdown, /Report render mode: `from-report`/);
    assert.match(markdown, /## Findings And Fixes/);
    assert.match(markdown, /execution evidence is incomplete and needs focused replay/);
    assert.match(markdown, /realistic-python-log-json-followup/);
    assert.equal(fs.existsSync(path.join(repoRoot, 'code/devseek-tests/top-agent-convergence/runs', summary.run_id)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('top-agent user simulation runner turns failed evidence into focused replay commands', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-top-agent-failed-replay-test-'));
  try {
    const reportPath = path.join(root, 'failed.report.json');
    const markdownPath = path.join(root, 'failed.md');
    fs.writeFileSync(reportPath, `${JSON.stringify({
      ok: false,
      schema_version: 'devseek.top-agent-user-simulation-runner/v1',
      run_id: 'failed-acceptance',
      started_at: '2026-08-13T00:00:00.000Z',
      ended_at: '2026-08-13T00:00:10.000Z',
      repo: { head: 'abc1234', dirty_tracked_paths: [], dirty_cached_paths: [], untracked_paths: [] },
      execution_mode: 'execute',
      evidence_root: 'code/devseek-tests/top-agent-convergence/runs/failed-acceptance',
      markdown_report: null,
      strategy: {
        name: 'targeted-before-broad-user-simulation',
        reason: 'Run small replay/contract checks first, then controlled VSIX user journeys.',
        qualification_effect: 'NONE',
        claims_permitted: false,
        gate0_status_effect: 'NONE',
      },
      process_monitoring: {
        snapshot_stages: ['start', 'before', 'after', 'end'],
        high_usage_observations: [],
        controlled_residuals_terminated: [],
        controlled_windows_retained: [],
        residual_errors: [],
        window_policy: 'close previous controlled VSIX windows before execution and retain the last controlled window for inspection',
      },
      plan: {
        coverage_profile: 'top-agent-local-acceptance',
        source_plan: 'docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md',
        steps: [
          { id: 'targeted-local-contracts', kind: 'targeted-local-contract', command: [process.execPath, '--test', 'unit-a.test.mjs'] },
          { id: 'controlled-realistic-product', kind: 'controlled-vsix-user-simulation', command: [process.execPath, 'packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs', '--suite', 'realistic-product'] },
        ],
      },
      steps: [
        {
          id: 'targeted-local-contracts',
          kind: 'targeted-local-contract',
          ok: true,
          stdout_log: 'evidence/targeted.stdout.log',
          stderr_log: 'evidence/targeted.stderr.log',
          errors: [],
        },
        {
          id: 'controlled-realistic-product',
          kind: 'controlled-vsix-user-simulation',
          ok: false,
          stdout_log: 'evidence/realistic-product.stdout.log',
          stderr_log: 'evidence/realistic-product.stderr.log',
          report_path: 'evidence/realistic-product.report.json',
          errors: ['realistic-python-log-json-followup failed'],
          controlledReport: {
            ok: false,
            driver: {
              ok: false,
              cases: [
                { scenario: 'realistic-python-log-tool', ok: true },
                { scenario: 'realistic-python-log-json-followup', ok: false },
              ],
            },
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
        ok: false,
        total_steps: 2,
        passed_steps: 1,
        failed_steps: ['controlled-realistic-product'],
        controlled_suites: ['realistic-product'],
        controlled_cases: ['realistic-python-log-tool', 'realistic-python-log-json-followup'],
        snapshots: 4,
        high_usage_observations: 0,
        controlled_residuals_terminated: 0,
        qualification_effect: 'NONE',
        claims_permitted: false,
      },
      errors: [],
    }, null, 2)}\n`, 'utf8');

    await assert.rejects(
      execFile(
        process.execPath,
        [
          'scripts/devseek-top-agent-user-simulation-runner.mjs',
          '--from-report',
          reportPath,
          '--markdown',
          markdownPath,
        ],
        { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
      ),
      error => {
        const summary = JSON.parse(error.stdout);
        const markdown = fs.readFileSync(markdownPath, 'utf8');
        assert.equal(summary.ok, false);
        assert.equal(summary.fixpoint_replay.needed, true);
        assert.deepEqual(summary.fixpoint_replay.failed_controlled_suites, ['realistic-product']);
        assert.deepEqual(summary.fixpoint_replay.failed_controlled_cases, ['realistic-python-log-json-followup']);
        assert.ok(summary.fixpoint_replay.focused_command.includes('--skip-targeted'));
        assert.ok(summary.fixpoint_replay.focused_command.includes('--controlled-suites'));
        assert.ok(summary.fixpoint_replay.focused_command.includes('realistic-product'));
        assert.match(markdown, /## Fixpoint Replay/);
        assert.match(markdown, /failed-step-fixpoint-before-broad-regression/);
        assert.match(markdown, /--skip-targeted --controlled-suites realistic-product/);
        assert.doesNotMatch(markdown, /no failing DevSeek runtime step was found/);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('top-agent user simulation runner rejects acceptance reports without per-case driver evidence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-top-agent-stale-acceptance-test-'));
  try {
    const reportPath = path.join(root, 'stale-acceptance.report.json');
    const suites = {
      'r2-07e-stream-protocol': ['stream-truncated-no-mutation', 'stream-request-mismatch-no-mutation'],
      'journey-core': ['boundary', 'cpp-program', 'existing-js-fix', 'latest-requirement'],
      'realistic-product': ['realistic-python-log-tool', 'realistic-python-log-json-followup', 'realistic-safety-boundary'],
      'prior-task-continuation-product': ['prior-plan-source-change', 'prior-plan-go-ahead'],
      'scope-replacement-product': ['scope-replace-alpha-plan', 'scope-replace-beta-instead'],
      'cancellation-replacement-product': ['cancel-plan-source-change', 'cancel-review-instead'],
      'agent-fit-product': [
        'agent-fit-ambiguous-clarify',
        'agent-fit-review-only',
        'agent-fit-multifile-with-test',
        'agent-fit-markdown-report-anchors',
        'agent-fit-openai-tool-calls-wrapper',
      ],
      'coding-conformance-product': [
        'conformance-create-and-verify',
        'conformance-modify-and-verify',
        'conformance-verify-repair-reverify',
        'conformance-ci-green-repair',
        'conformance-cn-tests-pass-repair',
        'conformance-project-health-repair',
        'conformance-runtime-error-repair',
        'conformance-user-symptom-repair',
        'conformance-permission-denied-no-effect',
        'conformance-policy-refusal-no-mutation',
      ],
      'r2-07f-connector-security': ['connector-evidence-redaction-replay'],
    };
    const targetedCases = [
      'semantic-source-proposal-route-consistency',
      'semantic-readonly-proposal-route-consistency',
      'semantic-workspace-answer-route-consistency',
      'semantic-code-review-proposal-route-consistency',
      'semantic-clarification-proposal-route-consistency',
      'semantic-clarification-workspace-scope-consistency',
      'semantic-terminal-validation-route-consistency',
      'semantic-external-effect-confirmation-consistency',
      'external-semantic-intent-routing-matrix',
    ];
    const targetedStep = {
      id: 'targeted-local-contracts',
      kind: 'targeted-local-contract',
      ok: true,
      stdout_log: 'evidence/targeted-local-contracts.stdout.log',
      stderr_log: 'evidence/targeted-local-contracts.stderr.log',
      case_ids: targetedCases,
    };
    const controlledSteps = Object.entries(suites).map(([suite, cases]) => ({
      id: `controlled-${suite}`,
      kind: 'controlled-vsix-user-simulation',
      ok: true,
      stdout_log: `evidence/${suite}.stdout.log`,
      report_path: `evidence/${suite}.report.json`,
      controlledReport: {
        ok: true,
        driver: { ok: true, cases: [] },
        scenario: { cases: cases.map(id => ({ id })) },
        bridge: { providerInvocationCount: cases.length },
      },
    }));
    const steps = [targetedStep, ...controlledSteps];
    fs.writeFileSync(reportPath, `${JSON.stringify({
      ok: true,
      schema_version: 'devseek.top-agent-user-simulation-runner/v1',
      run_id: 'stale-acceptance',
      started_at: '2026-08-13T00:00:00.000Z',
      ended_at: '2026-08-13T00:00:01.000Z',
      repo: { head: 'abc1234', dirty_tracked_paths: [], dirty_cached_paths: [], untracked_paths: [] },
      execution_mode: 'execute',
      evidence_root: 'code/devseek-tests/top-agent-convergence/runs/stale-acceptance',
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
        coverage_profile: 'top-agent-local-acceptance',
        source_plan: 'docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md',
        steps: [
          {
            id: 'targeted-local-contracts',
            kind: 'targeted-local-contract',
            command: [process.execPath, '--test', 'packages/vscode-extension/test/unit/task-intent-router.test.mjs'],
            case_ids: targetedCases,
          },
          ...Object.keys(suites).map(suite => ({
            id: `controlled-${suite}`,
            kind: 'controlled-vsix-user-simulation',
            command: [process.execPath, 'packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs', '--suite', suite],
          })),
        ],
      },
      steps,
      summary: {
        ok: true,
        total_steps: steps.length,
        passed_steps: steps.length,
        failed_steps: [],
        targeted_cases: targetedCases,
        controlled_suites: Object.keys(suites),
        controlled_cases: Object.values(suites).flat(),
        snapshots: 2,
        high_usage_observations: 0,
        controlled_residuals_terminated: 0,
        qualification_effect: 'NONE',
        claims_permitted: false,
      },
      errors: [],
    }, null, 2)}\n`, 'utf8');

    await assert.rejects(
      execFile(
        process.execPath,
        ['scripts/devseek-top-agent-user-simulation-runner.mjs', '--from-report', reportPath],
        { cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 },
      ),
      error => {
        const summary = JSON.parse(error.stdout);
        assert.equal(summary.ok, false);
        assert.equal(summary.case_design_review.enforced, true);
        assert.equal(summary.case_design_review.acceptance_plan_eligible, true);
        assert.equal(summary.case_design_review.acceptance_execution_eligible, false);
        assert.ok(summary.case_design_review.execution_evidence_missing.some(item =>
          item === 'agent-fit-product:driver-cases-missing'
        ));
        assert.equal(summary.case_design_review.release_claim_permitted, false);
        return true;
      },
    );
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
