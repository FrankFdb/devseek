/**
 * Regression coverage for Agent Working state convergence.
 *
 * Claude Code/Codex-style contract:
 * - tool rows are historical evidence; the active header should stay task-scoped
 * - validation started is transient, not a second live card
 * - end/error must stop every active Working animation
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../');
const webview = readFileSync(path.join(rootDir, 'media/webview.js'), 'utf8');

test('agent working state: workflow status is snapshot-only during agent mode', () => {
  assert.match(
    webview,
    /var renderLiveWorkflow = !isAgentMode;[\s\S]*?updateWorkingEntryFromWorkflow\(msg, \{ render: renderLiveWorkflow \}\);[\s\S]*?if \(!renderLiveWorkflow\) return;/,
  );
});

test('agent working state: validate started does not create standalone card', () => {
  assert.match(
    webview,
    /if \(msg\.phase === 'validate'\) \{[\s\S]*?if \(msg\.state === 'started'\) \{[\s\S]*?validateSpin\.textContent = msg\.title \|\| '正在执行验证';[\s\S]*?return;[\s\S]*?agentValidationSummary/,
  );
});

test('agent working state: end and error finalize active working containers', () => {
  assert.match(
    webview,
    /function finalizeActiveAgentWorkingContainers\(isFailed\)[\s\S]*?querySelectorAll\('\.aut-container:not\(\[data-done\]\)'/,
  );
  assert.match(
    webview,
    /function hasAgentFailureState\(\)[\s\S]*?agentValidationSummary[\s\S]*?agentTodos[\s\S]*?agentToolTodos[\s\S]*?workingEntries\.values\(\)/,
  );
  assert.match(
    webview,
    /msg\.type === 'endResponse'[\s\S]*?var _wasAgentMode = isAgentMode;[\s\S]*?if \(_wasAgentMode\) finalizeActiveAgentWorkingContainers\(hasAgentFailureState\(\)\);[\s\S]*?resetWorkingArea\(\);/,
  );
  assert.match(
    webview,
    /msg\.type === 'error'[\s\S]*?if \(isAgentMode\) finalizeActiveAgentWorkingContainers\(true\);/,
  );
});

test('agent working state: tool activity keeps task-scoped header when available', () => {
  assert.match(
    webview,
    /setAgentContainerLabel\(container, agentCurrentTaskLabel \|\| nextLabel, true\);/,
  );
});

test('agent working state: failed final labels use explicit failed todo before finalize', () => {
  assert.match(
    webview,
    /function findFailedTodoLabel\(\)[\s\S]*?agentToolTodos[\s\S]*?status === 'failed'[\s\S]*?failedTodo\.title/,
  );
  assert.match(
    webview,
    /function buildFinishedLabel\(isFailed, container\)[\s\S]*?if \(isFailed\) \{[\s\S]*?var failedTodoLabel = findFailedTodoLabel\(\);[\s\S]*?return '失败：' \+ failedTodoLabel \+ stepSuffix;/,
  );
  assert.match(
    webview,
    /var finalFailureTodosSynced = false;[\s\S]*?handleTodoUpdate\(markFirstActiveTodoFailedForFinalState\(agentToolTodos\)\);[\s\S]*?finalizeActiveAgentWorkingContainers\(doneFailed\);/,
  );
});

test('agent working state: provider error title overrides generic failed activity label', () => {
  assert.match(webview, /let agentLastErrorTitle = '';/);
  assert.match(
    webview,
    /function buildFinishedLabel\(isFailed, container\)[\s\S]*?if \(isFailed\) \{[\s\S]*?if \(agentLastErrorTitle\) return agentLastErrorTitle \+ stepSuffix;/,
  );
  assert.match(
    webview,
    /if \(msg\.phase === 'error'\) agentLastErrorTitle = msg\.title \|\| '本轮失败';[\s\S]*?finalizeActiveAgentWorkingContainers\(doneFailed\);/,
  );
});

test('agent checkpoint banner anchors near the current input area, not transcript start', () => {
  assert.match(
    webview,
    /function insertCheckpointBannerAtLatestPosition\(banner\)[\s\S]*?inputAreaEl\.parentNode\.insertBefore\(banner,\s*inputAreaEl\)/,
  );
  assert.match(webview, /function shouldDisplayCheckpointBanner\(msg\)[\s\S]*?!msg\.totalTasks \|\| msg\.resumeTaskIndex >= msg\.totalTasks[\s\S]*?if \(isGenerating && !hasPauseEvidence\) return false;/);
  assert.doesNotMatch(webview, /insertBefore\(banner,\s*container\.firstChild\)/);
});

test('agent checkpoint banner labels response corruption as safe retry', () => {
  assert.match(
    webview,
    /function getCheckpointBannerCopy\(recoveryKind, pauseReason\)[\s\S]*?ResponseCorrupted[\s\S]*?action: '安全重试'[\s\S]*?statusLabel: '等待重新生成安全响应。'[\s\S]*?promptLabel: '原请求包含未完成或损坏的工具文本，已阻止执行。'/,
  );
  assert.match(webview, /var promptSource = bannerCopy\.promptLabel \|\| userPrompt \|\| '';/);
  assert.match(webview, /var progressLabel = bannerCopy\.statusLabel \|\| \('已完成 ' \+ resumeTaskIndex/);
  assert.match(
    webview,
    /showCheckpointBanner\(msg\.resumeTaskIndex, msg\.totalTasks, msg\.userPrompt, msg\.savedAt, msg\.recoveryKind, msg\.pauseReason\)/,
  );
});

test('agent working state: response tasks and fallbacks are localized and non-file-like', () => {
  assert.match(webview, /taskAction === 'respond' \? ''/);
  assert.doesNotMatch(webview, /taskAction === 'respond' \? 'Responding '/);
  assert.match(webview, /label \|\| '处理中\.\.\.'/);
  assert.doesNotMatch(webview, /label \|\| 'Working\.\.\.'/);
});
