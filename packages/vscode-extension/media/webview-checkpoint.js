// Agent checkpoint banner helpers for the DevSeek webview.

// ── 断点续传 checkpoint banner ────────────────────────────────────────────────
var checkpointBannerId = 'ds-checkpoint-banner';

function shouldDisplayCheckpointBanner(msg) {
  if (!msg || !msg.totalTasks || msg.resumeTaskIndex >= msg.totalTasks) return false;
  var hasPauseEvidence = !!(msg.recoveryKind || msg.pauseReason);
  // During an active Agent run, progress checkpoints are internal recovery facts.
  // Only provider pauses/recoverable failures should surface a resume banner.
  if (isGenerating && !hasPauseEvidence) return false;
  return true;
}

function getCheckpointBannerCopy(recoveryKind, pauseReason) {
  var evidence = String(recoveryKind || '') + '\n' + String(pauseReason || '');
  if (/ResponseCorrupted|回复不完整|格式损坏|响应损坏|未验证的内容/.test(evidence)) {
    return {
      title: '上次 Agent 输出被安全阻断',
      action: '安全重试',
      statusLabel: '等待重新生成安全响应。',
      promptLabel: '原请求包含未完成或损坏的工具文本，已阻止执行。',
    };
  }
  if (/LoginRequired|登录已失效|登录/.test(evidence)) {
    return { title: '上次 Agent 任务已暂停', action: '登录后继续' };
  }
  if (/RateLimited|验证码|限流|排队/.test(evidence)) {
    return { title: '上次 Agent 任务已暂停', action: '处理后继续' };
  }
  return { title: '上次 Agent 任务中断', action: '继续执行' };
}

function showCheckpointBanner(resumeTaskIndex, totalTasks, userPrompt, savedAt, recoveryKind, pauseReason) {
  dismissCheckpointBanner(); // remove any existing
  if (!totalTasks || resumeTaskIndex >= totalTasks) return;
  var banner = document.createElement('div');
  banner.id = checkpointBannerId;
  var elapsed = savedAt ? Math.round((Date.now() - savedAt) / 60000) : 0;
  var elapsedLabel = elapsed < 1 ? '刚才' : elapsed + ' 分钟前';
  var bannerCopy = getCheckpointBannerCopy(recoveryKind, pauseReason);
  var promptSource = bannerCopy.promptLabel || userPrompt || '';
  var promptLabel = promptSource.slice(0, 60) + (promptSource.length > 60 ? '…' : '');
  var remaining = Math.max(0, totalTasks - resumeTaskIndex);
  var progressLabel = bannerCopy.statusLabel || ('已完成 ' + resumeTaskIndex + '/' + totalTasks + ' 个任务，剩余 ' + remaining + ' 个。');
  banner.innerHTML =
    '<span style="flex:1;min-width:0">' +
      '<b>' + escapeHtml(bannerCopy.title) + '</b>（' + elapsedLabel + '）：' + escapeHtml(progressLabel) +
      (promptLabel ? '<br><span style="opacity:.7;font-size:.9em">' + escapeHtml(promptLabel) + '</span>' : '') +
    '</span>' +
    '<button id="ds-cp-resume" style="margin-left:8px;padding:3px 10px;cursor:pointer;border-radius:4px;border:none;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)">' + escapeHtml(bannerCopy.action) + '</button>' +
    '<button id="ds-cp-dismiss" style="margin-left:6px;padding:3px 8px;cursor:pointer;border-radius:4px;border:none;background:transparent;opacity:.7">✕</button>';
  banner.style.cssText =
    'display:flex;align-items:center;gap:6px;padding:8px 12px;margin:8px 8px 6px;' +
    'background:var(--vscode-editorInfo-background,rgba(0,120,212,.15));' +
    'border:1px solid var(--vscode-editorInfo-border,rgba(0,120,212,.3));border-radius:6px;' +
    'font-size:.875em;line-height:1.4;';
  banner.querySelector('#ds-cp-resume').addEventListener('click', function() {
    vscode.postMessage({ type: 'resumeAgentCheckpoint' });
    dismissCheckpointBanner();
  });
  banner.querySelector('#ds-cp-dismiss').addEventListener('click', function() {
    vscode.postMessage({ type: 'dismissAgentCheckpoint' });
    dismissCheckpointBanner();
  });
  insertCheckpointBannerAtLatestPosition(banner);
}

function dismissCheckpointBanner() {
  var existing = document.getElementById(checkpointBannerId);
  if (existing) existing.remove();
}

function insertCheckpointBannerAtLatestPosition(banner) {
  if (inputAreaEl && inputAreaEl.parentNode) {
    inputAreaEl.parentNode.insertBefore(banner, inputAreaEl);
    scrollToBottom(true);
    return;
  }
  var container = document.getElementById('messages') || document.body;
  ensureWorkingAreaAttached();
  container.appendChild(banner);
  scrollToBottom(true);
}
