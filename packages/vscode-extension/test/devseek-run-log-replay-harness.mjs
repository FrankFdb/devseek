#!/usr/bin/env node
/**
 * Replay DevSeek JSONL run logs and print a deterministic diagnosis report.
 *
 * Usage:
 *   node packages/vscode-extension/test/devseek-run-log-replay-harness.mjs .devseek/runs/20260702-130600.log
 *   node packages/vscode-extension/test/devseek-run-log-replay-harness.mjs --json .devseek/runs/20260702-130600.log
 */

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const extensionRoot = path.join(repoRoot, 'packages/vscode-extension');
const args = process.argv.slice(2);
const json = args.includes('--json');
const logArg = args.find(arg => arg !== '--json');

if (!logArg) {
  console.error('Usage: node packages/vscode-extension/test/devseek-run-log-replay-harness.mjs [--json] <run-log>');
  process.exit(2);
}

const logPath = path.resolve(repoRoot, logArg);
if (!existsSync(logPath)) {
  console.error(`Run log not found: ${logPath}`);
  process.exit(2);
}

const bundlePath = path.join(tmpdir(), `devseek-run-log-replay-${process.pid}.cjs`);
execSync(
  `npx esbuild src/diagnostics/run-log-replay.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node --external:vscode`,
  { cwd: extensionRoot, stdio: 'pipe' },
);

const req = createRequire(import.meta.url);
const {
  replayRunLog,
  formatRunLogReplayReport,
} = req(bundlePath);

const report = replayRunLog(logPath);
if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatRunLogReplayReport(report));
}

const hasError = report.issues.some(issue => issue.severity === 'error');
process.exit(hasError ? 1 : 0);
