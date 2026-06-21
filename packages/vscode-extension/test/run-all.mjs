#!/usr/bin/env node
/**
 * Run all unit tests and exit 0 if all pass, 1 if any fail.
 * Usage: node test/run-all.mjs
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../');

const suites = [
  'test/unit/agent-working-state.test.mjs',
  'test/unit/agentic-history.test.mjs',
  'test/unit/architecture-boundary.test.mjs',
  'test/unit/project-instruction-service.test.mjs',
  'test/unit/memory-service.test.mjs',
  'test/unit/project-init-service.test.mjs',
  'test/unit/context-assembly-service.test.mjs',
  'test/unit/context-discovery-service.test.mjs',
  'test/unit/agent-application-service.test.mjs',
  'test/unit/platform-runtime.test.mjs',
  'test/unit/agent-display-regression.test.mjs',
  'test/unit/webview-logic.test.mjs',
  'test/unit/webview-protocol.test.mjs',
  'test/unit/completion-evidence.test.mjs',
  'test/unit/intent-router.test.mjs',
  'test/unit/chat-controller.test.mjs',
  'test/unit/chat-session-turn-service.test.mjs',
  'test/unit/interaction-service.test.mjs',
  'test/unit/local-attachment-context.test.mjs',
  'test/unit/file-discovery.test.mjs',
  'test/unit/read-only-inspection-service.test.mjs',
  'test/unit/verification-planner.test.mjs',
  'test/unit/quality-gate-service.test.mjs',
  'test/unit/intent-behavior-matrix.test.mjs',
  'test/unit/permission-service.test.mjs',
  'test/unit/terminal-command-policy.test.mjs',
  'test/unit/task-checkpoint-store.test.mjs',
  'test/unit/task-history-store.test.mjs',
  'test/unit/task-ledger.test.mjs',
  'test/unit/task-timeline-service.test.mjs',
  'test/unit/workflow-service.test.mjs',
  'test/unit/resume-context-builder.test.mjs',
  'test/unit/idempotency-guard.test.mjs',
  'test/unit/provider-recovery-service.test.mjs',
  'test/unit/web-reliability.test.mjs',
  'test/unit/execution-planner.test.mjs',
  'test/unit/agentic-repair-service.test.mjs',
  'test/unit/session-service.test.mjs',
  'test/unit/session-continuation.test.mjs',
  'test/unit/pending-edit-service.test.mjs',
  'test/unit/fake-tool-parser.test.mjs',
  'test/unit/agent-loop-write-guard.test.mjs',
  'test/unit/tool-registry.test.mjs',
  'test/unit/tool-call-normalizer.test.mjs',
  'test/unit/provider-runtime.test.mjs',
  'test/unit/tool-executor.test.mjs',
  'test/unit/validation-service.test.mjs',
  'test/unit/workspace-edit-service.test.mjs',
  'test/unit/workspace-review-ledger.test.mjs',
  'test/unit/apply-failure-recovery-service.test.mjs',
  'test/unit/agent-task-decomposer.test.mjs',
  'test/unit/path-resolver.test.mjs',
  'test/unit/workspace-applier.test.mjs',
  'test/unit/generated-file-parser.test.mjs',
  'test/unit/llm-agent-loop.test.mjs',
  'test/unit/pending-edit-workflow.test.mjs',
  'test/unit/vision-message-format.test.mjs',
  'test/unit/workflow-compliance.test.mjs',
];

let passed = 0;
let failed = 0;

for (const suite of suites) {
  process.stdout.write(`\n▶  ${suite}\n`);
  try {
    execSync(`node --test ${suite}`, { cwd: rootDir, stdio: 'inherit' });
    passed++;
  } catch {
    failed++;
  }
}

const total = passed + failed;
const status = failed === 0 ? '✅ ALL PASS' : `❌ ${failed} FAILED`;
console.log(`\n────────────────────────────────────────`);
console.log(`Suites: ${total}  ✔ ${passed} passed  ✖ ${failed} failed`);
console.log(status);
console.log(`────────────────────────────────────────\n`);

process.exit(failed > 0 ? 1 : 0);
