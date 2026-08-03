#!/usr/bin/env node
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildStabilityQualification,
  loadRealPluginEvidence,
} from './lib/devseek-stability-qualification.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const args = new Set(argv);
const includeRealDeepSeek = args.has('--real-deepseek') || process.env.DEVSEEK_PHASE0_12_REAL_DEEPSEEK === '1';
const realPluginReportPaths = collectArgValues(argv, '--real-plugin-report')
  .concat(splitReportPaths(process.env.DEVSEEK_REAL_PLUGIN_REPORTS));
const currentCommit = gitCommit();
const worktreeDirty = isWorktreeDirty();
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportRoot = path.join(repoRoot, 'docs', 'testing', 'phase0-12-verification-reports');
const reportDir = path.join(reportRoot, runId);
const jsonReportPath = path.join(reportDir, 'report.json');
const markdownReportPath = path.join(reportDir, 'report.md');
const latestReportPath = path.join(reportRoot, 'latest.md');

fs.mkdirSync(reportDir, { recursive: true });

const gates = [
  {
    id: 'architecture-drift-budget',
    phases: '0-12',
    command: ['npm', 'run', 'verify:architecture-drift'],
    purpose: 'Freeze oversized orchestration and Surface files so new fixes must move responsibility into owned boundaries.',
  },
  {
    id: 'active-baseline-selector-governance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:active-baseline-selector'],
    purpose: 'Fail closed when the current requirement, architecture, or process baseline is missing, ambiguous, stale, or only implied by Markdown prose.',
  },
  {
    id: 'legacy-doc-inventory-governance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:legacy-doc-inventory'],
    purpose: 'Fail closed when a governed legacy requirement, architecture, or handoff document is missing inventory coverage, conflicts with the active baseline selector, or loses supporting-ref reverse coverage.',
  },
  {
    id: 'doc-governance-generation',
    phases: '0-12',
    command: ['npm', 'run', 'verify:doc-governance'],
    purpose: 'Fail closed when governed document front matter, legacy banners, README status, or generated document-governance status drift from the machine selector and inventory sources.',
  },
  {
    id: 'post-r4-compact-index-governance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:post-r4-compact-index'],
    purpose: 'Fail closed when the Post-R4 compact index loses source bindings, promotes local process state into qualification claims, or hides blocked clean-runtime/live/external-authority branches.',
  },
  {
    id: 'post-r4-local-regression-manifest',
    phases: '0-12',
    command: ['npm', 'run', 'verify:post-r4-local-regression-manifest'],
    purpose: 'Fail closed when NP-05/NP-06/NP-07 local regression tracks lose their product test anchors, local-only command boundary, or non-qualification status.',
  },
  {
    id: 'profile-denominator-registry-governance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:profile-denominator-registry'],
    purpose: 'Fail closed when the seven-C0 profile, corpus, catalog, slot, attempt, or applicability denominators drift or are promoted beyond local non-qualification scope.',
  },
  {
    id: 'profile-executor-contract-conformance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:profile-executor-contracts'],
    purpose: 'Fail closed when a Gate 0 denominator slot semantic lacks a unique executor contract, independent oracle, single runner-root binding, or zero-action attack veto.',
  },
  {
    id: 'current-candidate-identity-probe',
    phases: '0-12',
    command: ['npm', 'run', 'verify:current-candidate-identity'],
    purpose: 'Fail closed when source, VSIX, stable install, or active runtime identity is caller-forged, missing, stale, unreadable, or not exact-match bound.',
  },
  {
    id: 'capability-ledger-governance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:capability-ledger'],
    purpose: 'Fail closed on capability graph, typed dependency, scoped qualification target, R1 closure, or generated-manifest drift.',
  },
  {
    id: 'c0-ledger-wiring-conformance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:c0-ledger-wiring'],
    purpose: 'Fail closed when capability state has more than one ledger owner, governed consumers bypass the unique ledger schema, or a wired state lacks machine evidence.',
  },
  {
    id: 'c0-preregistration-wiring-conformance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:c0-preregistration-wiring'],
    purpose: 'Fail closed when production declarations enter qualification, profile executor dispatch bypasses plan/session/slot/authorization/receipt preregistration, or receipt failure oracles dispatch external actions.',
  },
  {
    id: 'c0-run-evidence-wiring-conformance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:c0-run-evidence-wiring'],
    purpose: 'Fail closed when qualification attempt/product Run Evidence correlation lacks exact operation, attempt, candidate, sealed-anchor, local-scope, or original-failure binding.',
  },
  {
    id: 'c0-manifest-aggregator-wiring-conformance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:c0-manifest-aggregator-wiring'],
    purpose: 'Fail closed when manifest aggregation trusts writer summaries, omits denominator/failure/veto/retention/provenance recomputation, or treats local fixture evidence as protected qualification.',
  },
  {
    id: 'external-authority-adapter-contract',
    phases: '0-12',
    command: ['npm', 'run', 'verify:external-authority-adapter'],
    purpose: 'Fail closed when a local object, boolean, stale key, revoked root, clock rollback, manifest/provenance mismatch, or self-hash attempts to forge external qualification authority.',
  },
  {
    id: 'c0-wiring-reconciliation-conformance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:c0-wiring-reconciliation'],
    purpose: 'Fail closed when C0 wiring reports, generated views, package scripts, Phase gates, Gate0 source bindings, claims, or external blockers drift out of the local machine decision contract.',
  },
  {
    id: 'external-authority-request-packets',
    phases: '0-12',
    command: ['npm', 'run', 'verify:external-authority-requests'],
    purpose: 'Fail closed when EXT-01 through EXT-05 request packets are missing, locally approved, claim-capable, unbound from Gate0 inputs, or lack import/secret/redaction boundaries.',
  },
  {
    id: 'external-authority-readiness-audit',
    phases: '0-12',
    command: ['npm', 'run', 'verify:external-authority-readiness-audit'],
    purpose: 'Fail closed when EXT/R4 authorization packets lose precise blockers, executable recovery actions, terminal-state preservation, or non-qualification boundaries.',
  },
  {
    id: 'qualification-protocol-conformance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:qualification-protocol'],
    purpose: 'Fail closed on qualification catalog/profile drift, signed preregistration plans, append-only event CAS, trusted-time rollback, or one-time external-action authorization.',
  },
  {
    id: 'qualification-evidence-manifest-conformance',
    phases: '0-12',
    command: ['npm', 'run', 'verify:qualification-evidence-manifest'],
    purpose: 'Fail closed on frozen slot/attempt denominators, signed exact-tuple claims, event-head invalidation, independent retention locks, or local evidence promoted beyond its integrity scope.',
  },
  {
    id: 'qualification-runner-wiring',
    phases: '0-12',
    command: ['npm', 'run', 'verify:qualification-runner'],
    purpose: 'Keep every declared qualification runner behind the single plan/session/slot, authorization, signed event/receipt, and independent-reader path while catalog-only and disabled entries remain non-qualifying.',
  },
  {
    id: 'gate0-machine-decision-contract',
    phases: '0-12',
    command: ['npm', 'run', 'verify:gate0-decision'],
    purpose: 'Recompute the seven-C0 machine decision while keeping local conformance, protected qualification eligibility, repository blockers, and external-authority blockers separate.',
  },
  {
    id: 'run-evidence-machine-contract',
    phases: '0-12',
    command: ['npm', 'run', 'verify:run-evidence-contract'],
    purpose: 'Fail closed on product-run event taxonomy, operation correlation, immutable record/receipt/seal/snapshot shape, expected-anchor drift, or attempted qualification escalation.',
  },
  {
    id: 'stability-qualification-unit',
    phases: '0-12',
    command: ['npm', 'run', 'verify:stability-qualification'],
    purpose: 'Prevent deterministic gates or legacy scenario-name observations from being promoted to a product qualification claim.',
  },
  {
    id: 'P0-P9-vscode-extension-unit',
    phases: '0-9',
    command: ['npm', 'run', 'test', '--workspace=packages/vscode-extension'],
    timeoutMs: 600000,
    purpose: 'Project instructions, memory, workflow, permissions, ReviewLedger, QualityGate, history, provider runtime, UI protocol, and architecture boundary unit suites.',
  },
  {
    id: 'P10-runtime-surface',
    phases: '10',
    command: ['npm', 'run', 'verify:phase10'],
    purpose: 'Shared core, Bridge, CLI, and VS Code extension compile/build/test profile.',
  },
  {
    id: 'P11-engineering-integrity',
    phases: '11',
    command: ['npm', 'run', 'verify:phase11'],
    purpose: 'Engineering context, ignore policy, runtime detection, dependency/docs/preview/conflict/root/replay contracts.',
  },
  {
    id: 'P12-top-agent-enhancements',
    phases: '12',
    command: ['npm', 'run', 'verify:phase12'],
    purpose: 'Hooks, skills, subagents, MCP/Git contracts plus CLI type/build/test gate.',
  },
  {
    id: 'agent-loop-subloops',
    phases: '10-12',
    command: ['npm', 'run', 'verify:agent-loop-eval'],
    purpose: 'Agent core, CLI JSONL, fake Bridge SSE, programming artifact, and loose tool JSON regression subloops.',
  },
  ...(includeRealDeepSeek ? [{
    id: 'agent-loop-live-deepseek-cli',
    phases: '10-12',
    command: ['npm', 'run', 'verify:agent-loop-eval:real'],
    purpose: 'Live DeepSeek Web CLI smoke; this does not substitute for a real VS Code plugin report.',
  }] : []),
  {
    id: 'programming-agent-pa0-pa13',
    phases: '0-12',
    command: ['npm', 'run', 'verify:programming-agent-benchmark'],
    purpose: 'Claude Code/Codex baseline: file edits, verification, repair, diff, project tests, staged requirements, stdin, multi-file, Python, implicit context, and workspace safety.',
  },
  {
    id: 'diff-whitespace-check',
    phases: '0-12',
    command: ['git', 'diff', '--check'],
    purpose: 'Repository diff whitespace and conflict marker guard.',
  },
];

