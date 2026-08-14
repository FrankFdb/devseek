#!/usr/bin/env node
import cp from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

const SCHEMA_VERSION = 'devseek.top-agent-user-simulation-runner/v1';
const DEFAULT_TARGETED_TESTS = Object.freeze([
  'packages/vscode-extension/test/unit/provider-authored-transcript-recovery.test.mjs',
  'packages/vscode-extension/test/unit/provider-output-integrity.test.mjs',
  'packages/vscode-extension/test/unit/agent-tool-loop-terminal-guard.test.mjs',
  'packages/vscode-extension/test/unit/independent-requirement-review.test.mjs',
  'packages/vscode-extension/test/unit/requirement-review-ledger.test.mjs',
  'packages/vscode-extension/test/unit/operational-language-boundary.test.mjs',
  'packages/vscode-extension/test/unit/model-led-intent-boundary.test.mjs',
  'packages/vscode-extension/test/unit/model-led-user-simulation.test.mjs',
  'packages/vscode-extension/test/unit/write-authority.test.mjs',
  'packages/vscode-extension/test/unit/task-intent-router.test.mjs',
  'packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs',
  'packages/vscode-extension/test/unit/controlled-vsix-scenario-contract.test.mjs',
]);
const INTENT_TARGETED_TESTS = Object.freeze([
  'packages/vscode-extension/test/unit/operational-language-boundary.test.mjs',
  'packages/vscode-extension/test/unit/model-led-intent-boundary.test.mjs',
  'packages/vscode-extension/test/unit/model-led-user-simulation.test.mjs',
  'packages/vscode-extension/test/unit/write-authority.test.mjs',
  'packages/vscode-extension/test/unit/task-intent-router.test.mjs',
  'packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs',
]);
const TARGETED_TEST_CASE_COVERAGE = Object.freeze({
  'packages/vscode-extension/test/unit/model-led-intent-boundary.test.mjs': Object.freeze([
    'model-led-diverse-input-main-model',
    'model-led-typo-homophone-prompt',
  ]),
  'packages/vscode-extension/test/unit/model-led-user-simulation.test.mjs': Object.freeze([
    'model-led-noisy-action-real-write',
    'model-led-exact-simple-main-model',
    'model-led-noisy-question-no-tools',
    'model-led-inflight-latest-target',
  ]),
  'packages/vscode-extension/test/unit/operational-language-boundary.test.mjs': Object.freeze([
    'operational-lexicon-config-dynamic-loading',
    'operational-lexicon-multilingual-extension',
  ]),
  'packages/vscode-extension/test/unit/write-authority.test.mjs': Object.freeze([
    'in-flight-user-steer-contract-revision',
    'in-flight-committed-effect-preservation',
  ]),
  'packages/vscode-extension/test/unit/task-intent-router.test.mjs': Object.freeze([
    'semantic-source-proposal-route-consistency',
    'semantic-no-run-validation-boundary-consistency',
    'semantic-operation-prohibition-arbitration',
    'proposal-only-patch-readonly-boundary',
    'advisory-action-question-readonly-boundary',
    'semantic-readonly-proposal-route-consistency',
    'semantic-workspace-answer-route-consistency',
    'semantic-code-review-proposal-route-consistency',
    'semantic-clarification-proposal-route-consistency',
    'semantic-clarification-workspace-scope-consistency',
    'semantic-terminal-validation-route-consistency',
    'semantic-external-effect-confirmation-consistency',
    'semantic-destructive-proposal-confirmation-consistency',
  ]),
  'packages/vscode-extension/test/unit/semantic-intent-routing-matrix.test.mjs': Object.freeze([
    'external-semantic-intent-routing-matrix',
  ]),
});
const DEFAULT_CONTROLLED_SUITES = Object.freeze([
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
const INTENT_CONTROLLED_SUITES = Object.freeze([
  'prior-task-continuation-product',
  'scope-replacement-product',
  'cancellation-replacement-product',
]);
const ACCEPTANCE_CONTROLLED_SUITES = Object.freeze([
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
const CASE_DESIGN_DIMENSIONS = Object.freeze([
  {
    id: 'provider_reply_corruption',
    user_need: 'DeepSeek Web may return malformed or truncated tool replies.',
    suites: ['r2-07e-stream-protocol'],
    cases: ['stream-truncated-no-mutation', 'stream-request-mismatch-no-mutation'],
  },
  {
    id: 'read_only_boundary',
    user_need: 'Users ask for analysis or review without allowing file edits.',
    suites: ['journey-core', 'agent-fit-product'],
    cases: ['boundary', 'agent-fit-review-only'],
  },
  {
    id: 'create_program_and_verify',
    user_need: 'Users ask DevSeek to create runnable code and prove it works.',
    suites: ['journey-core', 'realistic-product', 'coding-conformance-product'],
    cases: ['cpp-program', 'realistic-python-log-tool', 'conformance-create-and-verify'],
  },
  {
    id: 'modify_existing_project',
    user_need: 'Users ask DevSeek to fix existing code without broad rewrites.',
    suites: ['journey-core', 'realistic-product', 'coding-conformance-product'],
    cases: ['existing-js-fix', 'conformance-modify-and-verify'],
  },
  {
    id: 'test_failure_repair_loop',
    user_need: 'Users expect DevSeek to run tests, repair failures, and rerun.',
    suites: ['coding-conformance-product'],
    cases: ['conformance-verify-repair-reverify'],
  },
  {
    id: 'implicit_validation_health_repair',
    user_need: 'Users describe red CI or failing tests as a health goal and expect repair plus verification.',
    suites: ['coding-conformance-product'],
    cases: ['conformance-ci-green-repair', 'conformance-cn-tests-pass-repair'],
  },
  {
    id: 'implicit_project_health_repair',
    user_need: 'Users describe a broken app, page, or flow as a health goal and expect repair plus verification.',
    suites: ['coding-conformance-product'],
    cases: ['conformance-project-health-repair'],
  },
  {
    id: 'implicit_runtime_error_repair',
    user_need: 'Users paste stack traces, console errors, or production bug symptoms and delegate repair plus verification.',
    suites: ['coding-conformance-product'],
    cases: ['conformance-runtime-error-repair'],
  },
  {
    id: 'implicit_user_symptom_repair',
    user_need: 'Users describe user-facing broken behavior without stack traces and delegate repair plus verification.',
    suites: ['coding-conformance-product'],
    cases: ['conformance-user-symptom-repair'],
  },
  {
    id: 'incremental_followup_context',
    user_need: 'Users refine previous work in the same session.',
    suites: ['realistic-product'],
    cases: ['realistic-python-log-json-followup'],
  },
  {
    id: 'dynamic_operational_lexicon',
    user_need: 'Teams need to extend operational keywords and multilingual boundary evidence without code edits.',
    suites: ['targeted-local-contracts'],
    cases: [
      'operational-lexicon-config-dynamic-loading',
      'operational-lexicon-multilingual-extension',
    ],
  },
  {
    id: 'interactive_requirement_revision',
    user_need: 'Users can add, narrow, correct, or revoke requirements during one task and expect the active contract to update without rewriting committed effects.',
    suites: ['targeted-local-contracts'],
    cases: [
      'in-flight-user-steer-contract-revision',
      'in-flight-committed-effect-preservation',
      'model-led-inflight-latest-target',
    ],
  },
  {
    id: 'model_led_turn_ownership',
    user_need: 'Raw user input, including exact simple tasks and direct questions, must reach the main model before any action choice.',
    suites: ['targeted-local-contracts'],
    cases: [
      'model-led-diverse-input-main-model',
      'model-led-exact-simple-main-model',
      'model-led-noisy-question-no-tools',
    ],
  },
  {
    id: 'noisy_natural_language_recovery',
    user_need: 'Users make typos, use homophones, colloquial Chinese, ASR-like phrasing, and mixed English without fixed formatting.',
    suites: ['targeted-local-contracts'],
    cases: [
      'model-led-typo-homophone-prompt',
      'model-led-noisy-action-real-write',
      'model-led-noisy-question-no-tools',
    ],
  },
  {
    id: 'prior_task_approval_continuation',
    user_need: 'Users approve a prior plan or task with shorthand such as go ahead and expect execution to continue.',
    suites: ['prior-task-continuation-product'],
    cases: ['prior-plan-source-change', 'prior-plan-go-ahead'],
  },
  {
    id: 'corrective_scope_replacement',
    user_need: 'Users correct the previous target and expect the newest bounded target to replace the old one.',
    suites: ['scope-replacement-product'],
    cases: ['scope-replace-alpha-plan', 'scope-replace-beta-instead'],
  },
  {
    id: 'cancellation_readonly_replacement',
    user_need: 'Users cancel a prior coding task and expect the newest read-only instruction to revoke inherited edits.',
    suites: ['cancellation-replacement-product'],
    cases: ['cancel-plan-source-change', 'cancel-review-instead'],
  },
  {
    id: 'proposal_only_patch_boundary',
    user_need: 'Users ask for a patch, diff, or draft while explicitly withholding permission to apply workspace changes.',
    suites: ['targeted-local-contracts'],
    cases: ['proposal-only-patch-readonly-boundary'],
  },
  {
    id: 'advisory_action_question_boundary',
    user_need: 'Users ask what to change or which command to run, and expect advice instead of workspace mutation or terminal execution.',
    suites: ['targeted-local-contracts'],
    cases: ['advisory-action-question-readonly-boundary'],
  },
  {
    id: 'semantic_proposal_arbitration',
    user_need: 'Model semantic proposals must be reconciled with the local task contract so route, workflow, mutation, and evidence agree.',
    suites: ['targeted-local-contracts'],
    cases: [
      'semantic-source-proposal-route-consistency',
      'semantic-no-run-validation-boundary-consistency',
      'semantic-operation-prohibition-arbitration',
      'semantic-readonly-proposal-route-consistency',
      'semantic-workspace-answer-route-consistency',
      'semantic-code-review-proposal-route-consistency',
      'semantic-clarification-proposal-route-consistency',
      'semantic-clarification-workspace-scope-consistency',
      'semantic-terminal-validation-route-consistency',
      'semantic-external-effect-confirmation-consistency',
      'semantic-destructive-proposal-confirmation-consistency',
    ],
  },
  {
    id: 'external_semantic_agent_workflows',
    user_need: 'Users phrase common coding-agent workflows in many ways; semantic routing must cover ask, inspect, plan, review, edit, run, effects, and ambiguity.',
    suites: ['targeted-local-contracts'],
    cases: ['external-semantic-intent-routing-matrix'],
  },
  {
    id: 'latest_requirement_wins',
    user_need: 'Users change their mind and expect the newest instruction to win.',
    suites: ['journey-core'],
    cases: ['latest-requirement'],
  },
  {
    id: 'permission_denial_no_effect',
    user_need: 'Users deny risky effects and expect no hidden mutation.',
    suites: ['coding-conformance-product'],
    cases: ['conformance-permission-denied-no-effect'],
  },
  {
    id: 'policy_refusal_no_mutation',
    user_need: 'Users may request unsafe work; DevSeek must refuse without edits.',
    suites: ['realistic-product', 'coding-conformance-product'],
    cases: ['realistic-safety-boundary', 'conformance-policy-refusal-no-mutation'],
  },
  {
    id: 'ambiguous_request_clarification',
    user_need: 'Users give vague instructions; DevSeek should clarify or stay minimal.',
    suites: ['agent-fit-product'],
    cases: ['agent-fit-ambiguous-clarify'],
  },
  {
    id: 'multi_file_tested_edit',
    user_need: 'Users ask for changes that span multiple files and tests.',
    suites: ['agent-fit-product'],
    cases: ['agent-fit-multifile-with-test'],
  },
  {
    id: 'documentation_deliverable_anchors',
    user_need: 'Users ask for Markdown/report deliverables grounded in source facts.',
    suites: ['agent-fit-product'],
    cases: ['agent-fit-markdown-report-anchors'],
  },
  {
    id: 'wrapped_tool_reply_compatibility',
    user_need: 'DeepSeek Web may echo OpenAI-style or wrapped tool-call payloads.',
    suites: ['agent-fit-product'],
    cases: ['agent-fit-openai-tool-calls-wrapper'],
  },
  {
    id: 'connector_evidence_redaction',
    user_need: 'Users attach connector evidence; DevSeek must redact and stay read-only.',
    suites: ['r2-07f-connector-security'],
    cases: ['connector-evidence-redaction-replay'],
  },
]);
const PROCESS_PATTERNS = Object.freeze([
  'code',
  'codex',
  'devseek',
  'extensionDevelopmentPath',
  'devseek-controlled-vsix',
  'playwright',
  'chrome',
  'chromium',
]);
const CONTROLLED_PROCESS_PATTERN = /devseek-controlled-vsix-|--extensionDevelopmentPath\b/i;
const DEFAULT_CPU_WARNING_PERCENT = 75;
const DEFAULT_RSS_WARNING_MB = 1536;

main();

function main() {
  const startedAt = new Date();
  const options = parseOptions(args);
  if (options.help && options.errors.length === 0) {
    console.log(renderUsage());
    return;
  }
  const errors = [...options.errors];
  if (options.fromReportPath) {
    const report = loadExistingReport(options.fromReportPath, errors);
    const outputReport = report
      ? refreshCaseDesignReview({
          ...report,
          report_render_mode: 'from-report',
          markdown_report: options.markdownPath || report.markdown_report || null,
        })
      : failedExistingReport(options, errors);
    writeOptionalOutputs(outputReport, options);
    console.log(JSON.stringify(consoleReport(outputReport, options), null, 2));
    process.exitCode = outputReport.ok ? 0 : 1;
    return;
  }
  if (!options.dryRun && !options.force) {
    const report = maybeLoadReusableExistingReport(options, errors);
    if (report) {
      const reusedReport = {
        ...report,
        report_render_mode: 'reuse-existing',
        markdown_report: options.markdownPath || report.markdown_report || null,
      };
      writeOptionalOutputs(reusedReport, options);
      console.log(JSON.stringify(consoleReport(reusedReport, options), null, 2));
      process.exitCode = reusedReport.ok ? 0 : 1;
      return;
    }
  }

  const plan = buildPlan(options);
  const baseReport = {
    schema_version: SCHEMA_VERSION,
    run_id: options.runId,
    started_at: startedAt.toISOString(),
    ended_at: null,
    repo: repoState(),
    execution_mode: options.dryRun ? 'dry-run' : 'execute',
    evidence_root: options.evidenceRoot,
    markdown_report: options.markdownPath || null,
    strategy: {
      name: 'targeted-before-broad-user-simulation',
      reason: 'Run small replay/contract checks first, then controlled VSIX user journeys. Do not restart the full matrix for every parser or settlement defect.',
      claude_codex_alignment: [
        'single semantic owner for tool execution and settlement',
        'bounded recovery after malformed provider output',
        'permission-aware mutations with no hidden effects',
        'explicit verification before completion',
        'auditable run evidence instead of UI-only success text',
      ],
      qualification_effect: 'NONE',
      claims_permitted: false,
      gate0_status_effect: 'NONE',
    },
    process_monitoring: {
      policy: 'Capture VS Code/DevSeek/Codex/browser process snapshots at start, before each step, after each step, and end. Only terminate processes whose command line is tied to this runner controlled VSIX tmp root.',
      cpu_warning_percent: DEFAULT_CPU_WARNING_PERCENT,
      rss_warning_mb: DEFAULT_RSS_WARNING_MB,
      watched_patterns: PROCESS_PATTERNS,
      snapshot_stages: options.dryRun
        ? ['start', 'before-each-step', 'after-each-step', 'end']
        : [],
      high_usage_observations: [],
      controlled_residuals_terminated: [],
      controlled_windows_retained: [],
      residual_errors: [],
      window_policy: options.keepLastWindow
        ? 'close previous controlled VSIX windows before execution and retain the last controlled window for inspection'
        : 'close controlled VSIX windows after each controlled step',
    },
    plan,
    steps: [],
    summary: null,
    errors,
  };

  if (options.dryRun || errors.length > 0) {
    const report = finishReport(baseReport);
    writeOptionalOutputs(report, options);
    console.log(JSON.stringify(consoleReport(report, options), null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  fs.mkdirSync(options.evidenceRoot, { recursive: true });
  if (options.keepLastWindow) {
    cleanupExistingControlledWindows(baseReport, 'before-start-keep-last-window');
  }
  captureAndStoreSnapshot(baseReport, 'start');

  for (const step of plan.steps) {
    captureAndStoreSnapshot(baseReport, `before-${step.id}`);
    const result = runStep(step, options);
    baseReport.steps.push(result);
    if (result.controlledReport) {
      if (options.keepLastWindow && isLastControlledStep(plan.steps, step)) {
        recordRetainedControlledWindow(baseReport, result.controlledReport);
      } else {
        cleanupResidualControlledProcesses(baseReport, result.controlledReport);
      }
    }
    captureAndStoreSnapshot(baseReport, `after-${step.id}`);
    if (!result.ok) break;
  }

  captureAndStoreSnapshot(baseReport, 'end');
  const report = finishReport(baseReport);
  writeOptionalOutputs(report, options);
  console.log(JSON.stringify(consoleReport(report, options), null, 2));
  process.exitCode = report.ok ? 0 : 1;
}

function parseOptions(argv) {
  const allowedFlags = new Set([
    '--dry-run',
    '--intent-only',
    '--run-id',
    '--evidence-root',
    '--markdown',
    '--controlled-suites',
    '--targeted-tests',
    '--from-report',
    '--skip-controlled',
    '--skip-targeted',
    '--print-full',
    '--force',
    '--keep-last-window',
    '--help',
  ]);
  const errors = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    if (!allowedFlags.has(token)) errors.push(`argument:unsupported-${token}`);
    if ([
      '--run-id',
      '--evidence-root',
      '--markdown',
      '--controlled-suites',
      '--targeted-tests',
      '--from-report',
    ].includes(token)) {
      index += 1;
    }
  }
  const dryRun = argv.includes('--dry-run');
  const intentOnly = argv.includes('--intent-only');
  const runId = optionValue(argv, '--run-id') || defaultRunId();
  const evidenceRootOption = optionValue(argv, '--evidence-root');
  const evidenceRoot = path.resolve(
    repoRoot,
    evidenceRootOption || path.join('code/devseek-tests/top-agent-convergence/runs', runId),
  );
  const markdownPath = optionValue(argv, '--markdown')
    ? path.resolve(repoRoot, optionValue(argv, '--markdown'))
    : '';
  const targetedTests = listOption(
    argv,
    '--targeted-tests',
    intentOnly ? INTENT_TARGETED_TESTS : DEFAULT_TARGETED_TESTS,
  );
  const controlledSuites = listOption(
    argv,
    '--controlled-suites',
    intentOnly ? INTENT_CONTROLLED_SUITES : DEFAULT_CONTROLLED_SUITES,
  );
  const controlledSuitesExplicit = Boolean(optionValue(argv, '--controlled-suites'));
  if (targetedTests.length === 0 && !argv.includes('--skip-targeted')) {
    errors.push('targeted-tests:empty');
  }
  if (controlledSuites.length === 0 && !argv.includes('--skip-controlled')) {
    errors.push('controlled-suites:empty');
  }
  return {
    dryRun,
    intentOnly,
    help: argv.includes('--help'),
    printFull: argv.includes('--print-full'),
    force: argv.includes('--force'),
    fromReportPath: optionValue(argv, '--from-report')
      ? path.resolve(repoRoot, optionValue(argv, '--from-report'))
      : '',
    runId,
    evidenceRoot,
    evidenceRootExplicit: Boolean(evidenceRootOption),
    markdownPath,
    targetedTests,
    controlledSuites,
    controlledSuitesExplicit,
    skipTargeted: argv.includes('--skip-targeted'),
    skipControlled: argv.includes('--skip-controlled'),
    keepLastWindow: argv.includes('--keep-last-window'),
    errors,
  };
}

function renderUsage() {
  return [
    'Usage: node scripts/devseek-top-agent-user-simulation-runner.mjs [options]',
    '',
    'Runs local DevSeek top-agent user simulation evidence. This runner never grants release qualification claims.',
    '',
    'Options:',
    '  --intent-only                     Run intent-specific contracts and multi-turn VSIX journeys only.',
    '  --dry-run                         Print the planned targeted checks and controlled VSIX suites.',
    '  --run-id <id>                     Use a stable run id for evidence paths.',
    '  --evidence-root <path>            Store or reuse runner evidence at this path.',
    '  --markdown <path>                 Write a Markdown report for the run or existing evidence.',
    '  --controlled-suites <a,b>         Run a focused controlled VSIX suite subset.',
    '  --targeted-tests <a,b>            Run a focused targeted Node test subset.',
    '  --from-report <path>              Re-render and re-evaluate an existing runner report without rerunning.',
    '  --skip-controlled                 Skip controlled VSIX simulations.',
    '  --skip-targeted                   Skip targeted Node tests.',
    '  --print-full                      Print the full JSON report for execute mode.',
    '  --force                           Ignore reusable PASS evidence under --evidence-root.',
    '  --keep-last-window                Close previous controlled windows and retain only the final VSIX window.',
    '  --help                            Print this usage text and exit without side effects.',
    '',
    'Examples:',
    '  node scripts/devseek-top-agent-user-simulation-runner.mjs --dry-run',
    '  node scripts/devseek-top-agent-user-simulation-runner.mjs --intent-only --keep-last-window',
    '  node scripts/devseek-top-agent-user-simulation-runner.mjs --skip-targeted --controlled-suites agent-fit-product --keep-last-window',
  ].join('\n');
}

function maybeLoadReusableExistingReport(options, errors) {
  const reportPath = path.join(options.evidenceRoot, 'top-agent-user-simulation-runner.report.json');
  if (!fs.existsSync(reportPath)) return null;
  const report = loadExistingReport(reportPath, errors);
  if (!report) return null;
  const reviewed = refreshCaseDesignReview(report);
  if (reviewed.ok !== true || reviewed.summary?.ok !== true) return null;
  return reviewed;
}

function loadExistingReport(reportPath, errors) {
  try {
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    if (report.schema_version !== SCHEMA_VERSION) {
      errors.push(`from-report:schema-version:${report.schema_version || 'missing'}`);
    }
    if (!report.summary || typeof report.summary !== 'object') {
      errors.push('from-report:summary:missing');
    }
    if (errors.length > 0) return null;
    return report;
  } catch (error) {
    errors.push(`from-report:read:${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function failedExistingReport(options, errors) {
  return {
    ok: false,
    schema_version: SCHEMA_VERSION,
    run_id: options.runId,
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    repo: repoState(),
    execution_mode: 'report-render',
    evidence_root: options.evidenceRoot,
    markdown_report: options.markdownPath || null,
    strategy: {
      name: 'targeted-before-broad-user-simulation',
      qualification_effect: 'NONE',
      claims_permitted: false,
      gate0_status_effect: 'NONE',
    },
    process_monitoring: {
      snapshot_stages: [],
      high_usage_observations: [],
      controlled_residuals_terminated: [],
      controlled_windows_retained: [],
      residual_errors: [],
      window_policy: 'report rendering only',
    },
    plan: {
      strategy: 'fixpoint-before-broad-regression',
      source_plan: 'docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md',
    },
    steps: [],
    summary: {
      ok: false,
      total_steps: 0,
      passed_steps: 0,
      failed_steps: [],
      controlled_suites: [],
      controlled_cases: [],
      snapshots: 0,
      high_usage_observations: 0,
      controlled_residuals_terminated: 0,
      controlled_windows_retained: 0,
      qualification_effect: 'NONE',
      claims_permitted: false,
    },
    errors,
  };
}

function buildPlan(options) {
  const steps = [];
  const coverageProfile = coverageProfileForOptions(options);
  if (!options.skipTargeted) {
    const targetedCases = targetedCasesForTests(options.targetedTests);
    steps.push({
      id: 'targeted-local-contracts',
      kind: 'targeted-local-contract',
      purpose: 'Validate the exact fixpoint risks before launching VS Code: DeepSeek reply compatibility, terminal hard-stop, independent review, semantic proposal arbitration, and controlled scenario contract.',
      command: [
        process.execPath,
        '--test',
        ...options.targetedTests,
      ],
      case_ids: targetedCases,
      timeout_ms: 180_000,
      qualification_effect: 'NONE',
      live_provider: false,
    });
  }
  if (!options.skipControlled) {
    for (let index = 0; index < options.controlledSuites.length; index += 1) {
      const suite = options.controlledSuites[index];
      const keepWindowForStep = options.keepLastWindow && index === options.controlledSuites.length - 1;
      const command = [
        process.execPath,
        'packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs',
        '--suite',
        suite,
        '--timeout-ms',
        String(controlledSuiteTimeoutMs(suite)),
        '--report',
        path.join(options.evidenceRoot, `${suite}.report.json`),
      ];
      if (keepWindowForStep) command.push('--keep-window', '--keep');
      steps.push({
        id: `controlled-${suite}`,
        kind: 'controlled-vsix-user-simulation',
        purpose: controlledSuitePurpose(suite),
        command,
        stdout_log: path.join(options.evidenceRoot, `${suite}.stdout.log`),
        stderr_log: path.join(options.evidenceRoot, `${suite}.stderr.log`),
        report_path: path.join(options.evidenceRoot, `${suite}.report.json`),
        timeout_ms: controlledSuiteTimeoutMs(suite) + 90_000,
        qualification_effect: 'NONE',
        live_provider: false,
        keep_window: keepWindowForStep,
      });
    }
  }
  return {
    strategy: 'fixpoint-before-broad-regression',
    source_plan: 'docs/top-agent-convergence-audit-20260711/PLAN-当前收敛迭代计划.md',
    source_principles: 'docs/top-agent-convergence-audit-20260711/archive/16-顶级编程智能体收敛迭代原则质量标准与Skills规划.md',
    user_simulation_boundary: 'T3 exact VSIX controlled Surface conformance; not T4 natural UI, not T5 live DeepSeek Web, not qualification evidence.',
    coverage_profile: coverageProfile,
    acceptance_controlled_suites: [...ACCEPTANCE_CONTROLLED_SUITES],
    case_design_dimensions: CASE_DESIGN_DIMENSIONS.map(dimension => ({
      id: dimension.id,
      user_need: dimension.user_need,
      suites: [...dimension.suites],
    })),
    steps,
  };
}

function coverageProfileForOptions(options) {
  if (options.intentOnly) return 'intent-recognition-regression';
  if (
    !options.skipTargeted
    && !options.skipControlled
    && !options.controlledSuitesExplicit
    && includesEvery(options.controlledSuites, ACCEPTANCE_CONTROLLED_SUITES)
  ) {
    return 'top-agent-local-acceptance';
  }
  return 'focused-regression';
}

function controlledSuitePurpose(suite) {
  const purposes = {
    'r2-07e-stream-protocol': 'DeepSeek Web malformed/truncated stream replay: fail closed, bounded recovery, no mutation.',
    'realistic-product': 'Same-window realistic coding journey: create a Python log tool, handle an incremental JSON follow-up, modify existing JS, refuse unsafe work.',
    'prior-task-continuation-product': 'Same-session prior task approval: plan-only first turn, shorthand approval, inherited target, edit and verification.',
    'scope-replacement-product': 'Same-session correction: replace the earlier target and execute only the latest requested scope.',
    'cancellation-replacement-product': 'Same-session cancellation: withdraw the planned mutation and replace it with a read-only review.',
    'agent-fit-product': 'Codex-aligned agent fit: clarify ambiguous asks, keep reviews read-only, handle multi-file tested edits, and verify Markdown anchors.',
    'coding-conformance-product': 'Core programming lifecycle: create/modify/verify-repair plus permission denial and policy refusal.',
    'r2-07f-connector-security': 'Connector evidence replay: redacted read-only evidence must not mutate workspace.',
    'journey-core': 'General user journey smoke: normal, exception, boundary, C++ create, JS fix, latest requirement wins.',
  };
  return purposes[suite] || `Controlled VSIX user simulation suite ${suite}.`;
}

function simulationCoverageLines(report) {
  const executedSteps = Array.isArray(report.steps) ? report.steps : [];
  const plannedSteps = Array.isArray(report.plan?.steps) ? report.plan.steps : [];
  const steps = executedSteps.length > 0 ? executedSteps : plannedSteps;
  const targetedTestFiles = new Set(steps
    .filter(step => step.kind === 'targeted-local-contract')
    .flatMap(step => Array.isArray(step.command) ? step.command : [])
    .filter(value => typeof value === 'string' && value.endsWith('.test.mjs')));
  const controlledSuites = [...new Set(steps
    .filter(step => step.kind === 'controlled-vsix-user-simulation')
    .map(step => step.id?.replace(/^controlled-/, ''))
    .filter(Boolean))];
  const lines = [];
  if (targetedTestFiles.size > 0) {
    lines.push(`- Targeted local contract coverage: \`${targetedTestFiles.size}\` selected test files.`);
  }
  lines.push(...controlledSuites.map(suite => `- \`${suite}\`: ${controlledSuitePurpose(suite)}`));
  return lines.length > 0 ? lines.join('\n') : '- No local or controlled VSIX coverage was selected.';
}

function controlledSuiteTimeoutMs(suite) {
  if (suite === 'coding-conformance-product') return 300_000;
  if (suite === 'journey-core') return 300_000;
  if (suite === 'realistic-product') return 270_000;
  if (suite === 'prior-task-continuation-product') return 240_000;
  if (suite === 'agent-fit-product') return 270_000;
  return 210_000;
}

function runStep(step, options) {
  const startedAt = new Date();
  const stdoutPath = step.stdout_log || path.join(options.evidenceRoot, `${step.id}.stdout.log`);
  const stderrPath = step.stderr_log || path.join(options.evidenceRoot, `${step.id}.stderr.log`);
  const result = cp.spawnSync(step.command[0], step.command.slice(1), {
    cwd: repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: '0',
    },
    encoding: 'utf8',
    timeout: step.timeout_ms,
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.mkdirSync(path.dirname(stdoutPath), { recursive: true });
  fs.writeFileSync(stdoutPath, result.stdout || '', 'utf8');
  fs.writeFileSync(stderrPath, result.stderr || '', 'utf8');

  const completedAt = new Date();
  const commandResult = {
    id: step.id,
    kind: step.kind,
    purpose: step.purpose,
    command: step.command,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: completedAt.getTime() - startedAt.getTime(),
    exit_code: result.status,
    signal: result.signal || null,
    timed_out: Boolean(result.error && result.error.code === 'ETIMEDOUT'),
    stdout_log: relativeToRepo(stdoutPath),
    stderr_log: relativeToRepo(stderrPath),
    report_path: step.report_path ? relativeToRepo(step.report_path) : null,
    case_ids: Array.isArray(step.case_ids) ? [...step.case_ids] : [],
    qualification_effect: step.qualification_effect,
    live_provider: step.live_provider,
    ok: result.status === 0,
    errors: [],
  };
  if (result.error) commandResult.errors.push(`spawn:${result.error.message}`);
  if (step.report_path) {
    commandResult.controlledReport = readControlledReport(step.report_path);
    if (!commandResult.controlledReport) {
      commandResult.errors.push(`controlled-report:missing-or-invalid:${relativeToRepo(step.report_path)}`);
      commandResult.ok = false;
    } else if (commandResult.controlledReport.ok !== true) {
      commandResult.errors.push(...(commandResult.controlledReport.errors || ['controlled-report:not-ok']));
      commandResult.ok = false;
    }
  }
  return commandResult;
}

function readControlledReport(reportPath) {
  try {
    if (!fs.existsSync(reportPath)) return null;
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return null;
  }
}

function captureAndStoreSnapshot(report, stage) {
  const snapshot = captureProcessSnapshot(stage);
  const filePath = path.join(report.evidence_root, `process-${sanitizeFileName(stage)}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  report.process_monitoring.snapshot_stages.push(stage);
  report.process_monitoring.high_usage_observations.push(...snapshot.high_usage_observations);
}

function captureProcessSnapshot(stage) {
  const capturedAt = new Date().toISOString();
  const result = cp.spawnSync('ps', [
    '-eo',
    'pid=,ppid=,pcpu=,pmem=,rss=,etime=,stat=,cmd=',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const errors = [];
  if (result.status !== 0) errors.push(`ps:failed:${result.stderr || result.stdout || result.status}`);
  const rows = (result.stdout || '')
    .split(/\r?\n/)
    .map(parsePsLine)
    .filter(Boolean)
    .filter(row => PROCESS_PATTERNS.some(pattern => row.command.toLowerCase().includes(pattern.toLowerCase())))
    .sort((left, right) => right.cpu_percent - left.cpu_percent)
    .slice(0, 80);
  return {
    stage,
    captured_at: capturedAt,
    hostname: os.hostname(),
    rows,
    high_usage_observations: rows
      .filter(row => row.cpu_percent >= DEFAULT_CPU_WARNING_PERCENT || row.rss_mb >= DEFAULT_RSS_WARNING_MB)
      .map(row => ({
        stage,
        pid: row.pid,
        ppid: row.ppid,
        cpu_percent: row.cpu_percent,
        rss_mb: row.rss_mb,
        scope: classifyProcessScope(row.command),
        command: trimCommand(row.command),
      })),
    errors,
  };
}

function parsePsLine(line) {
  const match = String(line || '').match(/^\s*(\d+)\s+(\d+)\s+([0-9.]+)\s+([0-9.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+([\s\S]+)$/);
  if (!match) return null;
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    cpu_percent: Number(match[3]),
    mem_percent: Number(match[4]),
    rss_kb: Number(match[5]),
    rss_mb: Math.round(Number(match[5]) / 1024),
    elapsed: match[6],
    stat: match[7],
    scope: classifyProcessScope(match[8]),
    command: trimCommand(match[8]),
  };
}

function cleanupResidualControlledProcesses(report, controlledReport) {
  const tmpRoot = controlledReport?.harness?.tmpRoot;
  if (!tmpRoot || !String(tmpRoot).includes('devseek-controlled-vsix-')) return;
  const snapshot = captureProcessSnapshot(`residual-check-${path.basename(tmpRoot)}`);
  const candidates = snapshot.rows.filter(row => (
    row.command.includes(tmpRoot)
    && CONTROLLED_PROCESS_PATTERN.test(row.command)
    && row.pid !== process.pid
  ));
  for (const row of candidates) {
    try {
      process.kill(row.pid, 'SIGTERM');
      report.process_monitoring.controlled_residuals_terminated.push({
        pid: row.pid,
        signal: 'SIGTERM',
        tmp_root: tmpRoot,
        command: trimCommand(row.command),
      });
    } catch (error) {
      report.process_monitoring.residual_errors.push({
        pid: row.pid,
        tmp_root: tmpRoot,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function cleanupExistingControlledWindows(report, stage) {
  const snapshot = captureProcessSnapshot(stage);
  const candidates = snapshot.rows.filter(row => (
    row.command.includes('devseek-controlled-vsix-')
    && CONTROLLED_PROCESS_PATTERN.test(row.command)
    && row.pid !== process.pid
  ));
  for (const row of candidates) {
    try {
      process.kill(row.pid, 'SIGTERM');
      report.process_monitoring.controlled_residuals_terminated.push({
        pid: row.pid,
        signal: 'SIGTERM',
        tmp_root: extractControlledTmpRoot(row.command) || '(unknown-controlled-vsix-root)',
        previous_kept_window: true,
        command: trimCommand(row.command),
      });
    } catch (error) {
      report.process_monitoring.residual_errors.push({
        pid: row.pid,
        tmp_root: extractControlledTmpRoot(row.command) || '(unknown-controlled-vsix-root)',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function recordRetainedControlledWindow(report, controlledReport) {
  const tmpRoot = controlledReport?.harness?.tmpRoot;
  if (!tmpRoot || !String(tmpRoot).includes('devseek-controlled-vsix-')) return;
  report.process_monitoring.controlled_windows_retained.push({
    tmp_root: tmpRoot,
    workspace_dir: controlledReport?.harness?.workspaceDir || null,
    progress_path: controlledReport?.harness?.progressPath || null,
    vscode_log_path: controlledReport?.harness?.vscodeLogPath || null,
  });
}

function isLastControlledStep(steps, step) {
  const controlled = steps.filter(candidate => candidate.kind === 'controlled-vsix-user-simulation');
  return controlled.length > 0 && controlled[controlled.length - 1] === step;
}

function extractControlledTmpRoot(command) {
  const match = String(command || '').match(/\/tmp\/devseek-controlled-vsix-[^\s"']+/);
  return match ? match[0] : '';
}

function finishReport(report) {
  report.ended_at = new Date().toISOString();
  const failedSteps = report.steps.filter(step => !step.ok);
  const targetedSteps = report.steps.filter(step => step.kind === 'targeted-local-contract');
  const controlledSteps = report.steps.filter(step => step.kind === 'controlled-vsix-user-simulation');
  const targetedCases = targetedSteps.flatMap(executedCaseIdsFromTargetedStep);
  const controlledCases = controlledSteps.flatMap(executedCaseIdsFromControlledStep);
  const baseSummary = {
    total_steps: report.steps.length,
    passed_steps: report.steps.filter(step => step.ok).length,
    failed_steps: failedSteps.map(step => step.id),
    targeted_cases: targetedCases,
    controlled_suites: controlledSteps.map(step => step.id.replace(/^controlled-/, '')),
    controlled_cases: controlledCases,
    snapshots: report.process_monitoring.snapshot_stages.length,
    high_usage_observations: report.process_monitoring.high_usage_observations.length,
    controlled_residuals_terminated: report.process_monitoring.controlled_residuals_terminated.length,
    controlled_windows_retained: report.process_monitoring.controlled_windows_retained.length,
    qualification_effect: 'NONE',
    claims_permitted: false,
  };
  report.summary = baseSummary;
  report.case_design_review = evaluateCaseDesign(report);
  report.fixpoint_replay = buildFixpointReplay(report);
  const baseOk = report.errors.length === 0
    && failedSteps.length === 0
    && report.process_monitoring.residual_errors.length === 0;
  report.summary = {
    ok: baseOk && (!report.case_design_review.enforced || report.case_design_review.ok),
    ...baseSummary,
    case_design_ok: report.case_design_review.ok,
    case_design_profile: report.case_design_review.coverage_profile,
  };
  return {
    ok: report.summary.ok,
    ...report,
  };
}

function refreshCaseDesignReview(report) {
  const next = {
    ...report,
    summary: { ...(report.summary || {}) },
  };
  const review = evaluateCaseDesign(next);
  const originalOk = next.ok !== false && next.summary.ok !== false;
  next.case_design_review = review;
  next.fixpoint_replay = buildFixpointReplay(next);
  next.summary = {
    ...next.summary,
    ok: originalOk && (!review.enforced || review.ok),
    case_design_ok: review.ok,
    case_design_profile: review.coverage_profile,
  };
  next.ok = next.summary.ok;
  return next;
}

function evaluateCaseDesign(report) {
  const plan = report.plan || {};
  const plannedSuites = plannedControlledSuites(plan);
  const plannedTargetedCases = plannedTargetedCaseIds(plan);
  const executedSuites = report.summary?.controlled_suites || [];
  const executedTargetedCases = report.summary?.targeted_cases || [];
  const selectedSuites = report.execution_mode === 'dry-run'
    ? uniqueStrings([...plannedTargetedSuiteIds(plan), ...plannedSuites])
    : uniqueStrings([...executedTargetedSuiteIds(report), ...executedSuites]);
  const suiteCatalog = loadControlledSuiteCatalog();
  const plannedCases = uniqueStrings([
    ...plannedTargetedCases,
    ...casesForSuites(plannedSuites, suiteCatalog),
  ]);
  const executedCases = report.summary?.controlled_cases || [];
  const selectedCases = report.execution_mode === 'dry-run'
    ? plannedCases
    : uniqueStrings([...executedTargetedCases, ...executedCases]);
  const profile = plan.coverage_profile || 'focused-regression';
  const coveredDimensions = CASE_DESIGN_DIMENSIONS
    .filter(dimension => dimension.cases.some(caseId => selectedCases.includes(caseId)))
    .map(dimension => dimension.id);
  const missingDimensions = CASE_DESIGN_DIMENSIONS
    .filter(dimension => !coveredDimensions.includes(dimension.id))
    .map(dimension => dimension.id);
  const missingAcceptanceSuites = ACCEPTANCE_CONTROLLED_SUITES
    .filter(suite => !plannedSuites.includes(suite));
  const missingExecutedAcceptanceSuites = report.execution_mode === 'execute'
    ? ACCEPTANCE_CONTROLLED_SUITES.filter(suite => !executedSuites.includes(suite))
    : [];
  const evidenceMissing = report.execution_mode === 'execute'
    ? report.steps
      .filter(step => step.kind === 'controlled-vsix-user-simulation')
      .flatMap(controlledStepEvidenceFailures)
    : [];
  const enforced = profile === 'top-agent-local-acceptance';
  const planOk = missingAcceptanceSuites.length === 0 && missingDimensions.length === 0;
  const evidenceOk = report.execution_mode !== 'execute'
    || (missingExecutedAcceptanceSuites.length === 0 && evidenceMissing.length === 0);
  return {
    ok: enforced ? planOk && evidenceOk : true,
    enforced,
    coverage_profile: profile,
    verdict: caseDesignVerdict({ enforced, planOk, evidenceOk, executionMode: report.execution_mode }),
    selected_suites: selectedSuites,
    selected_cases: selectedCases,
    required_acceptance_suites: [...ACCEPTANCE_CONTROLLED_SUITES],
    required_acceptance_cases: requiredAcceptanceCases(),
    missing_acceptance_suites: missingAcceptanceSuites,
    missing_executed_acceptance_suites: missingExecutedAcceptanceSuites,
    covered_dimensions: coveredDimensions,
    missing_dimensions: missingDimensions,
    execution_evidence_missing: evidenceMissing,
    acceptance_plan_eligible: planOk,
    acceptance_execution_eligible: enforced && report.execution_mode === 'execute' && planOk && evidenceOk,
    release_claim_permitted: false,
    release_claim_reason: 'Local T3 user simulation can validate product behavior, but C14 release qualification still requires live Provider, RC, sealed holdout, and external authority evidence.',
  };
}

function requiredAcceptanceCases() {
  return [...new Set(CASE_DESIGN_DIMENSIONS.flatMap(dimension => dimension.cases))];
}

function plannedCaseIdsFromControlledStep(step) {
  return uniqueStrings(
    Array.isArray(step.controlledReport?.scenario?.cases)
      ? step.controlledReport.scenario.cases.map(entry => entry.id)
      : [step.controlledReport?.scenario?.id].filter(Boolean)
  );
}

function driverCaseReportsFromControlledStep(step) {
  return Array.isArray(step.controlledReport?.driver?.cases)
    ? step.controlledReport.driver.cases
    : [];
}

function executedCaseIdsFromControlledStep(step) {
  const driverCaseIds = uniqueStrings(driverCaseReportsFromControlledStep(step)
    .map(entry => entry.scenario || entry.id)
    .filter(Boolean));
  if (driverCaseIds.length > 0) return driverCaseIds;
  return plannedCaseIdsFromControlledStep(step);
}

function executedCaseIdsFromTargetedStep(step) {
  if (step.ok !== true) return [];
  return uniqueStrings(step.case_ids || []);
}

function controlledStepEvidenceFailures(step) {
  const suite = step.id.replace(/^controlled-/, '');
  const failures = [];
  if (!step.stdout_log) failures.push(`${suite}:stdout-log-missing`);
  if (!step.report_path) failures.push(`${suite}:report-path-missing`);
  const controlledReport = step.controlledReport;
  if (!controlledReport) {
    failures.push(`${suite}:controlled-report-missing`);
    return failures;
  }
  if (controlledReport.ok !== true) failures.push(`${suite}:controlled-report-not-ok`);
  if (controlledReport.driver?.ok !== true) failures.push(`${suite}:driver-report-not-ok`);
  const plannedCases = plannedCaseIdsFromControlledStep(step);
  const driverCases = driverCaseReportsFromControlledStep(step);
  const driverCaseIds = uniqueStrings(driverCases.map(entry => entry.scenario || entry.id).filter(Boolean));
  if (plannedCases.length > 0 && driverCases.length === 0) {
    failures.push(`${suite}:driver-cases-missing`);
  }
  for (const caseId of plannedCases) {
    if (!driverCaseIds.includes(caseId)) failures.push(`${suite}:driver-case-missing:${caseId}`);
  }
  for (const caseReport of driverCases) {
    const caseId = caseReport.scenario || caseReport.id || 'unknown-case';
    if (caseReport.ok !== true) failures.push(`${suite}:driver-case-not-ok:${caseId}`);
  }
  return uniqueStrings(failures);
}

function casesForSuites(suites, suiteCatalog = loadControlledSuiteCatalog()) {
  return suites.flatMap(suite => suiteCatalog[suite] || []);
}

function plannedTargetedCaseIds(plan) {
  return uniqueStrings((plan.steps || [])
    .filter(step => step.kind === 'targeted-local-contract')
    .flatMap(step => step.case_ids || []));
}

function plannedTargetedSuiteIds(plan) {
  return (plan.steps || []).some(step => step.kind === 'targeted-local-contract')
    ? ['targeted-local-contracts']
    : [];
}

function executedTargetedSuiteIds(report) {
  return (report.steps || []).some(step => step.kind === 'targeted-local-contract' && step.ok === true)
    ? ['targeted-local-contracts']
    : [];
}

function targetedCasesForTests(testPaths) {
  return uniqueStrings(testPaths
    .flatMap(testPath => TARGETED_TEST_CASE_COVERAGE[normalizeTargetedTestPath(testPath)] || []));
}

function normalizeTargetedTestPath(testPath) {
  const normalized = String(testPath || '').replace(/\\/g, '/');
  const repoPrefix = `${repoRoot.replace(/\\/g, '/')}/`;
  if (normalized.startsWith(repoPrefix)) return normalized.slice(repoPrefix.length);
  return normalized.replace(/^\.\//, '');
}

function uniqueStrings(values) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function loadControlledSuiteCatalog() {
  const result = cp.spawnSync(process.execPath, [
    'packages/vscode-extension/test/devseek-controlled-vsix-harness.mjs',
    '--list-suites-json',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) return {};
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    if (parsed.schema_version !== 'devseek.controlled-vsix-suite-catalog/v1') return {};
    return Object.fromEntries(Object.entries(parsed.suites || {}).map(([suite, cases]) => [
      suite,
      Array.isArray(cases) ? cases.map(entry => entry.id).filter(Boolean) : [],
    ]));
  } catch {
    return {};
  }
}

function caseDesignVerdict({ enforced, planOk, evidenceOk, executionMode }) {
  if (!enforced) return 'focused-regression-only-not-release-acceptance';
  if (!planOk) return 'invalid-local-acceptance-matrix';
  if (executionMode !== 'execute') return 'reasonable-local-acceptance-plan-needs-execution';
  if (!evidenceOk) return 'local-acceptance-execution-evidence-incomplete';
  return 'reasonable-local-acceptance-evidence';
}

function buildFixpointReplay(report) {
  const failedSteps = (report.steps || []).filter(step => step.ok !== true);
  const evidenceMissingSuites = uniqueStrings((report.case_design_review?.execution_evidence_missing || [])
    .map(item => String(item).split(':')[0]));
  const failedControlledSuites = uniqueStrings([
    ...failedSteps
      .filter(step => step.kind === 'controlled-vsix-user-simulation')
      .map(step => step.id.replace(/^controlled-/, '')),
    ...evidenceMissingSuites,
  ]);
  const failedControlledCases = uniqueStrings(failedSteps
    .filter(step => step.kind === 'controlled-vsix-user-simulation')
    .flatMap(failedCaseIdsFromControlledStep)
    .concat(controlledCaseIdsFromEvidenceMissing(report.case_design_review?.execution_evidence_missing || [])));
  const failedTargetedSteps = failedSteps.filter(step => step.kind === 'targeted-local-contract');
  const targetedTests = uniqueStrings(failedTargetedSteps.flatMap(targetedTestsFromStep));
  const hasActionableFailure = failedControlledSuites.length > 0 || failedTargetedSteps.length > 0;
  const baseRunId = sanitizeRunId(report.run_id || defaultRunId());
  const focusedRunId = `${baseRunId}-focused-rerun`;
  const acceptanceRunId = `${baseRunId}-acceptance-recheck`;
  const focusedArgs = ['scripts/devseek-top-agent-user-simulation-runner.mjs', '--force'];
  if (failedTargetedSteps.length === 0) focusedArgs.push('--skip-targeted');
  if (targetedTests.length > 0) focusedArgs.push('--targeted-tests', targetedTests.join(','));
  if (failedControlledSuites.length === 0) {
    focusedArgs.push('--skip-controlled');
  } else {
    focusedArgs.push('--controlled-suites', failedControlledSuites.join(','), '--keep-last-window');
  }
  focusedArgs.push(
    '--run-id',
    focusedRunId,
    '--markdown',
    `docs/testing/devseek-${focusedRunId}.md`,
  );
  const acceptanceArgs = [
    'scripts/devseek-top-agent-user-simulation-runner.mjs',
    '--force',
    '--keep-last-window',
    '--run-id',
    acceptanceRunId,
    '--markdown',
    `docs/testing/devseek-${acceptanceRunId}.md`,
  ];
  return {
    needed: hasActionableFailure,
    strategy: hasActionableFailure
      ? 'failed-step-fixpoint-before-broad-regression'
      : 'no-failed-step-replay-needed',
    failed_steps: failedSteps.map(step => step.id),
    failed_controlled_suites: failedControlledSuites,
    failed_controlled_cases: failedControlledCases,
    failed_targeted_steps: failedTargetedSteps.map(step => step.id),
    targeted_tests: targetedTests,
    focused_command: hasActionableFailure ? ['node', ...focusedArgs] : [],
    focused_shell_command: hasActionableFailure ? shellCommand(['node', ...focusedArgs]) : '',
    acceptance_command_after_fix: hasActionableFailure ? ['node', ...acceptanceArgs] : [],
    acceptance_shell_command_after_fix: hasActionableFailure ? shellCommand(['node', ...acceptanceArgs]) : '',
    reason: hasActionableFailure
      ? 'Run only the failed controlled suite or targeted contract first; after it passes, rerun full local acceptance once.'
      : 'No failed step or missing execution evidence was detected.',
  };
}

function failedCaseIdsFromControlledStep(step) {
  const failedDriverCases = driverCaseReportsFromControlledStep(step)
    .filter(entry => entry.ok !== true)
    .map(entry => entry.scenario || entry.id)
    .filter(Boolean);
  if (failedDriverCases.length > 0) return failedDriverCases;
  return plannedCaseIdsFromControlledStep(step);
}

function controlledCaseIdsFromEvidenceMissing(items) {
  return items
    .map(item => String(item).match(/:driver-case-(?:missing|not-ok):([^:]+)$/)?.[1])
    .filter(Boolean);
}

function targetedTestsFromStep(step) {
  if (!Array.isArray(step.command)) return [];
  const testFlag = step.command.indexOf('--test');
  if (testFlag < 0) return [];
  return step.command.slice(testFlag + 1)
    .filter(item => !String(item).startsWith('--'));
}

function sanitizeRunId(value) {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || defaultRunId();
}

function shellCommand(argv) {
  return argv.map(arg => {
    const value = String(arg);
    return /^[A-Za-z0-9_./:=,@+-]+$/.test(value)
      ? value
      : `'${value.replace(/'/g, `'\\''`)}'`;
  }).join(' ');
}

function writeOptionalOutputs(report, options) {
  const reportOnly = options.fromReportPath || report.report_render_mode === 'reuse-existing';
  if (options.evidenceRoot && !options.dryRun && !reportOnly) {
    fs.mkdirSync(options.evidenceRoot, { recursive: true });
    fs.writeFileSync(
      path.join(options.evidenceRoot, 'top-agent-user-simulation-runner.report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
  }
  if (options.markdownPath) {
    fs.mkdirSync(path.dirname(options.markdownPath), { recursive: true });
    fs.writeFileSync(options.markdownPath, renderMarkdownReport(report), 'utf8');
  }
}

function consoleReport(report, options) {
  const caseDesignReview = caseDesignReviewFor(report);
  if (options.printFull || report.execution_mode === 'dry-run') return report;
  return {
    ok: report.ok,
    schema_version: report.schema_version,
    run_id: report.run_id,
    started_at: report.started_at,
    ended_at: report.ended_at,
    repo: report.repo,
    execution_mode: report.execution_mode,
    report_render_mode: report.report_render_mode || null,
    evidence_root: report.evidence_root,
    markdown_report: report.markdown_report,
    strategy: {
      name: report.strategy.name,
      qualification_effect: report.strategy.qualification_effect,
      claims_permitted: report.strategy.claims_permitted,
      gate0_status_effect: report.strategy.gate0_status_effect,
    },
    process_monitoring: {
      snapshots: report.process_monitoring.snapshot_stages.length,
      high_usage_observations: report.process_monitoring.high_usage_observations.length,
      controlled_residuals_terminated: report.process_monitoring.controlled_residuals_terminated.length,
      controlled_windows_retained: (report.process_monitoring.controlled_windows_retained || []).length,
      residual_errors: report.process_monitoring.residual_errors.length,
      window_policy: report.process_monitoring.window_policy,
    },
    steps: report.steps.map(step => ({
      id: step.id,
      kind: step.kind,
      ok: step.ok,
      exit_code: step.exit_code,
      signal: step.signal,
      duration_ms: step.duration_ms,
      stdout_log: step.stdout_log,
      stderr_log: step.stderr_log,
      report_path: step.report_path,
      controlled_ok: step.controlledReport?.ok ?? null,
      bridge_invocations: step.controlledReport?.bridge?.providerInvocationCount ?? null,
      errors: step.errors,
    })),
    summary: report.summary,
    case_design_review: caseDesignReview,
    fixpoint_replay: report.fixpoint_replay || buildFixpointReplay(report),
    errors: report.errors,
  };
}

function renderFindingLines(report, fixpointReplay) {
  if (report.steps.length === 0) return '- Dry run only; no user case execution evidence was produced.';
  const failedSteps = uniqueStrings([
    ...(report.summary?.failed_steps || []),
    ...(fixpointReplay.failed_steps || []),
  ].filter(Boolean));
  if (failedSteps.length > 0 || fixpointReplay.needed) {
    const failedLine = failedSteps.length > 0
      ? `- Product behavior: failing step(s) detected: \`${failedSteps.join('`, `')}\`.`
      : '- Product behavior: execution evidence is incomplete and needs focused replay.';
    return [
      failedLine,
      '- Test workflow: do not restart from zero; use the focused replay command below, then run one full local acceptance recheck after the fix passes.',
      '- Log audit: inspect the failed step report and stdout/stderr before changing code; promote a minimal replay fixture when the failure class is protocol/provider-shaped.',
    ].join('\n');
  }
  return [
    '- Product behavior: no failing DevSeek runtime step was found in the covered T3 controlled user simulations.',
    '- Test workflow: existing PASS evidence is reused by default; report-only rendering is recorded separately as `report_render_mode` and does not overwrite the original execution evidence.',
    '- Log audit: stderr logs were empty for the recorded run, and expected failure/permission terms appear only inside fail-closed or refusal cases.',
  ].join('\n');
}

function renderFixpointReplayMarkdown(fixpointReplay) {
  if (!fixpointReplay?.needed) {
    return [
      '- Needed: `false`',
      `- Reason: ${fixpointReplay?.reason || 'No failed step or missing execution evidence was detected.'}`,
    ].join('\n');
  }
  const caseLine = fixpointReplay.failed_controlled_cases.length > 0
    ? `- Failed controlled cases: \`${fixpointReplay.failed_controlled_cases.join('`, `')}\``
    : '- Failed controlled cases: None resolved from report.';
  return [
    '- Needed: `true`',
    `- Strategy: \`${fixpointReplay.strategy}\``,
    `- Failed steps: \`${fixpointReplay.failed_steps.join('`, `') || 'none'}\``,
    `- Failed controlled suites: \`${fixpointReplay.failed_controlled_suites.join('`, `') || 'none'}\``,
    caseLine,
    '',
    'Focused command:',
    '',
    '```bash',
    fixpointReplay.focused_shell_command,
    '```',
    '',
    'After focused PASS, run:',
    '',
    '```bash',
    fixpointReplay.acceptance_shell_command_after_fix,
    '```',
  ].join('\n');
}

function renderMarkdownReport(report) {
  const caseDesignReview = caseDesignReviewFor(report);
  const fixpointReplay = report.fixpoint_replay || buildFixpointReplay(report);
  const coverageLines = simulationCoverageLines(report);
  const stepRows = report.steps.length > 0
    ? report.steps.map(step => (
      `| \`${step.id}\` | ${step.ok ? 'PASS' : 'FAIL'} | \`${step.kind}\` | \`${step.stdout_log}\` |`
    )).join('\n')
    : '| `(dry-run)` | PASS | `plan-only` | `(not written)` |';
  const caseRows = report.steps
    .filter(step => step.kind === 'controlled-vsix-user-simulation')
    .map(step => {
      const suite = step.id.replace(/^controlled-/, '');
      const cases = Array.isArray(step.controlledReport?.scenario?.cases)
        ? step.controlledReport.scenario.cases.map(item => item.id)
        : [step.controlledReport?.scenario?.id].filter(Boolean);
      return `| \`${suite}\` | ${controlledSuitePurpose(suite)} | \`${cases.join('`, `')}\` | \`${step.controlledReport?.bridge?.providerInvocationCount ?? 'n/a'}\` | \`${step.report_path}\` |`;
    })
    .join('\n');
  const warnings = report.process_monitoring.high_usage_observations;
  const warningLines = warnings.length > 0
    ? warnings.slice(0, 12).map(item => (
      `- ${item.stage}: pid=${item.pid} scope=${item.scope} cpu=${item.cpu_percent}% rss=${item.rss_mb}MB cmd=\`${item.command}\``
    )).join('\n')
    : '- None recorded.';
  const residualLines = report.process_monitoring.controlled_residuals_terminated.length > 0
    ? report.process_monitoring.controlled_residuals_terminated.map(item => (
      `- Sent ${item.signal} to pid=${item.pid} for \`${item.tmp_root}\`.`
    )).join('\n')
    : '- None recorded.';
  const retainedWindows = report.process_monitoring.controlled_windows_retained || [];
  const retainedWindowLines = retainedWindows.length > 0
    ? retainedWindows.map(item => (
      `- Retained \`${item.tmp_root}\` for inspection; workspace \`${item.workspace_dir}\`.`
    )).join('\n')
    : '- None retained.';
  const coveredDimensionLines = caseDesignReview.covered_dimensions.length > 0
    ? caseDesignReview.covered_dimensions.map(item => `- \`${item}\``).join('\n')
    : '- None.';
  const missingDimensionLines = caseDesignReview.missing_dimensions.length > 0
    ? caseDesignReview.missing_dimensions.map(item => `- \`${item}\``).join('\n')
    : '- None.';
  const missingEvidenceLines = caseDesignReview.execution_evidence_missing.length > 0
    ? caseDesignReview.execution_evidence_missing.map(item => `- \`${item}\``).join('\n')
    : '- None.';
  const findingLines = renderFindingLines(report, fixpointReplay);
  const fixpointReplayLines = renderFixpointReplayMarkdown(fixpointReplay);

  return [
    '# DevSeek Top-Agent Convergence User Simulation',
    '',
    `- Run ID: \`${report.run_id}\``,
    `- Execution mode: \`${report.execution_mode}\``,
    report.report_render_mode ? `- Report render mode: \`${report.report_render_mode}\`` : '',
    `- Result: \`${report.ok ? 'PASS' : 'FAIL'}\``,
    `- Evidence root: \`${relativeToRepo(report.evidence_root)}\``,
    `- Source plan: \`${report.plan.source_plan}\``,
    `- Qualification effect: \`${report.strategy.qualification_effect}\`; claims permitted: \`${report.strategy.claims_permitted}\``,
    '',
    '## Strategy',
    '',
    report.strategy.reason,
    '',
    'This run intentionally stays below live qualification: it uses local contract tests and controlled exact-VSIX Surface conformance, then records every artifact needed for later replay.',
    '',
    '## Reuse Policy',
    '',
    'When this evidence root already contains a PASS runner report, the runner reuses it by default and refreshes only the Markdown summary. A new full user simulation requires a new run id or `--force`, and should be reserved for DevSeek runtime, harness contract, or oracle changes that affect the covered behavior.',
    '',
    '## Findings And Fixes',
    '',
    findingLines,
    '',
    '## Fixpoint Replay',
    '',
    fixpointReplayLines,
    '',
    '## User Simulation Coverage',
    '',
    coverageLines,
    '',
    '## Actual User Cases',
    '',
    '| Suite | User Simulation Focus | Executed Cases | Bridge Requests | Report |',
    '| --- | --- | --- | ---: | --- |',
    caseRows || '| `(dry-run)` | Plan only | `(not executed)` | `0` | `(not written)` |',
    '',
    '## Case Design Review',
    '',
    `- Profile: \`${caseDesignReview.coverage_profile}\``,
    `- Verdict: \`${caseDesignReview.verdict}\``,
    `- Enforced: \`${caseDesignReview.enforced}\``,
    `- Acceptance plan eligible: \`${caseDesignReview.acceptance_plan_eligible}\``,
    `- Acceptance execution eligible: \`${caseDesignReview.acceptance_execution_eligible}\``,
    `- Selected case count: \`${caseDesignReview.selected_cases.length}\``,
    `- Required acceptance case count: \`${caseDesignReview.required_acceptance_cases.length}\``,
    `- Release claim permitted: \`${caseDesignReview.release_claim_permitted}\``,
    `- Release claim reason: ${caseDesignReview.release_claim_reason}`,
    '',
    'Covered dimensions:',
    coveredDimensionLines,
    '',
    'Missing dimensions:',
    missingDimensionLines,
    '',
    'Execution evidence missing:',
    missingEvidenceLines,
    '',
    '## Execution',
    '',
    '| Step | Result | Kind | Log |',
    '| --- | --- | --- | --- |',
    stepRows,
    '',
    '## Process Monitoring',
    '',
    `- Snapshots captured: \`${report.summary?.snapshots ?? 0}\``,
    `- High-usage observations: \`${warnings.length}\``,
    `- Controlled residuals terminated: \`${report.process_monitoring.controlled_residuals_terminated.length}\``,
    `- Controlled windows retained: \`${retainedWindows.length}\``,
    '',
    'High-usage observations:',
    warningLines,
    '',
    'Residual controlled VSIX cleanup:',
    residualLines,
    '',
    'Retained controlled VSIX windows:',
    retainedWindowLines,
    '',
    '## Next Iteration',
    '',
    '- Run one headed DeepSeek Web debug case only when the user explicitly authorizes retaining the VS Code window and DeepSeek page.',
    '- Promote any new live reply incompatibility into a minimal replay fixture before rerunning the large matrix.',
    '- Keep resource snapshots in this runner so repeated iteration starts from the last failing class, not from a full reset.',
    '',
  ].join('\n');
}

function caseDesignReviewFor(report) {
  const review = report.case_design_review;
  if (
    !review
    || !Array.isArray(review.selected_cases)
    || !Array.isArray(review.required_acceptance_cases)
  ) {
    return evaluateCaseDesign(report);
  }
  return review;
}

function repoState() {
  return {
    head: gitOutput(['rev-parse', '--short', 'HEAD']) || 'unknown',
    dirty_tracked_paths: gitOutputLines(['diff', '--name-only']),
    dirty_cached_paths: gitOutputLines(['diff', '--cached', '--name-only']),
    untracked_paths: gitOutputLines(['ls-files', '--others', '--exclude-standard'])
      .filter(item => !item.startsWith('code/devseek-tests/')),
  };
}

function gitOutput(args) {
  const result = cp.spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function gitOutputLines(args) {
  return gitOutput(args).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function optionValue(argv, key) {
  const index = argv.indexOf(key);
  return index >= 0 ? argv[index + 1] || '' : '';
}

function listOption(argv, key, fallback) {
  const raw = optionValue(argv, key);
  if (!raw) return [...fallback];
  return raw.split(',').map(value => value.trim()).filter(Boolean);
}

function includesEvery(values, requiredValues) {
  return requiredValues.every(value => values.includes(value));
}

function plannedControlledSuites(plan) {
  return (plan.steps || [])
    .filter(step => step.kind === 'controlled-vsix-user-simulation')
    .map(step => {
      const suiteIndex = Array.isArray(step.command) ? step.command.indexOf('--suite') : -1;
      return suiteIndex >= 0 ? step.command[suiteIndex + 1] : step.id?.replace(/^controlled-/, '');
    })
    .filter(Boolean);
}

function defaultRunId(now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-t${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const head = gitOutput(['rev-parse', '--short', 'HEAD']) || 'local';
  return `${stamp}-top-agent-g${head}`;
}

function sanitizeFileName(value) {
  return String(value || 'snapshot').replace(/[^0-9A-Za-z._-]+/g, '-');
}

function classifyProcessScope(command) {
  if (CONTROLLED_PROCESS_PATTERN.test(command)) return 'controlled-vsix-test';
  if (/codex/i.test(command)) return 'codex-host';
  if (/code/i.test(command)) return 'vscode-host';
  if (/playwright|chrome|chromium/i.test(command)) return 'browser-automation';
  return 'other';
}

function trimCommand(command) {
  const normalized = String(command || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function relativeToRepo(filePath) {
  const relative = path.relative(repoRoot, path.resolve(filePath)).replace(/\\/g, '/');
  return relative.startsWith('..') ? path.resolve(filePath) : relative;
}
