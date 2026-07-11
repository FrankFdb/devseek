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
    id: 'stability-qualification-unit',
    phases: '0-12',
    command: ['npm', 'run', 'verify:stability-qualification'],
    purpose: 'Prevent deterministic green gates or stale VSIX reports from being promoted to a live stability claim.',
  },
  {
    id: 'P0-P9-vscode-extension-unit',
    phases: '0-9',
    command: ['npm', 'run', 'test', '--workspace=packages/vscode-extension'],
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
  const result = cp.spawnSync(gate.command[0], gate.command.slice(1), {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 180000,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    id: gate.id,
    phases: gate.phases,
    command: gate.command.join(' '),
    purpose: gate.purpose,
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
    report.iterationDecision.push('Deterministic Phase 0-12 gates passed; this proves regression safety, not live VS Code plugin stability.');
  } else {
    report.iterationDecision.push('Stop promotion: fix failed Phase 0-12 gates, rerun this script, and keep the failed report as iteration evidence.');
  }
  if (report.qualification.stableClaimAllowed) {
    report.iterationDecision.push('Same-commit live evidence met the canary/medium/formal quota; a stability claim is allowed for this exact build.');
  } else {
    const counts = report.qualification.scenarioCounts;
    report.iterationDecision.push(`Do not claim stable: same-commit live evidence is canary ${counts.canary}/3, medium ${counts.medium}/2, formal ${counts.formal}/1.`);
  }
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
  if (/stability-qualification/i.test(gate.id)) return 'stability-oracle-regression';
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
    'stability-qualification-unit': 'Fix the qualification oracle before interpreting any deterministic or live test result.',
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
    `- Qualification: ${report.qualification.level}`,
    `- Worktree: ${report.qualification.worktree}`,
    `- Stable claim allowed: ${report.qualification.stableClaimAllowed ? 'yes' : 'no'}`,
    `- Real DeepSeek CLI smoke: ${report.qualification.liveDeepSeekCli}`,
    `- Real VS Code plugin: ${report.qualification.realPlugin}`,
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
    '## Stability Qualification',
    '',
    '| Evidence | Status |',
    '| --- | --- |',
    `| Deterministic gates | ${report.qualification.deterministic} |`,
    `| Live DeepSeek CLI smoke | ${report.qualification.liveDeepSeekCli} |`,
    `| Same-commit real VS Code plugin | ${report.qualification.realPlugin} |`,
    `| Canary quota | ${report.qualification.scenarioCounts.canary}/${report.qualification.requiredScenarioCounts.canary} |`,
    `| Medium quota | ${report.qualification.scenarioCounts.medium}/${report.qualification.requiredScenarioCounts.medium} |`,
    `| Formal quota | ${report.qualification.scenarioCounts.formal}/${report.qualification.requiredScenarioCounts.formal} |`,
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
