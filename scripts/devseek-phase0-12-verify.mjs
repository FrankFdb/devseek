#!/usr/bin/env node
import cp from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const includeRealDeepSeek = args.has('--real-deepseek') || process.env.DEVSEEK_PHASE0_12_REAL_DEEPSEEK === '1';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const reportRoot = path.join(repoRoot, 'docs', 'testing', 'phase0-12-verification-reports');
const reportDir = path.join(reportRoot, runId);
const jsonReportPath = path.join(reportDir, 'report.json');
const markdownReportPath = path.join(reportDir, 'report.md');
const latestReportPath = path.join(reportRoot, 'latest.md');

fs.mkdirSync(reportDir, { recursive: true });

const gates = [
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
    id: includeRealDeepSeek ? 'agent-loop-subloops-plus-live-deepseek' : 'agent-loop-subloops',
    phases: '10-12',
    command: includeRealDeepSeek
      ? ['npm', 'run', 'verify:agent-loop-eval:real']
      : ['npm', 'run', 'verify:agent-loop-eval'],
    purpose: includeRealDeepSeek
      ? 'Agent core, CLI JSONL, fake Bridge SSE, deterministic programming artifacts, and live DeepSeek Web L4 smoke.'
      : 'Agent core, CLI JSONL, fake Bridge SSE, programming artifact, and loose tool JSON regression subloops.',
  },
  {
    id: 'programming-agent-pa0-pa12',
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
  reportDir,
  jsonReportPath,
  markdownReportPath,
  latestReportPath,
  gates: [],
  phaseSummary: [],
  findings: [],
  iterationDecision: [],
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
  report.ok = report.gates.every(gate => gate.status === 'passed');
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

  if (report.findings.length === 0) {
    report.iterationDecision.push('Phase 0-12 executable gates passed. Keep adding harder replay and live-provider cases before claiming Claude Code/Codex parity.');
  } else {
    report.iterationDecision.push('Stop promotion: fix failed Phase 0-12 gates, rerun this script, and keep the failed report as iteration evidence.');
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
  if (/programming-agent/i.test(gate.id)) return 'programming-agent-benchmark-failure';
  if (/agent-loop/i.test(gate.id)) return includeRealDeepSeek ? 'agent-loop-live-deepseek-failure' : 'agent-loop-subloop-failure';
  if (/whitespace/i.test(gate.id)) return 'diff-integrity-failure';
  if (/P0-P9/i.test(gate.id)) return 'phase0-9-regression';
  return 'phase-gate-regression';
}

function nextActionFor(gate) {
  const actions = {
    'P0-P9-vscode-extension-unit': 'Fix the failing extension unit suite or update the runner only if the oracle is invalid, then rerun verify:phase0-12.',
    'P10-runtime-surface': 'Fix shared/bridge/CLI/extension compile or runtime-surface tests, then rerun verify:phase10 and verify:phase0-12.',
    'P11-engineering-integrity': 'Fix engineering context shared-core regressions, then rerun verify:phase11 and verify:phase0-12.',
    'P12-top-agent-enhancements': 'Fix hooks/skills/subagents/MCP/Git shared-core or CLI regressions, then rerun verify:phase12 and verify:phase0-12.',
    'agent-loop-subloops': 'Classify the failed subloop, add deterministic replay if needed, fix DevSeek, then rerun verify:agent-loop-eval.',
    'agent-loop-subloops-plus-live-deepseek': 'Classify live DeepSeek failure as environment, model protocol, or DevSeek runtime gap; capture artifacts, add deterministic replay if possible, then rerun verify:phase0-12:real.',
    'programming-agent-pa0-pa12': 'Fix the exposed coding-agent capability gap, then rerun verify:programming-agent-benchmark.',
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
    `- Real DeepSeek L4: ${report.includeRealDeepSeek ? 'included' : 'not included'}`,
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