const report = {
  ok: false,
  runId,
  command: ['node', 'scripts/devseek-phase0-12-verify.mjs', ...process.argv.slice(2)].join(' '),
  target: 'Phase 0-12 executable completion gate',
  includeRealDeepSeek,
  currentCommit,
  worktreeDirty,
  realPluginReportPaths,
  reportDir,
  jsonReportPath,
  markdownReportPath,
  latestReportPath,
  gates: [],
  phaseSummary: [],
  findings: [],
  iterationDecision: [],
  qualification: null,
};

for (const gate of gates) {
  report.gates.push(runGate(gate));
}

analyze();
writeReports();
process.exitCode = report.ok ? 0 : 1;

function runGate(gate) {
  const started = Date.now();
  const timeoutMs = gate.timeoutMs ?? 180000;
  const result = cp.spawnSync(gate.command[0], gate.command.slice(1), {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    id: gate.id,
    phases: gate.phases,
    command: gate.command.join(' '),
    purpose: gate.purpose,
    timeoutMs,
    status: result.status === 0 ? 'passed' : 'failed',
    durationMs: Date.now() - started,
    exitCode: result.status,
    signal: result.signal,
    stdoutTail: tail(stdout),
    stderrTail: tail(stderr),
  };
}

function analyze() {
  const realPluginEvidence = loadRealPluginEvidence(realPluginReportPaths, currentCommit);
  const invalidRealPluginEvidence = realPluginEvidence.filter(item => item.status !== 'passed');
  report.ok = report.gates.every(gate => gate.status === 'passed')
    && invalidRealPluginEvidence.length === 0;
  report.qualification = buildStabilityQualification({
    gates: report.gates,
    includeRealDeepSeek,
    realPluginEvidence,
    currentCommit,
    worktreeDirty,
  });
  for (let phase = 0; phase <= 12; phase++) {
    const covering = report.gates.filter(gate => phaseCovered(gate.phases, phase));
    const failed = covering.filter(gate => gate.status !== 'passed');
    report.phaseSummary.push({
      phase,
      status: failed.length === 0 ? 'passed' : 'failed',
      gates: covering.map(gate => gate.id),
      failedGates: failed.map(gate => gate.id),
    });
  }

  for (const gate of report.gates.filter(candidate => candidate.status !== 'passed')) {
    report.findings.push({
      id: `F${report.findings.length + 1}`,
      gateId: gate.id,
      severity: 'high',
      category: classifyGateFailure(gate),
      evidence: summarize(`${gate.stderrTail}\n${gate.stdoutTail}`),
      nextAction: nextActionFor(gate),
    });
  }
  for (const evidence of invalidRealPluginEvidence) {
    report.findings.push({
      id: `F${report.findings.length + 1}`,
      gateId: 'real-plugin-evidence',
      severity: 'high',
      category: 'invalid-or-stale-live-plugin-evidence',
      evidence: `${evidence.reportPath}: ${evidence.reasons.join(', ')}`,
      nextAction: 'Run the exact current VSIX through the real VS Code + DeepSeek Web harness, require Runtime Replay success, then pass that report path again.',
    });
  }

  if (report.findings.length === 0) {
    report.iterationDecision.push('Deterministic Phase 0-12 gates passed; this proves regression safety only and authorizes no product qualification.');
  } else {
    report.iterationDecision.push('Stop promotion: fix failed Phase 0-12 gates, rerun this script, and keep the failed report as iteration evidence.');
  }
  const counts = report.qualification.scenarioCounts;
  const thresholds = report.qualification.legacyObservationThresholds;
  report.iterationDecision.push(
    `Legacy development live observations: canary ${counts.canary}/${thresholds.canary}, `
      + `medium ${counts.medium}/${thresholds.medium}, formal ${counts.formal}/${thresholds.formal}; `
      + 'these scenario-name buckets are coverage statistics only and cannot authorize candidate or stable.',
  );
}

function phaseCovered(spec, phase) {
  return String(spec).split(',').some(part => {
    const trimmed = part.trim();
    const range = trimmed.match(/^(\d+)-(\d+)$/);
    if (range) return phase >= Number(range[1]) && phase <= Number(range[2]);
    return Number(trimmed) === phase;
  });
}

function classifyGateFailure(gate) {
  if (/architecture-drift/i.test(gate.id)) return 'architecture-boundary-regression';
  if (/capability-ledger/i.test(gate.id)) return 'capability-governance-regression';
  if (/c0-ledger-wiring/i.test(gate.id)) return 'c0-ledger-wiring-regression';
  if (/c0-preregistration-wiring/i.test(gate.id)) return 'c0-preregistration-wiring-regression';
  if (/c0-run-evidence-wiring/i.test(gate.id)) return 'c0-run-evidence-wiring-regression';
  if (/c0-manifest-aggregator-wiring/i.test(gate.id)) return 'c0-manifest-aggregator-wiring-regression';
  if (/external-authority-adapter/i.test(gate.id)) return 'external-authority-adapter-regression';
  if (/c0-wiring-reconciliation/i.test(gate.id)) return 'c0-wiring-reconciliation-regression';
  if (/external-authority-request/i.test(gate.id)) return 'external-authority-request-regression';
  if (/profile-executor/i.test(gate.id)) return 'profile-executor-contract-regression';
  if (/current-candidate-identity/i.test(gate.id)) return 'current-candidate-identity-regression';
  if (/qualification-runner/i.test(gate.id)) return 'qualification-runner-bypass-regression';
  if (/gate0-machine-decision/i.test(gate.id)) return 'gate0-machine-decision-regression';
  if (/run-evidence/i.test(gate.id)) return 'run-evidence-contract-regression';
  if (/stability-qualification/i.test(gate.id)) return 'legacy-observation-guard-regression';
  if (/programming-agent/i.test(gate.id)) return 'programming-agent-benchmark-failure';
  if (/live-deepseek/i.test(gate.id)) return 'agent-loop-live-deepseek-failure';
  if (/agent-loop/i.test(gate.id)) return 'agent-loop-subloop-failure';
  if (/whitespace/i.test(gate.id)) return 'diff-integrity-failure';
  if (/P0-P9/i.test(gate.id)) return 'phase0-9-regression';
  return 'phase-gate-regression';
}

function nextActionFor(gate) {
  const actions = {
    'architecture-drift-budget': 'Move the new responsibility into the owning service/adapter, lower the frozen ceiling after extraction, then rerun verify:architecture-drift.',
    'capability-ledger-governance': 'Fix the machine ledger, typed dependency, scoped claim target, or generated manifest at its semantic authority, then rerun verify:capability-ledger.',
    'post-r4-compact-index-governance': 'Restore the source-bound Post-R4 compact index, keep clean runtime/live/external-authority branches BLOCKED, preserve claims=0 and Gate0 NOT_PASSED, then rerun verify:post-r4-compact-index.',
    'post-r4-local-regression-manifest': 'Restore NP-05/NP-06/NP-07 test/source anchors, keep commands local-only with no live Provider or VSIX action, preserve claims=0/Gate0 NOT_PASSED, then rerun verify:post-r4-local-regression-manifest.',
    'c0-ledger-wiring-conformance': 'Restore the single capability ledger owner, direct reader coverage, Phase reachability, and wired-state evidence before rerunning verify:c0-ledger-wiring.',
    'c0-preregistration-wiring-conformance': 'Restore production declaration coverage, single runner-root preregistration through plan/session/slot/authorization/receipt, and zero-dispatch receipt oracles before rerunning verify:c0-preregistration-wiring.',
    'c0-run-evidence-wiring-conformance': 'Restore exact product Run Evidence to qualification attempt/candidate/operation/anchor binding, preserve original oracle failures, and rerun verify:c0-run-evidence-wiring.',
    'c0-manifest-aggregator-wiring-conformance': 'Restore independent manifest aggregation over denominator/failure/veto/retention/provenance/run-evidence inputs, keep local evidence non-qualifying, and rerun verify:c0-manifest-aggregator-wiring.',
    'external-authority-adapter-contract': 'Restore fail-closed external authority adapter schema, ordinary-object/boolean rejection, revocation/time/provenance guards, and non-qualifying Gate0 binding before rerunning verify:external-authority-adapter.',
    'c0-wiring-reconciliation-conformance': 'Restore C0 report hash/source/generated-view reconciliation, Gate0 NOT_PASSED source binding, claims=0, repo blockers=0, external blockers=6, package scripts, and Phase coverage before rerunning verify:c0-wiring-reconciliation.',
    'external-authority-request-packets': 'Restore EXT-01 through EXT-05 ExternalAuthorityRequest packets, keep terminal_state=BLOCKED without external artifacts, preserve claims=0/Gate0 NOT_PASSED, and rerun verify:external-authority-requests.',
    'external-authority-readiness-audit': 'Restore the EXT/R4 readiness audit source bindings, precise blockers, executable next authorization actions, terminal_state preservation, and no-ledger-write boundary before rerunning verify:external-authority-readiness-audit.',
    'profile-executor-contract-conformance': 'Restore one unique executor contract and independent oracle for each Gate 0 denominator slot semantic, keep execution behind the single runner root, and rerun verify:profile-executor-contracts.',
    'current-candidate-identity-probe': 'Restore the read-only source, VSIX, stable install, and active runtime identity binding; retire stale debug runtime only with fresh authorization, then rerun verify:current-candidate-identity.',
    'qualification-runner-wiring': 'Restore the single guarded runner composition root, remove or disable bypass entry points, and rerun verify:qualification-runner; local runner conformance must remain non-qualifying without protected authority.',
    'gate0-machine-decision-contract': 'Fix the source-bound Gate 0 report or its decision invariants; a green checker validates the decision contract and never substitutes for protected Gate 0 qualification.',
    'run-evidence-machine-contract': 'Fix the shared product-run protocol or its strict event/receipt/record/seal/snapshot/anchor schema at the single evidence authority, then rerun verify:run-evidence-contract.',
    'stability-qualification-unit': 'Fix the legacy observation guard before interpreting deterministic or live development coverage.',
    'P0-P9-vscode-extension-unit': 'Fix the failing extension unit suite or update the runner only if the oracle is invalid, then rerun verify:phase0-12.',
    'P10-runtime-surface': 'Fix shared/bridge/CLI/extension compile or runtime-surface tests, then rerun verify:phase10 and verify:phase0-12.',
    'P11-engineering-integrity': 'Fix engineering context shared-core regressions, then rerun verify:phase11 and verify:phase0-12.',
    'P12-top-agent-enhancements': 'Fix hooks/skills/subagents/MCP/Git shared-core or CLI regressions, then rerun verify:phase12 and verify:phase0-12.',
    'agent-loop-subloops': 'Classify the failed subloop, add deterministic replay if needed, fix DevSeek, then rerun verify:agent-loop-eval.',
    'agent-loop-live-deepseek-cli': 'Classify live DeepSeek failure as environment, model protocol, or DevSeek runtime gap; capture artifacts, add deterministic replay if possible, then rerun verify:phase0-12:real.',
    'programming-agent-pa0-pa13': 'Fix the exposed coding-agent capability gap, then rerun verify:programming-agent-benchmark.',
    'diff-whitespace-check': 'Remove whitespace errors or conflict markers reported by git diff --check.',
  };
  return actions[gate.id] ?? 'Classify the failure, fix the closest product or test-design gap, and rerun verify:phase0-12.';
}

function tail(text, max = 4000) {
  const value = String(text ?? '');
  return value.length <= max ? value : value.slice(value.length - max);
}

function summarize(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1000) || 'No output captured.';
}

function writeReports() {
  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(jsonReportPath, json, 'utf8');
  const markdown = renderMarkdown();
  fs.writeFileSync(markdownReportPath, markdown, 'utf8');
  fs.writeFileSync(latestReportPath, markdown, 'utf8');
  console.log(json);
}

function renderMarkdown() {
  const lines = [
    '# DevSeek Phase 0-12 Verification Report',
    '',
    `- Run ID: ${report.runId}`,
    `- Target: ${report.target}`,
    `- Result: ${report.ok ? 'PASS' : 'FAIL'}`,
    `- Legacy observation level: ${report.qualification.level}`,
    `- Qualification authority: ${report.qualification.qualificationAuthority}`,
    `- Worktree: ${report.qualification.worktree}`,
    `- Candidate claim allowed: ${report.qualification.candidateClaimAllowed ? 'yes' : 'no'}`,
    `- Stable claim allowed: ${report.qualification.stableClaimAllowed ? 'yes' : 'no'}`,
    `- Real DeepSeek CLI smoke: ${report.qualification.liveDeepSeekCli}`,
    `- Real VS Code plugin observation: ${report.qualification.realPlugin}`,
    `- JSON: \`${path.relative(repoRoot, jsonReportPath)}\``,
    `- Latest: \`${path.relative(repoRoot, latestReportPath)}\``,
    '',
    '## Gate Results',
    '',
    '| Gate | Phases | Status | Duration | Command |',
    '| --- | --- | --- | ---: | --- |',
    ...report.gates.map(gate => `| ${gate.id} | ${gate.phases} | ${gate.status} | ${gate.durationMs}ms | \`${gate.command}\` |`),
    '',
    '## Phase Summary',
    '',
    '| Phase | Status | Gates |',
    '| ---: | --- | --- |',
    ...report.phaseSummary.map(phase => `| ${phase.phase} | ${phase.status} | ${phase.gates.join(', ')} |`),
    '',
    '## Legacy Development Observations (Non-Qualification)',
    '',
    '| Evidence | Status |',
    '| --- | --- |',
    `| Deterministic gates | ${report.qualification.deterministic} |`,
    `| Live DeepSeek CLI smoke | ${report.qualification.liveDeepSeekCli} |`,
    `| Same-commit real VS Code plugin observation | ${report.qualification.realPlugin} |`,
    `| Canary name-bucket coverage | ${report.qualification.scenarioCounts.canary}/${report.qualification.legacyObservationThresholds.canary} |`,
    `| Medium name-bucket coverage | ${report.qualification.scenarioCounts.medium}/${report.qualification.legacyObservationThresholds.medium} |`,
    `| Formal name-bucket coverage | ${report.qualification.scenarioCounts.formal}/${report.qualification.legacyObservationThresholds.formal} |`,
    `| Legacy coverage threshold observed | ${report.qualification.legacyObservationThresholdMet ? 'yes' : 'no'} |`,
    '',
    '## Findings',
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('No executable Phase 0-12 gate failure was exposed by this run.');
  } else {
    lines.push('| ID | Gate | Category | Next action |');
    lines.push('| --- | --- | --- | --- |');
    for (const finding of report.findings) {
      lines.push(`| ${finding.id} | ${finding.gateId} | ${finding.category} | ${finding.nextAction} |`);
    }
  }

  lines.push(
    '',
    '## Iteration Decision',
    '',
    ...report.iterationDecision.map(item => `- ${item}`),
    '',
  );
  return `${lines.join('\n')}\n`;
}

function collectArgValues(values, name) {
  const result = [];
  for (let index = 0; index < values.length; index++) {
    if (values[index] === name && values[index + 1]) result.push(values[++index]);
  }
  return result;
}

function splitReportPaths(value) {
  return String(value || '').split(path.delimiter).map(item => item.trim()).filter(Boolean);
}

function gitCommit() {
  const result = cp.spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return String(result.stdout || '').trim();
}

function isWorktreeDirty() {
  const result = cp.spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return Boolean(String(result.stdout || '').trim());
}
