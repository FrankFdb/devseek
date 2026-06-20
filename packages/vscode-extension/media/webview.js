const vscode = acquireVsCodeApi();
const messagesEl = document.getElementById('messages');
const inputEl    = document.getElementById('input');
const sendBtn    = document.getElementById('send-btn');
const suggestEl  = document.getElementById('suggest-popup');
const sDotEl     = document.getElementById('s-dot');
const statusTextEl = document.getElementById('status-text');
const loginBtn   = document.getElementById('login-btn');
const fileBadgesEl = document.getElementById('file-badges');
const readyProgressEl = document.getElementById('ready-progress');
const jumpLatestEl = document.getElementById('jump-latest');
const inputAreaEl = document.getElementById('input-area');
// ── Sessions panel ──
const sessionsPanelEl = document.getElementById('sessions-panel');
const sessionsListEl  = document.getElementById('sessions-list');
var sessionsPanelOpen = false;
const workingEl = document.createElement('div');
workingEl.id = 'working-area';
if (messagesEl) {
  messagesEl.appendChild(workingEl);
}
const editsEl = document.createElement('div');
editsEl.id = 'pending-edits-area';
if (inputAreaEl && inputAreaEl.parentNode) {
  inputAreaEl.parentNode.insertBefore(editsEl, inputAreaEl);
}
// Persistent Todos widget: above the input area, stays until user sends a new message
const todosWidgetEl = document.createElement('div');
todosWidgetEl.id = 'agent-todos-widget';
todosWidgetEl.style.display = 'none';
if (inputAreaEl && inputAreaEl.parentNode) {
  inputAreaEl.parentNode.insertBefore(todosWidgetEl, inputAreaEl);
}
// File Changes widget: shows files edited by the agent; appears on done, cleared on new message
const fileChangesWidgetEl = document.createElement('div');
fileChangesWidgetEl.id = 'agent-file-changes-widget';
fileChangesWidgetEl.style.display = 'none';
if (inputAreaEl && inputAreaEl.parentNode) {
  inputAreaEl.parentNode.insertBefore(fileChangesWidgetEl, inputAreaEl);
  // Copilot input-area order: Todos widget first, then file changes/review widget,
  // then the input box. Keep this stable even though elements are created separately.
  inputAreaEl.parentNode.insertBefore(todosWidgetEl, inputAreaEl);
  inputAreaEl.parentNode.insertBefore(editsEl, inputAreaEl);
  inputAreaEl.parentNode.insertBefore(fileChangesWidgetEl, inputAreaEl);
}
let isGenerating    = false;
let currentBubble   = null;
let currentRaw      = '';
let hadResetRender  = false;
let pendingNewSession = false;
let currentMode   = 'fast';   // 'fast' | 'r1'
let pendingFiles = [];        // [{label, filePath, content}]
var pendingImages = [];       // base64 data URLs from paste (vision input)
let currentRequestPrompt = '';
let generatedContentDisplayMode = 'collapsed';
let workingCopyStyle = 'detailed';
let suppressGeneratedStreaming = false;
let expectGeneratedArtifacts = false;
let currentResponseMeta = { hasGeneratedArtifacts: false, generatedPaths: [], pathHints: [] };
let readySettled = false;
let editingUserTurn = null;
let userPinnedToBottom = true;
let scrollStickTimer = null;
let workflowStateCards = new Map();
let workingEntries = new Map();
let pendingIntentConfirmations = new Map();
let workingSessionState = 'idle';
let workingSessionSummary = '';
let pendingEdits = [];
let pendingHunkExpandState = {};
let pendingEditsListExpanded = false; // 文件列表默认折叠，点击摘要行展开
let fileChangesListExpanded = false; // 完成态文件列表默认折叠，避免占用输入区上方空间
let completionSummaryEmitted = false;
let completionSummaryHasQueue = false;
let hadFirstDelta   = false;    // Working step: '分析请求' → passed on first delta
let agentLastEditedFiles = null;  // editedFiles from done phase — used for auto-summary
let agentDoneSummaryInserted = false; // guard against duplicate final prose summaries
let agentAnalysisFeedbackSeq = 0; // stable ids for analysis feedback bubbles
let collapsedCodeUidSeq = 0; // stable unique ids for collapsed code blocks across turns
let autopilotMode   = false;    // L-5: 自动驾驶模式
let agentEnabled    = true;     // P5-4: Agent 模式开关（false 时强制走普通对话）
let pendingTokenUsage = null;   // P4-1: token usage from most recent API call
let inheritedContextFiles = []; // 当前会话继承的上下文文件（上一轮附件）
let queuedAgentMsg = null;      // §8.5 Queue: message queued while agent runs { displayText, prompt, attachPaths, files, mode, newSession }
const STREAM_RENDER_INTERVAL_MS = 120;
const STATUS_POLL_MS_ACTIVE = 12000;
const STATUS_POLL_MS_HIDDEN = 30000;
let streamRenderTimer = null;
let streamRenderRafId = null;
let streamRenderPending = false;
let streamLastRenderTs = 0;
let analysisRenderTimer = null;
let analysisRenderRafId = null;
let analysisRenderPending = false;
let analysisRenderBody = null;
let analysisLastRenderTs = 0;
let statusPollTimer = null;
let workingResetTimer = null;

injectWorkingAreaStyles();
injectPendingEditsStyles();
injectAnalyzeCardStyles();
injectVisionStyles();

function ensureWorkingAreaAttached() {
  if (!messagesEl || !workingEl) return;
  if (workingEl.parentNode !== messagesEl) {
    messagesEl.appendChild(workingEl);
    return;
  }
  if (messagesEl.lastElementChild !== workingEl) {
    messagesEl.appendChild(workingEl);
  }
}

const SLASH_CMDS = [
  { label: '/explain',  desc: '解释选中代码' },
  { label: '/fix',      desc: '修复 Bug（含 LSP 诊断）' },
  { label: '/refactor', desc: '重构代码' },
  { label: '/tests',    desc: '生成单元测试（框架自动检测）' },
  { label: '/test',     desc: '运行测试（在终端执行检测到的测试命令）' },
  { label: '/doc',      desc: '生成文档注释' },
  { label: '/commit',   desc: '生成 Git 提交信息（不需要选中代码）' },
  { label: '/shell',    desc: '自然语言转 Shell 命令' },
];

// P3-2: @ 提示词
 const AT_CMDS = [
  { label: '@workspace', desc: '注入工作区文件结构摘要' },
  { label: '@problems',  desc: '注入 诊断错误（同 #problems）' },
  { label: '@git',       desc: '注入 git diff（未暂存 + 暂存变更）' },
];

const WORKING_COPY_STRATEGY_TABLE = {
  concise: {
    stageRunning: function(phaseLabel) {
      return '正在处理：' + phaseLabel;
    },
    stageVerb: function(state) {
      if (state === 'passed') return '通过';
      if (state === 'failed') return '失败';
      if (state === 'completed') return '完成';
      if (state === 'skipped') return '跳过';
      return '进行中';
    },
    buildDetail: function(phase, state, detail) {
      if (detail && phase !== 'validate') return detail;
      if (phase === 'apply' && state === 'completed') return '文件已应用。';
      if (phase === 'validate' && state === 'started') return '正在验证修改结果…';
      if (phase === 'validate' && state === 'passed') return '验证通过。';
      if (phase === 'validate' && state === 'failed') return '验证失败。';
      if (phase === 'repair' && (state === 'completed' || state === 'passed')) return '修复完成。';
      if (phase === 'repair' && state === 'failed') return '修复失败。';
      return '';
    },
    idleSummary: function(running) {
      return running ? '过程临时展示，结束后自动收敛。' : '本轮过程已收敛。';
    },
    finishedSummary: function(stats, count, hasArtifacts, hasRaw) {
      var base = '阶段：完成 ' + stats.passed + '，失败 ' + stats.failed + '。';
      if (hasArtifacts) return base + ' 识别到 ' + count + ' 个文件变更。';
      if (hasRaw) return base + ' 已输出结果。';
      return base + ' 无可继续处理输出。';
    },
    failureSummary: function() {
      return '执行失败，请重试或调整提示词。';
    },
  },
  detailed: {
    stageRunning: function(phaseLabel) {
      return '正在处理：' + phaseLabel;
    },
    stageVerb: function(state) {
      if (state === 'passed') return '已通过';
      if (state === 'failed') return '未通过';
      if (state === 'completed') return '已完成';
      if (state === 'skipped') return '已跳过';
      return '进行中';
    },
    buildDetail: function(phase, state, detail) {
      if (detail && phase !== 'validate') return detail;
      if (phase === 'apply') {
        if (state === 'started') return '正在应用文件修改…';
        if (state === 'completed') return '文件修改已应用。';
        if (state === 'failed') return '文件应用失败。';
      }
      if (phase === 'validate') {
        if (state === 'started') return '正在验证修改结果…';
        if (state === 'passed') return '验证通过。';
        if (state === 'failed') return '验证失败。';
        if (state === 'skipped') return '未执行自动验证。';
      }
      if (phase === 'repair') {
        if (state === 'started') return '正在执行自动修复…';
        if (state === 'completed' || state === 'passed') return '自动修复完成。';
        if (state === 'failed') return '自动修复未通过。';
      }
      return '';
    },
    idleSummary: function(running) {
      return running ? '动态过程临时显示，结束后自动收敛。' : '本轮过程已收敛，可继续下一轮提问。';
    },
    finishedSummary: function(stats, count, hasArtifacts, hasRaw) {
      var stageSummary = '阶段结果：完成 ' + stats.passed + '，失败 ' + stats.failed + '，跳过 ' + stats.skipped + '。';
      if (hasArtifacts) return stageSummary + ' 已识别 ' + count + ' 个文件变更，建议先逐文件对比，再按文件或批量应用。';
      if (hasRaw) return stageSummary + ' 结果已写入主消息区，可继续追问细化，或发起下一轮任务。';
      return stageSummary + ' 当前没有可继续处理的输出。';
    },
    failureSummary: function() {
      return '本轮执行失败：请查看错误信息并决定重试、调整提示词或终止。';
    },
  },
};

function normalizeWorkingCopyStyle(style) {
  return style === 'concise' ? 'concise' : 'detailed';
}

function getWorkingCopyStrategy() {
  return WORKING_COPY_STRATEGY_TABLE[normalizeWorkingCopyStyle(workingCopyStyle)] || WORKING_COPY_STRATEGY_TABLE.detailed;
}

let suggestActiveIdx = 0;

function showSuggest(items) {
  if (!items.length) { hideSuggest(); return; }
  suggestActiveIdx = 0;
  suggestEl.innerHTML = items.map((it, i) =>
    `<div class="item${i===0?' active':''}" data-idx="${i}">
      <span class="lbl">${it.label}</span><span class="desc">${it.desc}</span>
    </div>`
  ).join('');
  suggestEl.style.display = 'block';
  suggestEl.querySelectorAll('.item').forEach(function(el) {
    el.addEventListener('mousedown', function(e) {
      e.preventDefault();
      completeSuggest(items[parseInt(el.getAttribute('data-idx'))].label);
    });
  });
}

function hideSuggest() {
  suggestEl.style.display = 'none';
  suggestEl.innerHTML = '';
}

function moveSuggest(dir) {
  const items = suggestEl.querySelectorAll('.item');
  if (!items.length) return false;
  items[suggestActiveIdx].classList.remove('active');
  suggestActiveIdx = (suggestActiveIdx + dir + items.length) % items.length;
  items[suggestActiveIdx].classList.add('active');
  return true;
}

function completeSuggest(label) {
  const cur = inputEl.value;
  // Handle @ completions
  const atIdx = cur.search(/(?:^|\s)@\S*$/);
  if (label.startsWith('@') && atIdx >= 0) {
    const spaceAt = /(?:^|\s)@/.exec(cur.slice(atIdx));
    const insertAt = atIdx + (spaceAt ? spaceAt[0].indexOf('@') : 0);
    inputEl.value = cur.slice(0, insertAt) + label + ' ';
    hideSuggest();
    inputEl.focus();
    return;
  }
  // Handle / completions
  const slashIdx = cur.lastIndexOf('/');
  if (slashIdx >= 0) {
    inputEl.value = cur.slice(0, slashIdx) + label + ' ';
  } else {
    inputEl.value = label + ' ';
  }
  hideSuggest();
  inputEl.focus();
}

vscode.postMessage({ type: 'ready' });

setTimeout(function() {
  settleReadyProgress();
}, 5000);

function settleReadyProgress() {
  if (readySettled) return;
  readySettled = true;
  if (readyProgressEl) readyProgressEl.classList.add('done');
}

function clearStreamRenderTimer() {
  if (streamRenderTimer) { clearTimeout(streamRenderTimer); streamRenderTimer = null; }
  if (streamRenderRafId) { cancelAnimationFrame(streamRenderRafId); streamRenderRafId = null; }
  streamRenderPending = false;
}

function clearAnalysisRenderTimer() {
  if (analysisRenderTimer) { clearTimeout(analysisRenderTimer); analysisRenderTimer = null; }
  if (analysisRenderRafId) { cancelAnimationFrame(analysisRenderRafId); analysisRenderRafId = null; }
  analysisRenderPending = false;
  analysisRenderBody = null;
}

function renderStreamingBubbleNow() {
  if (!currentBubble) return;
  var streamDisplay = renderVisibleAssistantText(currentRaw);
  currentBubble.innerHTML = md(streamDisplay) + '<span class="cursor"></span>';
  pruneEmptyRenderedBlocks(currentBubble);
  streamRenderPending = false;
}

// Hybrid setTimeout+rAF: setTimeout enforces the throttle window so we don't
// spin rAF frames while waiting; rAF defers DOM work to a paint boundary and
// pauses automatically when the webview tab is hidden.
function scheduleStreamingBubbleRender() {
  if (!currentBubble || suppressGeneratedStreaming) return;
  if (streamRenderPending) return;
  streamRenderPending = true;
  var elapsed = Date.now() - streamLastRenderTs;
  var delay = Math.max(0, STREAM_RENDER_INTERVAL_MS - elapsed);
  streamRenderTimer = setTimeout(function() {
    streamRenderTimer = null;
    streamRenderRafId = requestAnimationFrame(function() {
      streamRenderRafId = null;
      if (!streamRenderPending) return;
      streamLastRenderTs = Date.now();
      renderStreamingBubbleNow();
      maybeScrollToBottom();
    });
  }, delay);
}

function scheduleAnalysisBodyRender(body) {
  if (!body) return;
  // If pending for a different body (new container), cancel and reschedule.
  if (analysisRenderPending && analysisRenderBody && analysisRenderBody !== body) {
    clearAnalysisRenderTimer();
  }
  if (analysisRenderPending) return;
  analysisRenderPending = true;
  analysisRenderBody = body;
  var elapsed = Date.now() - analysisLastRenderTs;
  var delay = Math.max(0, STREAM_RENDER_INTERVAL_MS - elapsed);
  analysisRenderTimer = setTimeout(function() {
    analysisRenderTimer = null;
    analysisRenderRafId = requestAnimationFrame(function() {
      analysisRenderRafId = null;
      var b = analysisRenderBody;
      analysisRenderPending = false;
      analysisRenderBody = null;
      if (!b || !b.isConnected) return;
      analysisLastRenderTs = Date.now();
      b.innerHTML = md(sanitizeAgentVisibleText(b._raw)) + '<span class="cursor"></span>';
      pruneEmptyRenderedBlocks(b);
      scrollAgentProgressToBottom();
    });
  }, delay);
}

// ---- 状态栏：登录状态轮询 ----
function pollStatus() {
  vscode.postMessage({ type: 'getStatus' });
}

function scheduleStatusPoll(immediate) {
  if (statusPollTimer) clearTimeout(statusPollTimer);
  statusPollTimer = setTimeout(function() {
    pollStatus();
    scheduleStatusPoll(false);
  }, immediate ? 0 : (document.hidden ? STATUS_POLL_MS_HIDDEN : STATUS_POLL_MS_ACTIVE));
}

pollStatus();
scheduleStatusPoll(false);
document.addEventListener('visibilitychange', function() {
  if (!document.hidden) scheduleStatusPoll(true);
});
window.addEventListener('beforeunload', function() {
  if (statusPollTimer) clearTimeout(statusPollTimer);
  clearStreamRenderTimer();
  clearAnalysisRenderTimer();
});

// ---- 状态栏：切换 Provider 按钮 ----
const switchProviderBtn = document.getElementById('switch-provider-btn');
if (switchProviderBtn) {
  switchProviderBtn.addEventListener('click', function() {
    vscode.postMessage({ type: 'runCommand', command: 'devseek.switchProvider' });
  });
}

// ---- 状态栏：登录按钮 ----
loginBtn.addEventListener('click', function() {
  loginBtn.disabled = true;
  loginBtn.textContent = '打开浏览器...';
  vscode.postMessage({ type: 'relogin' });
  // 5s 后重新检查状态
  setTimeout(function() {
    loginBtn.disabled = false;
    loginBtn.textContent = '🔑 登录';
    pollStatus();
  }, 5000);
});

// ---- 状态栏：模式切换 ----
document.querySelectorAll('.mode-btn').forEach(function(btn) {
  btn.addEventListener('click', function() {
    const mode = btn.getAttribute('data-mode');
    currentMode = mode;
    document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    vscode.postMessage({ type: 'setMode', mode: mode });
  });
});

// ---- 状态栏：自动驾驶切换 (L-5) ----
const autopilotBtn = document.getElementById('autopilot-btn');
if (autopilotBtn) {
  autopilotBtn.addEventListener('click', function() {
    autopilotMode = !autopilotMode;
    autopilotBtn.classList.toggle('active', autopilotMode);
    autopilotBtn.title = autopilotMode
      ? '自动驾驶：开启 — Agent 完成时自动接受所有文件改动（点击关闭）'
      : '自动驾驶：关闭 — Agent 完成时显示 Keep/Undo 确认（点击开启）';
    vscode.postMessage({ type: 'setAutopilot', autopilot: autopilotMode });
  });
}

// ---- 状态栏：Agent 模式开关 (P5-4) ----
const agentToggleBtn = document.getElementById('agent-toggle-btn');
if (agentToggleBtn) {
  agentToggleBtn.classList.toggle('active', agentEnabled);
  agentToggleBtn.title = agentEnabled
    ? 'Agent 模式：开启 — 自动分析意图并执行多轮编辑（点击关闭，走普通对话）'
    : 'Agent 模式：关闭 — 强制普通对话，不触发多轮编辑（点击开启）';
  agentToggleBtn.addEventListener('click', function() {
    agentEnabled = !agentEnabled;
    agentToggleBtn.classList.toggle('active', agentEnabled);
    agentToggleBtn.title = agentEnabled
      ? 'Agent 模式：开启 — 自动分析意图并执行多轮编辑（点击关闭，走普通对话）'
      : 'Agent 模式：关闭 — 强制普通对话，不触发多轮编辑（点击开启）';
    vscode.postMessage({ type: 'agentToggle', enabled: agentEnabled });
  });
}

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';

  const val = inputEl.value;
  const slashMatch = val.match(/(?:^|\s)(\/\S*)$/);
  const atMatch = val.match(/(?:^|\s)(@\S*)$/);
  if (slashMatch) {
    const partial = slashMatch[1];
    const filtered = SLASH_CMDS.filter(function(c) { return c.label.startsWith(partial); });
    showSuggest(filtered);
  } else if (atMatch) {
    const partial = atMatch[1];
    const filtered = AT_CMDS.filter(function(c) { return c.label.startsWith(partial); });
    if (filtered.length > 0) showSuggest(filtered); else hideSuggest();
  } else {
    hideSuggest();
  }
});

inputEl.addEventListener('keydown', function(e) {
  if (suggestEl.style.display !== 'none') {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSuggest(1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveSuggest(-1); return; }
    if (e.key === 'Tab' || e.key === 'Enter') {
      const active = suggestEl.querySelector('.item.active');
      if (active) {
        e.preventDefault();
        const lbl = active.querySelector('.lbl').textContent;
        completeSuggest(lbl);
        return;
      }
    }
    if (e.key === 'Escape') { hideSuggest(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!isGenerating) sendMessage(); else if (isAgentMode) submitAgentSteer(); }
});

sendBtn.addEventListener('click', function() {
  if (isGenerating && isAgentMode) {
    if (inputEl.value.trim() || pendingFiles.length > 0) submitAgentSteer();
    else { vscode.postMessage({ type: 'cancel' }); stopGenerating(); }
  }
  else if (isGenerating) { vscode.postMessage({ type: 'cancel' }); stopGenerating(); }
  else { sendMessage(); }
});

if (jumpLatestEl) {
  jumpLatestEl.addEventListener('click', function() {
    userPinnedToBottom = true;
    hideJumpLatest();
    scrollToBottom(true);
  });
}

messagesEl.addEventListener('scroll', function() {
  userPinnedToBottom = isNearBottom();
  if (userPinnedToBottom) hideJumpLatest();
});

document.getElementById('clear-btn').addEventListener('click', function() {
  messagesEl.innerHTML = '';
  vscode.postMessage({ type: 'clearHistory' });
});

// ── Sessions Panel (Copilot-style history) ────────────────────────
function toggleSessionsPanel(forceOpen) {
  sessionsPanelOpen = (forceOpen !== undefined) ? forceOpen : !sessionsPanelOpen;
  if (sessionsPanelEl) {
    sessionsPanelEl.style.display = sessionsPanelOpen ? 'flex' : 'none';
  }
  var btn = document.getElementById('sessions-btn');
  if (btn) btn.classList.toggle('active', sessionsPanelOpen);
  if (sessionsPanelOpen) {
    vscode.postMessage({ type: 'listSessions' });
  }
}

function renderSessionsList(sessions, activeId) {
  if (!sessionsListEl) return;
  if (!sessions || !sessions.length) {
    sessionsListEl.innerHTML = '<div class="sessions-empty">暂无历史对话记录</div>';
    return;
  }
  // Sort by most recently updated/created first (Copilot style)
  var sorted = sessions.slice().sort(function(a, b) {
    return (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
  });
  sessionsListEl.innerHTML = sorted.map(function(s) {
    var isActive = s.id === activeId;
    var date = new Date(s.updatedAt || s.createdAt);
    var now = new Date();
    var dateStr;
    var diffDays = Math.floor((now - date) / 86400000);
    if (diffDays === 0) {
      dateStr = '今天 ' + date.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
    } else if (diffDays === 1) {
      dateStr = '昨天 ' + date.toLocaleTimeString('zh-CN', {hour:'2-digit', minute:'2-digit'});
    } else if (diffDays < 7) {
      dateStr = diffDays + '天前';
    } else {
      dateStr = date.toLocaleDateString('zh-CN');
    }
    // Build stats badges
    var badges = '';
    if (s.messageCount) badges += '<span class="session-badge">' + s.messageCount + '轮</span>';
    if (s.fileCount) badges += '<span class="session-badge file-badge">📄' + s.fileCount + '文件</span>';
    var digestHtml = s.digest
      ? '<div class="session-digest">' + escapeHtml(s.digest.slice(0, 80)) + '</div>'
      : '';
    return '<div class="session-item' + (isActive ? ' active' : '') + '" data-id="' + escapeHtml(s.id) + '">' +
      '<div class="session-item-body">' +
        '<div class="session-title-row">' +
          '<div class="session-title">' + escapeHtml(s.title || '（无标题）') + '</div>' +
          badges +
        '</div>' +
        digestHtml +
        '<div class="session-date">' + dateStr + '</div>' +
      '</div>' +
      '<button class="session-delete-btn" data-id="' + escapeHtml(s.id) + '" title="删除此对话">×</button>' +
    '</div>';
  }).join('');

  sessionsListEl.querySelectorAll('.session-item-body').forEach(function(bodyEl) {
    bodyEl.addEventListener('click', function() {
      var id = bodyEl.parentElement ? bodyEl.parentElement.getAttribute('data-id') : null;
      if (id) loadSessionById(id);
    });
  });
  sessionsListEl.querySelectorAll('.session-delete-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = btn.getAttribute('data-id');
      if (id && confirm('删除此对话记录？')) {
        vscode.postMessage({ type: 'deleteSession', id: id });
      }
    });
  });
}

function loadSessionById(id) {
  vscode.postMessage({ type: 'loadSession', id: id });
  toggleSessionsPanel(false);
}

function loadSessionMessages(history, summary, changedFiles, messageCount, createdAt) {
  if (!messagesEl) return;
  messagesEl.innerHTML = '';

  // ── Slim session banner (non-blocking, always visible) ────────────────
  var banner = document.createElement('div');
  banner.className = 'session-restore-banner';

  var dateStr = createdAt ? new Date(createdAt).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }) : '';
  var badgesHtml = '';
  if (messageCount) badgesHtml += '<span class="soc-badge">' + messageCount + ' 轮</span>';
  if (changedFiles && changedFiles.length) badgesHtml += '<span class="soc-badge file-badge">📄 ' + changedFiles.length + ' 文件</span>';

  banner.innerHTML =
    '<span class="srb-label">已激活历史对话</span>' +
    (dateStr ? ' <span class="srb-date">' + escapeHtml(dateStr) + '</span>' : '') +
    badgesHtml +
    '<span class="srb-hint">↩ 在下方输入框继续对话</span>';
  messagesEl.appendChild(banner);

  // ── Summary (collapsible, rendered as markdown) ───────────────────────
  if (summary) {
    var sumWrap = document.createElement('div');
    sumWrap.className = 'srb-summary-wrap';
    var sumToggle = document.createElement('button');
    sumToggle.className = 'srb-summary-toggle';
    sumToggle.innerHTML = '▸ 上次摘要';
    var sumBody = document.createElement('div');
    sumBody.className = 'srb-summary-body';
    sumBody.innerHTML = md(summary);
    addCodeToolbars(sumBody);
    sumBody.style.display = 'none';
    var sumOpen = false;
    sumToggle.addEventListener('click', function() {
      sumOpen = !sumOpen;
      sumBody.style.display = sumOpen ? 'block' : 'none';
      sumToggle.innerHTML = sumOpen ? '▾ 上次摘要' : '▸ 上次摘要';
    });
    sumWrap.appendChild(sumToggle);
    sumWrap.appendChild(sumBody);
    messagesEl.appendChild(sumWrap);
  }

  // ── Files chip row ────────────────────────────────────────────────────
  if (changedFiles && changedFiles.length) {
    var filesRow = document.createElement('div');
    filesRow.className = 'srb-files-row';
    filesRow.innerHTML = changedFiles.map(function(f) {
      return '<span class="soc-file-chip">' + escapeHtml(f) + '</span>';
    }).join('');
    messagesEl.appendChild(filesRow);
  }

  // ── Restored history messages (collapsible) ───────────────────────────
  if (history && history.length) {
    var histToggle = document.createElement('button');
    histToggle.className = 'srb-summary-toggle';
    histToggle.innerHTML = '▸ 对话记录 (' + history.length + '条)';
    var histWrap = document.createElement('div');
    histWrap.className = 'soc-history-wrap';
    histWrap.style.display = 'none';
    var histOpen = false;
    histToggle.addEventListener('click', function() {
      histOpen = !histOpen;
      histWrap.style.display = histOpen ? 'block' : 'none';
      histToggle.innerHTML = histOpen
        ? '▾ 对话记录 (' + history.length + '条)'
        : '▸ 对话记录 (' + history.length + '条)';
    });
    var lastUserPrompt = '';
    history.forEach(function(m) {
      if (m.role === 'user') {
        lastUserPrompt = m.content || '';
        histWrap.appendChild(createRestoredUserTurn(m.content));
      } else if (m.role === 'assistant') {
        histWrap.appendChild(createRestoredAssistantTurn(m.content, lastUserPrompt));
      }
    });
    messagesEl.appendChild(histToggle);
    messagesEl.appendChild(histWrap);
  }

  ensureWorkingAreaAttached();
  scrollToBottom(true);
}

function createRestoredUserTurn(text) {
  var turn = document.createElement('div');
  turn.className = 'turn user-turn';
  var wrap = document.createElement('div');
  wrap.className = 'user-bubble-wrap';
  var bubble = document.createElement('div');
  bubble.className = 'user-bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  turn.appendChild(wrap);
  return turn;
}

function createRestoredAssistantTurn(text, promptText) {
  var turn = document.createElement('div');
  turn.className = 'turn assistant-turn';
  var bubble = document.createElement('div');
  bubble.className = 'assistant-bubble';
  renderRestoredAssistantContent(bubble, text, promptText);
  turn.appendChild(bubble);
  return turn;
}

function addRestoredUserTurn(text) {
  var t = createRestoredUserTurn(text);
  if (messagesEl) messagesEl.appendChild(t);
}

function addRestoredAssistantTurn(text) {
  var t = createRestoredAssistantTurn(text);
  if (messagesEl) messagesEl.appendChild(t);
}

var sessionsBtnEl = document.getElementById('sessions-btn');
if (sessionsBtnEl) {
  sessionsBtnEl.addEventListener('click', function() {
    toggleSessionsPanel();
  });
}
var sessionsCloseBtnEl = document.getElementById('sessions-close-btn');
if (sessionsCloseBtnEl) {
  sessionsCloseBtnEl.addEventListener('click', function() {
    toggleSessionsPanel(false);
  });
}
var sessionsNewBtnEl = document.getElementById('sessions-new-btn');
if (sessionsNewBtnEl) {
  sessionsNewBtnEl.addEventListener('click', function() {
    toggleSessionsPanel(false);
    addDivider('── 新对话 ──');
    pendingNewSession = true;
    if (inputEl) inputEl.focus();
  });
}
// ── End Sessions Panel ────────────────────────────────────────────

// ── Event delegation for dynamically created elements ──────────────
document.addEventListener('click', function(event) {
  // G-6: Split-button arrow — toggle dropdown
  var arrowBtn = event.target.closest ? event.target.closest('.tc-allow-arrow') : null;
  if (arrowBtn) {
    var ddId = arrowBtn.getAttribute('data-dd');
    var dd = ddId ? document.getElementById(ddId) : null;
    if (dd) dd.classList.toggle('open');
    event.stopPropagation();
    return;
  }
  // Close any open dropdowns when clicking elsewhere
  if (!event.target.closest || !event.target.closest('.tc-allow-group')) {
    document.querySelectorAll('.tc-dropdown.open').forEach(function(el) { el.classList.remove('open'); });
  }
  // G-2: Terminal confirm card button clicks (Allow / Always Allow / Skip)
  var tcBtn = event.target.closest ? event.target.closest('.tc-allow-main,.tc-dd-item,.tc-skip') : null;
  if (tcBtn) {
    var confirmId = tcBtn.getAttribute('data-confirm-id');
    var allow = tcBtn.getAttribute('data-allow') === 'true';
    var alwaysAllow = tcBtn.getAttribute('data-always') === 'true';
    vscode.postMessage({ type: 'terminalConfirmReply', confirmId: confirmId, allow: allow, alwaysAllow: alwaysAllow });
    var actionsEl = tcBtn.closest('.tc-btns');
    if (actionsEl) {
      actionsEl.innerHTML = '<span class="tc-decided">' + (allow ? '✓ 已允许' : '✗ 已跳过') + '</span>';
    }
    return;
  }
  // Intent clarification / confirmation card button clicks.
  var icBtn = event.target.closest ? event.target.closest('.ic-btn') : null;
  if (icBtn) {
    var interactionId = icBtn.getAttribute('data-interaction-id') || '';
    var request = pendingIntentConfirmations.get(interactionId);
    if (!request) return;
    var action = icBtn.getAttribute('data-action') || '';
    var optionIndex = Number(icBtn.getAttribute('data-option-index') || '0');
    var option = (request.options || [])[optionIndex] || {};
    var card = icBtn.closest('.intent-card');
    var actionsEl = card ? card.querySelector('.ic-actions') : null;
    pendingIntentConfirmations.delete(interactionId);

    if (action === 'clarify') {
      if (actionsEl) actionsEl.innerHTML = '<span class="ic-decided">等待补充说明</span>';
      if (inputEl) inputEl.focus();
      return;
    }

    if (actionsEl) actionsEl.innerHTML = '<span class="ic-decided">' + escapeHtml(option.label || '已选择') + '</span>';
    var original = request.original || {};
    var originalText = original.text || original.prompt || '';
    var promptText = option.prompt || original.prompt || originalText;
    vscode.postMessage({
      type: 'chat',
      text: action === 'plan' ? ('先给计划：' + originalText) : originalText,
      prompt: promptText,
      files: original.files || [],
      images: original.images || [],
      newSession: false,
      mode: original.mode || currentMode,
      forceNoAgent: option.forceNoAgent === true ? true : original.forceNoAgent === true,
      intentConfirmed: option.intentConfirmed === true,
      suppressUserMessage: true
    });
    return;
  }
  // Collapsed code block toggle (CSP disallows inline onclick)
  var header = event.target.closest ? event.target.closest('.collapsed-code-header') : null;
  if (header) {
    var block = header.closest('.collapsed-code-block');
    if (block) {
      var uid = block.getAttribute('data-uid');
      if (uid) toggleCollapsedCode(uid);
    }
    return;
  }
});

document.getElementById('new-session-btn').addEventListener('click', function() {
  const text = inputEl.value.trim();
  if (text) {
    sendMessage(true);
  } else {
    addDivider('── 新对话 ──');
    pendingNewSession = true;
    inputEl.focus();
  }
});

function sendMessage(forceNewSession) {
  const text = inputEl.value.trim();
  if (!text && pendingFiles.length === 0) return;
  hideSuggest();
  const newSession = forceNewSession || pendingNewSession;
  pendingNewSession = false;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  var attachPaths = [];
  var textEmbed = '';
  var fileDisplay = '';
  if (pendingFiles.length > 0) {
    pendingFiles.forEach(function(f) {
      if (f.directoryPaths && f.directoryPaths.length > 0) {
        f.directoryPaths.forEach(function(p) { attachPaths.push(p); });
      } else if (f.filePath) {
        attachPaths.push(f.filePath);
      } else if (f.content) {
        textEmbed += '\n\n**\u9644\u4ef6\uff1a`' + f.label + '`**\n' + f.content;
      }
      fileDisplay += '\n\uD83D\uDCCE `' + f.label + '`';
    });
  }
  clearPendingFiles();
  closeUserEditMode();

  var userText = text || '请分析以上文件内容';
  // Normalize @problems → #problems so both forms work
  userText = userText.replace(/@problems\b/gi, '#problems');
  var displayText = fileDisplay ? (fileDisplay.trim() + '\n\n' + userText) : userText;
  var promptText = textEmbed ? (textEmbed + '\n\n---\n' + userText) : userText;

  if (userText === '/commit' || userText.startsWith('/commit ')) {
    vscode.postMessage({ type: 'runCommand', command: 'devseek.generateCommit' });
    return;
  }
  if (userText === '/test') {
    vscode.postMessage({ type: 'runCommand', command: 'devseek.runTests' });
    return;
  }
  if (userText.startsWith('/shell ')) {
    const desc = userText.slice(7).trim();
    const shellPrompt = '\u8bf7\u5c06\u4ee5\u4e0b\u9700\u6c42\u8f6c\u6362\u4e3a\u53ef\u6267\u884c\u7684 Shell \u547d\u4ee4\uff08\u53ea\u8f93\u51fa\u547d\u4ee4\u672c\u8eab\uff0c\u4e0d\u8981\u89e3\u91ca\uff09\uff1a' + desc;
    vscode.postMessage({ type: 'chat', text: '\uD83D\uDCBB /shell ' + desc, prompt: shellPrompt, newSession: newSession, mode: currentMode });
    return;
  }
  if (userText.includes('#problems')) {
    vscode.postMessage({ type: 'getProblems', text: promptText, newSession: newSession });
    return;
  }
  const atMatch = userText.match(/@([^\s]+)/);
  if (atMatch) {
    vscode.postMessage({ type: 'resolveFile', path: atMatch[1], text: promptText, newSession: newSession });
    return;
  }
  vscode.postMessage({
    type: 'chat',
    text: displayText,
    prompt: promptText,
    files: attachPaths.length > 0 ? attachPaths : undefined,
    images: pendingImages.length > 0 ? pendingImages.slice() : undefined,
    newSession: newSession,
    mode: currentMode,
    forceNoAgent: !agentEnabled,
  });
}

function sendExplicitPrompt(promptText, forceNewSession) {
  var text = (promptText || '').trim();
  if (!text) return;
  hideSuggest();
  closeUserEditMode();
  var newSession = !!forceNewSession;
  pendingNewSession = false;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  if (text === '/commit' || text.startsWith('/commit ')) {
    vscode.postMessage({ type: 'runCommand', command: 'devseek.generateCommit' });
    return;
  }
  if (text === '/test' || text === '/tests') {
    vscode.postMessage({ type: 'runCommand', command: 'devseek.runTests' });
    return;
  }
  if (text.startsWith('/shell ')) {
    var desc = text.slice(7).trim();
    var shellPrompt = '\u8bf7\u5c06\u4ee5\u4e0b\u9700\u6c42\u8f6c\u6362\u4e3a\u53ef\u6267\u884c\u7684 Shell \u547d\u4ee4\uff08\u53ea\u8f93\u51fa\u547d\u4ee4\u672c\u8eab\uff0c\u4e0d\u8981\u89e3\u91ca\uff09\uff1a' + desc;
    vscode.postMessage({ type: 'chat', text: '\uD83D\uDCBB /shell ' + desc, prompt: shellPrompt, newSession: newSession, mode: currentMode });
    return;
  }
  if (text.includes('#problems')) {
    vscode.postMessage({ type: 'getProblems', text: text, newSession: newSession });
    return;
  }
  var atMatch = text.match(/@([^\s]+)/);
  if (atMatch) {
    vscode.postMessage({ type: 'resolveFile', path: atMatch[1], text: text, newSession: newSession });
    return;
  }
  vscode.postMessage({
    type: 'chat',
    text: text,
    prompt: text,
    newSession: newSession,
    mode: currentMode,
    forceNoAgent: !agentEnabled,
  });
}

function submitAgentSteer() {
  var text = inputEl.value.trim();
  if (!text && pendingFiles.length === 0) return;
  hideSuggest();
  closeUserEditMode();
  var attachPaths = [];
  var textEmbed = '';
  var fileDisplay = '';
  if (pendingFiles.length > 0) {
    pendingFiles.forEach(function(f) {
      if (f.directoryPaths && f.directoryPaths.length > 0) {
        f.directoryPaths.forEach(function(p) { attachPaths.push(p); });
      } else if (f.filePath) {
        attachPaths.push(f.filePath);
      } else if (f.content) {
        textEmbed += '\n\n**补充附件：`' + f.label + '`**\n' + f.content;
      }
      fileDisplay += '\n📎 `' + f.label + '`';
    });
  }
  clearPendingFiles();
  pendingNewSession = false;
  inputEl.value = '';
  inputEl.style.height = 'auto';

  var displayText = fileDisplay ? (fileDisplay.trim() + '\n\n' + (text || '请参考以上补充附件继续当前任务')) : text;
  var promptText = textEmbed ? (textEmbed + '\n\n---\n' + (text || '请参考以上补充附件继续当前任务')) : (text || '请参考以上补充附件继续当前任务');
  addUserSteerBubble(displayText);
  vscode.postMessage({
    type: 'agentSteer',
    text: displayText,
    prompt: promptText,
    files: attachPaths.length > 0 ? attachPaths : undefined,
    mode: currentMode,
  });
}

// ── §8.5 Queue/Steer: queue a message while agent is running ──────────────────
function queueAgentMessage() {
  var text = inputEl.value.trim();
  if (!text && pendingFiles.length === 0) return;
  var attachPaths = pendingFiles.filter(function(f) { return f.filePath; }).map(function(f) { return f.filePath; });
  queuedAgentMsg = {
    displayText: text || '（含附件）',
    prompt: text,
    attachPaths: attachPaths,
    files: pendingFiles.slice(),
    mode: currentMode,
    newSession: pendingNewSession,
  };
  clearPendingFiles();
  pendingNewSession = false;
  inputEl.value = '';
  inputEl.style.height = 'auto';
  renderQueueIndicator();
}

function renderQueueIndicator() {
  var el = document.getElementById('agent-queue-indicator');
  if (!el) return;
  if (!queuedAgentMsg) { el.style.display = 'none'; el.innerHTML = ''; return; }
  var preview = queuedAgentMsg.displayText.slice(0, 60) + (queuedAgentMsg.displayText.length > 60 ? '…' : '');
  var _safePreview = preview.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  el.style.display = 'flex';
  el.innerHTML = '<span class="aqi-icon">📤</span>'
    + '<span class="aqi-text">已排队：' + _safePreview + '</span>'
    + '<button class="aqi-steer" title="中断当前任务，立即发送排队消息">⏩ 中断发送</button>'
    + '<button class="aqi-cancel" title="取消排队">×</button>';
  el.querySelector('.aqi-steer').addEventListener('click', function() {
    if (!queuedAgentMsg) return;
    var q = queuedAgentMsg;
    queuedAgentMsg = null;
    renderQueueIndicator();
    vscode.postMessage({ type: 'cancel' });
    stopGenerating();
    setTimeout(function() {
      pendingFiles = q.files || [];
      currentMode = q.mode || currentMode;
      pendingNewSession = q.newSession || false;
      inputEl.value = q.prompt || '';
      sendMessage();
    }, 150);
  });
  el.querySelector('.aqi-cancel').addEventListener('click', function() {
    queuedAgentMsg = null;
    renderQueueIndicator();
  });
}

function clearPendingFiles() {
  pendingFiles = [];
  pendingImages = [];
  fileBadgesEl.innerHTML = '';
}

// Vision: paste image from clipboard → preview badge + include in message
inputEl.addEventListener('paste', function(e) {
  var items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      e.preventDefault();
      var file = items[i].getAsFile();
      if (!file) continue;
      var reader = new FileReader();
      (function(f) {
        reader.onload = function(ev) {
          var dataUrl = ev.target.result;
          pendingImages.push(dataUrl);
          addImageBadge(dataUrl);
        };
        reader.readAsDataURL(f);
      })(file);
      return;
    }
  }
});

function addImageBadge(dataUrl) {
  var badge = document.createElement('span');
  badge.className = 'file-badge img-badge';
  var thumb = document.createElement('img');
  thumb.src = dataUrl;
  thumb.className = 'img-badge-thumb';
  thumb.alt = '图片';
  badge.appendChild(thumb);
  var rm = document.createElement('span');
  rm.className = 'badge-remove';
  rm.textContent = '×';
  rm.title = '移除图片';
  rm.addEventListener('click', function() {
    pendingImages = pendingImages.filter(function(u) { return u !== dataUrl; });
    badge.remove();
  });
  badge.appendChild(rm);
  fileBadgesEl.appendChild(badge);
  inputEl.focus();
}

function addFileBadge(label, filePath, content) {
  pendingFiles.push({ label: label, filePath: filePath || null, content: content || null });
  var badge = document.createElement('span');
  badge.className = 'file-badge';
  // label 显示文件名；tooltip 显示完整路径（如有）
  badge.title = filePath ? filePath : (label + ' (目录内容)');
  var icon = filePath ? '📄' : '📁';
  badge.textContent = icon + ' ' + label;

  var rm = document.createElement('span');
  rm.className = 'badge-remove';
  rm.textContent = '×';
  rm.title = '移除';
  rm.addEventListener('click', function() {
    pendingFiles = pendingFiles.filter(function(item) {
      return !(item.label === label && item.filePath === (filePath || null));
    });
    badge.remove();
  });

  badge.appendChild(rm);
  fileBadgesEl.appendChild(badge);
  inputEl.focus();
}

function renderContextFilesRow() {
  var row = document.getElementById('context-files-row');
  if (!row) return;
  row.innerHTML = '';
  if (!inheritedContextFiles.length) return;
  var lbl = document.createElement('span');
  lbl.className = 'ctx-label';
  lbl.textContent = '上下文:';
  row.appendChild(lbl);
  inheritedContextFiles.forEach(function(name) {
    var badge = document.createElement('span');
    badge.className = 'ctx-file-badge';
    badge.title = name;
    badge.textContent = name;
    var rm = document.createElement('span');
    rm.className = 'ctx-remove';
    rm.title = '清除上下文文件（避免重复分析）';
    rm.textContent = '×';
    rm.addEventListener('click', function() {
      inheritedContextFiles = [];
      renderContextFilesRow();
      vscode.postMessage({ type: 'clearContext' });
    });
    badge.appendChild(rm);
    row.appendChild(badge);
  });
}

function md(text) {
  if (typeof marked !== 'undefined') {
    // Strip redundant Chinese period (。) from the end of numbered/bulleted list
    // item lines. The list marker already has a '.', so trailing 。 is redundant.
    var processedText = text.replace(/^([ \t]*(?:\d+\.|[-*+])\s.+?)\u3002\s*$/gm, '$1');
    try { return sanitizeRenderedHtml(marked.parse(processedText)); } catch(e) {}
  }
  return escapeHtml(text);
}

function sanitizeRenderedHtml(html) {
  var template = document.createElement('template');
  template.innerHTML = String(html || '');
  var blockedTags = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'option', 'meta', 'link']);
  var allowedAttrs = new Set(['class', 'href', 'src', 'alt', 'title', 'aria-label', 'role', 'colspan', 'rowspan', 'align']);

  function safeUrl(value, isImage) {
    var raw = String(value || '').trim();
    if (!raw) return false;
    if (isImage && /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(raw)) return true;
    try {
      var url = new URL(raw, window.location.href);
      if (isImage) return ['https:', 'vscode-resource:', 'vscode-webview-resource:'].indexOf(url.protocol) >= 0;
      return ['http:', 'https:', 'mailto:'].indexOf(url.protocol) >= 0;
    } catch {
      return !/^\s*(?:javascript|data|vbscript):/i.test(raw);
    }
  }

  Array.prototype.slice.call(template.content.querySelectorAll('*')).forEach(function(el) {
    var tag = el.tagName.toLowerCase();
    if (blockedTags.has(tag)) {
      el.remove();
      return;
    }
    Array.prototype.slice.call(el.attributes).forEach(function(attr) {
      var name = attr.name.toLowerCase();
      if (name.startsWith('on') || !allowedAttrs.has(name)) {
        el.removeAttribute(attr.name);
        return;
      }
      if (name === 'href' && !safeUrl(attr.value, false)) el.removeAttribute(attr.name);
      if (name === 'src' && !safeUrl(attr.value, tag === 'img')) el.removeAttribute(attr.name);
    });
    if (tag === 'a') {
      el.setAttribute('rel', 'noreferrer noopener');
    }
  });

  return template.innerHTML;
}

function preCodeText(pre) {
  if (!pre) return '';
  var code = pre.querySelector('code');
  return ((code || pre).textContent || '').replace(/\u200b/g, '').trim();
}

function elementHasVisiblePayload(el) {
  if (!el) return false;
  var clone = el.cloneNode(true);
  clone.querySelectorAll('.cursor,.code-toolbar').forEach(function(node) { node.remove(); });
  clone.querySelectorAll('pre').forEach(function(pre) {
    if (!preCodeText(pre)) pre.remove();
  });
  if ((clone.textContent || '').replace(/\u200b/g, '').trim()) return true;
  return !!clone.querySelector('img,svg,table,ul,ol,blockquote,details,.assistant-generated-summary,.af-card,.aut-container');
}

function pruneEmptyRenderedBlocks(container) {
  if (!container) return false;
  container.querySelectorAll('pre').forEach(function(pre) {
    if (pre.closest('.mermaid-code-panel')) return;
    if (!preCodeText(pre)) pre.remove();
  });
  container.querySelectorAll('.collapsed-code-block').forEach(function(block) {
    var pre = block.querySelector('pre');
    var bodyText = pre ? preCodeText(pre) : ((block.textContent || '').replace(/\u200b/g, '').trim());
    if (!bodyText) block.remove();
  });
  container.querySelectorAll('p,li').forEach(function(el) {
    if (!el.querySelector('img,svg,table,pre,code,button,a') && !(el.textContent || '').replace(/\u200b/g, '').trim()) {
      el.remove();
    }
  });
  return elementHasVisiblePayload(container);
}

// ---- Mermaid 初始化 ----
if (typeof mermaid !== 'undefined') {
  var isDark = document.body.classList.contains('vscode-dark') ||
               document.body.classList.contains('vscode-high-contrast');
  mermaid.initialize({ startOnLoad: false, theme: isDark ? 'dark' : 'neutral', securityLevel: 'strict' });
}

// 将 assistant bubble 中的 ```mermaid 代码块替换为可切换的"渲染|代码"Tab UI
function renderMermaidBlocks(container) {
  if (typeof mermaid === 'undefined') return Promise.resolve();
  var pres = Array.prototype.slice.call(container.querySelectorAll('pre'));
  var tasks = pres.map(function(pre) {
    var code = pre.querySelector('code');
    if (!code || !(code.className || '').match(/language-mermaid/)) return Promise.resolve();
    var mermaidCode = code.textContent || '';

    // 构建 Tab UI
    var wrapper = document.createElement('div');
    wrapper.className = 'mermaid-block';

    var tabs = document.createElement('div');
    tabs.className = 'mermaid-tabs';
    var tab1 = document.createElement('button');
    tab1.className = 'mermaid-tab active';
    tab1.textContent = '渲染';
    var tab2 = document.createElement('button');
    tab2.className = 'mermaid-tab';
    tab2.textContent = '代码';
    tabs.appendChild(tab1);
    tabs.appendChild(tab2);

    var renderPanel = document.createElement('div');
    renderPanel.className = 'mermaid-render-panel';

    var codePanel = document.createElement('div');
    codePanel.className = 'mermaid-code-panel';
    codePanel.style.display = 'none';
    var codePre = document.createElement('pre');
    var codeInner = document.createElement('code');
    codeInner.textContent = mermaidCode;
    codePre.appendChild(codeInner);
    var copyBtn = document.createElement('button');
    copyBtn.className = 'mermaid-copy-btn';
    copyBtn.textContent = '复制';
    (function(btn, src) {
      btn.addEventListener('click', function() {
        navigator.clipboard.writeText(src).then(function() {
          btn.textContent = '✓';
          setTimeout(function() { btn.textContent = '复制'; }, 1500);
        });
      });
    }(copyBtn, mermaidCode));
    codePanel.appendChild(codePre);
    codePanel.appendChild(copyBtn);

    tab1.addEventListener('click', function() {
      renderPanel.style.display = ''; codePanel.style.display = 'none';
      tab1.classList.add('active'); tab2.classList.remove('active');
    });
    tab2.addEventListener('click', function() {
      renderPanel.style.display = 'none'; codePanel.style.display = '';
      tab2.classList.add('active'); tab1.classList.remove('active');
    });

    wrapper.appendChild(tabs);
    wrapper.appendChild(renderPanel);
    wrapper.appendChild(codePanel);
    pre.parentNode.replaceChild(wrapper, pre);

    var uid = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    return mermaid.render(uid, mermaidCode).then(function(result) {
      // 解析到临时容器，避免直接操作 innerHTML 后丢失 SVG 引用
      var tmp = document.createElement('div');
      tmp.innerHTML = result.svg;
      var svg = tmp.querySelector('svg');
      if (!svg) {
        renderPanel.textContent = 'Mermaid 渲染完成，但未返回可显示的 SVG。';
        return;
      }

      // mermaid v11 输出 width="100%"，真实尺寸在 viewBox
      // parseFloat("100%") === 100（非 NaN），必须直接读 viewBox
      var vb = svg.viewBox.baseVal;
      var naturalW = vb.width || 800;
      var naturalH = vb.height || 400;

      // 保留 width="100%" 和 viewBox，去掉 max-width style 与 height
      // 浏览器会按 viewBox 宽高比自动计算高度
      svg.setAttribute('width', '100%');
      svg.removeAttribute('height');
      svg.removeAttribute('style');
      svg.style.display = 'block';

      // zc 的像素宽度决定缩放级别；SVG 通过 width=100% 填满 zc
      // 平移通过 translate 实现，不使用 scale() 变换
      var zc = document.createElement('div');
      zc.style.cssText = 'line-height:0; transform-origin:0 0; flex-shrink:0;';
      zc.appendChild(svg);
      renderPanel.innerHTML = '';
      renderPanel.appendChild(zc);

      var scale = 1, tx = 0, ty = 0;
      var MIN_SCALE = 0.1, MAX_SCALE = 5;
      var userZoomed = false;
      var zoomLabel = null;

      function applyTransform() {
        var sw = Math.round(naturalW * scale);
        var sh = Math.round(naturalH * scale);
        zc.style.width = sw + 'px';
        zc.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
        renderPanel.style.height = Math.max(60, sh + Math.max(0, ty) + 4) + 'px';
        if (zoomLabel) zoomLabel.textContent = Math.round(scale * 100) + '%';
      }

      function fitToWidth() {
        var w = renderPanel.clientWidth || wrapper.clientWidth || 600;
        if (w <= 0) w = 600;
        scale = w / naturalW;
        tx = 0; ty = 0;
        applyTransform();
      }

      requestAnimationFrame(function() {
        requestAnimationFrame(fitToWidth);
      });

      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(function() {
          if (!userZoomed) requestAnimationFrame(fitToWidth);
        }).observe(wrapper);
      }

      // 滚轮缩放（以鼠标位置为中心）
      renderPanel.addEventListener('wheel', function(e) {
        e.preventDefault();
        userZoomed = true;
        var rect = renderPanel.getBoundingClientRect();
        var mx = e.clientX - rect.left;
        var my = e.clientY - rect.top;
        var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        var ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
        var r = ns / scale;
        tx = mx - r * (mx - tx);
        ty = my - r * (my - ty);
        scale = ns;
        applyTransform();
      }, { passive: false });

      // 拖拽平移
      var drag = false, dsx = 0, dsy = 0, dtx = 0, dty = 0;
      renderPanel.addEventListener('mousedown', function(e) {
        if (e.button !== 0) return;
        drag = true; dsx = e.clientX; dsy = e.clientY; dtx = tx; dty = ty;
        renderPanel.style.cursor = 'grabbing';
        e.preventDefault();
      });
      window.addEventListener('mousemove', function(e) {
        if (!drag) return;
        tx = dtx + (e.clientX - dsx);
        ty = dty + (e.clientY - dsy);
        applyTransform();
      });
      window.addEventListener('mouseup', function() {
        if (drag) { drag = false; renderPanel.style.cursor = 'grab'; }
      });

      // 缩放工具栏
      var zoomBar = document.createElement('div');
      zoomBar.className = 'mermaid-zoom-bar';
      var btnOut = document.createElement('button');
      btnOut.className = 'mermaid-zoom-btn'; btnOut.textContent = '−'; btnOut.title = '缩小';
      zoomLabel = document.createElement('span');
      zoomLabel.className = 'mermaid-zoom-label';
      var btnIn = document.createElement('button');
      btnIn.className = 'mermaid-zoom-btn'; btnIn.textContent = '+'; btnIn.title = '放大';
      var btnFit = document.createElement('button');
      btnFit.className = 'mermaid-zoom-btn'; btnFit.textContent = '⊙'; btnFit.title = '适应宽度（重置）';
      btnFit.style.marginLeft = '4px';
      btnOut.addEventListener('click', function() {
        userZoomed = true; scale = Math.max(MIN_SCALE, scale / 1.2); applyTransform();
      });
      btnIn.addEventListener('click', function() {
        userZoomed = true; scale = Math.min(MAX_SCALE, scale * 1.2); applyTransform();
      });
      btnFit.addEventListener('click', function() {
        userZoomed = false; fitToWidth();
      });
      zoomBar.appendChild(btnOut);
      zoomBar.appendChild(zoomLabel);
      zoomBar.appendChild(btnIn);
      zoomBar.appendChild(btnFit);
      wrapper.insertBefore(zoomBar, codePanel);

    }).catch(function(e) {
      renderPanel.innerHTML = '';
      var err = document.createElement('div');
      err.className = 'mermaid-render-error';
      err.textContent = 'Mermaid 渲染失败: ' + ((e && e.message) || e);
      renderPanel.appendChild(err);
      renderPanel.style.display = 'none'; codePanel.style.display = '';
      tab2.classList.add('active'); tab1.classList.remove('active');
    });
  });
  return Promise.all(tasks);
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Strip [TOOL:name {...}] blocks from text before displaying in the prose bubble.
 * Uses brace-depth counting so nested JSON (e.g. manage_todo_list arrays) is
 * fully removed rather than leaving orphaned }] fragments.
 */
function extractTaskCompleteSummary(raw) {
  // Extract "summary" value from [TOOL:task_complete {"summary":"..."}]
  var m = raw.match(/\[TOOL:task_complete\s*\{[^}]*?"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, '\t').trim();
}

function findJsonObjectEndInText(text, start) {
  var depth = 0;
  var inStr = false;
  for (var j = start; j < text.length; j++) {
    var ch = text[j];
    if (inStr) {
      if (ch === '\\') j++;
      else if (ch === '"') inStr = false;
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return j;
      }
    }
  }
  return -1;
}

var WEBVIEW_TOOL_NAMES = {
  read_file: true, grep_search: true, file_search: true, semantic_search: true, list_dir: true, get_errors: true,
  run_terminal: true, memory_write: true, get_changed_files: true, create_directory: true, fetch_webpage: true,
  vscode_listCodeUsages: true, run_vscode_command: true, create_file: true, write_file: true, replace_file: true,
  manage_todo_list: true, task_complete: true,
};

var WEBVIEW_SHELL_TRANSCRIPT_NAMES = {
  bash: true, shell: true, sh: true, zsh: true, console: true, terminal: true,
  cmd: true, powershell: true, pwsh: true,
};

function isWebviewShellTranscriptName(name) {
  return !!WEBVIEW_SHELL_TRANSCRIPT_NAMES[String(name || '').toLowerCase()];
}

function makeWebviewAnyCallingRegex() {
  return /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?([A-Za-z_]\w*)`?\]?)?/gi;
}

function webviewLineEndAfter(text, index) {
  var next = text.indexOf('\n', Math.max(0, index));
  return next < 0 ? text.length : next + 1;
}

function webviewSkipBlankLines(text, index) {
  var cursor = index;
  while (cursor < text.length) {
    var end = webviewLineEndAfter(text, cursor);
    if (text.slice(cursor, end).trim()) break;
    cursor = end;
  }
  return cursor;
}

function isWebviewShellCommandLine(line) {
  var first = String(line || '').trim().replace(/^\$\s*/, '').replace(/^>\s*/, '');
  return /^(?:cat|type|get-content|find|rg|grep|sed|head|tail|ls|dir|pwd|cd|npm|npx|pnpm|yarn|node|git|python|python3|bash|sh|zsh|cmd|powershell|pwsh|mkdir|cp|mv|rm|touch|code|g\+\+|gcc|clang|make|cmake|go|cargo|pytest|mvn|gradle|docker|curl|wget)\b/i.test(first)
    || /[|;&<>]/.test(first);
}

function webviewLooksLikeShellCommandBlock(text) {
  return String(text || '').split(/\r?\n/).some(function(line) { return isWebviewShellCommandLine(line); });
}

function findWebviewFenceEnd(text, fenceStart) {
  var firstLineEnd = webviewLineEndAfter(text, fenceStart);
  var search = firstLineEnd;
  while (search < text.length) {
    var idx = text.indexOf('```', search);
    if (idx < 0) return text.length;
    var lineStart = idx === 0 ? 0 : text.lastIndexOf('\n', idx - 1) + 1;
    if (/^[ \t]*```/.test(text.slice(lineStart, idx + 3))) {
      return webviewLineEndAfter(text, idx + 3);
    }
    search = idx + 3;
  }
  return text.length;
}

function findWebviewShellTranscriptEnd(text, callEnd) {
  var cursor = webviewSkipBlankLines(text, webviewLineEndAfter(text, callEnd));
  if (cursor >= text.length) return text.length;

  if (/^[ \t]*```/.test(text.slice(cursor, cursor + 8))) {
    var headerEnd = webviewLineEndAfter(text, cursor + 3);
    var close = text.indexOf('```', headerEnd);
    var contentEnd = close >= 0 ? close : text.length;
    if (!webviewLooksLikeShellCommandBlock(text.slice(headerEnd, contentEnd))) return callEnd;
    return close >= 0 ? webviewLineEndAfter(text, close + 3) : text.length;
  }

  var firstLineEnd = webviewLineEndAfter(text, cursor);
  var firstLine = text.slice(cursor, firstLineEnd);
  if (!isWebviewShellCommandLine(firstLine)) {
    return callEnd;
  }

  var end = firstLineEnd;
  while (end < text.length) {
    var lineEnd = webviewLineEndAfter(text, end);
    if (!text.slice(end, lineEnd).trim()) return lineEnd;
    end = lineEnd;
  }
  return text.length;
}

function stripCallingShellTranscriptBlocksFromText(text) {
  var out = '';
  var i = 0;
  var callRe = makeWebviewAnyCallingRegex();
  while (i < text.length) {
    callRe.lastIndex = i;
    var m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    var end = findWebviewShellTranscriptEnd(text, callRe.lastIndex);
    if ((m[1] && !isWebviewShellTranscriptName(m[1])) || end <= callRe.lastIndex) {
      out += text.slice(i, m.index + 1);
      i = m.index + 1;
      continue;
    }
    out += text.slice(i, m.index);
    i = end;
  }
  return out;
}

function stripCallingToolBlocksFromText(text) {
  var out = '';
  var i = 0;
  var callRe = /(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?([A-Za-z_]\w*)`?\]?/gi;
  while (i < text.length) {
    callRe.lastIndex = i;
    var m = callRe.exec(text);
    if (!m) { out += text.slice(i); break; }
    var name = m[1];
    if (!WEBVIEW_TOOL_NAMES[name] && name.indexOf('mcp__') !== 0) {
      out += text.slice(i, callRe.lastIndex);
      i = callRe.lastIndex;
      continue;
    }
    var jsonStart = text.indexOf('{', callRe.lastIndex);
    if (jsonStart < 0) { out += text.slice(i); break; }
    var jsonEnd = findJsonObjectEndInText(text, jsonStart);
    if (jsonEnd < 0) { out += text.slice(i); break; }
    out += text.slice(i, m.index);
    var next = jsonEnd + 1;
    while (next < text.length && /[ \t\r\n`]/.test(text[next])) next++;
    i = next;
  }
  return out;
}

function jsonObjectToWebviewTool(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  var rawName = typeof obj.tool === 'string' ? obj.tool : (typeof obj.name === 'string' ? obj.name : '');
  var name = rawName.trim();
  if (!name || (!WEBVIEW_TOOL_NAMES[name] && name.indexOf('mcp__') !== 0)) return null;
  return name;
}

function stripJsonToolPayloadsFromText(text) {
  if (!text) return '';
  var result = text.replace(/```(?:json|JSON)?\s*\n([\s\S]*?)```/g, function(full, inner) {
    var trimmed = String(inner || '').trim();
    if (trimmed[0] !== '{' && trimmed[0] !== '[') return full;
    try {
      var parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.some(function(item) { return jsonObjectToWebviewTool(item); }) ? '' : full;
      }
      return jsonObjectToWebviewTool(parsed) ? '' : full;
    } catch (_) {
      return /"tool"\s*:\s*"[A-Za-z_]\w*"/.test(trimmed) ? '' : full;
    }
  });

  var out = '';
  var i = 0;
  while (i < result.length) {
    var start = result.indexOf('{', i);
    if (start < 0) { out += result.slice(i); break; }
    out += result.slice(i, start);
    var end = findJsonObjectEndInText(result, start);
    if (end < 0) {
      var tail = result.slice(start);
      if (/"tool"\s*:\s*"[A-Za-z_]\w*"/.test(tail)) break;
      out += tail;
      break;
    }
    var candidate = result.slice(start, end + 1);
    var shouldStrip = false;
    try {
      var obj = JSON.parse(candidate);
      shouldStrip = !!jsonObjectToWebviewTool(obj);
    } catch (_) {
      shouldStrip = /"tool"\s*:\s*"[A-Za-z_]\w*"/.test(candidate);
    }
    if (!shouldStrip) out += candidate;
    i = end + 1;
  }
  return out;
}

// ── Collapse terminal-output blocks in a rendered container ────────────────────────
// Wraps **[终端] $ `cmd`** paragraph + following <pre> in a <details> so
// intermediate tool noise is collapsed but accessible (Claude Code style).
function collapseTerminalOutputBlocks(container) {
  var children = Array.from(container.children);
  var pairs = [];
  for (var i = 0; i < children.length; i++) {
    var el = children[i];
    if (el.tagName !== 'P' && el.tagName !== 'DIV') continue;
    var text = el.textContent || '';
    if (!/^\[终端/.test(text.trim())) continue;
    var next = el.nextElementSibling;
    pairs.push({ header: el, code: next && next.tagName === 'PRE' ? next : null });
  }
  pairs.forEach(function(pair) {
    var details = document.createElement('details');
    details.className = 'terminal-collapse';
    var summary = document.createElement('summary');
    summary.className = 'terminal-collapse-summary';
    summary.innerHTML = pair.header.innerHTML;
    details.appendChild(summary);
    pair.header.parentNode.insertBefore(details, pair.header);
    pair.header.parentNode.removeChild(pair.header);
    if (pair.code) pair.code.parentNode && pair.code.parentNode.removeChild(pair.code);
    if (pair.code) details.appendChild(pair.code);
  });
}

function stripToolCallBlocks(text) {
  var result = '';
  var i = 0;
  var len = text.length;
  var removedInternalBlock = false;
  while (i < len) {
    // Detect [TOOL:<word> { start
    if (text[i] === '[') {
      var lookahead = text.slice(i, Math.min(i + 60, len));
      var m = lookahead.match(/^\[TOOL:(\w+)\s*(?:\]?\s*)\{/);
      if (m) {
        removedInternalBlock = true;
        // Find the opening brace position
        var bracePos = text.indexOf('{', i);
        if (bracePos < 0) { result += text[i]; i++; continue; }
        // Walk the brace tree to find the matching closing brace
        var depth = 1;
        var inStr = false;
        var j = bracePos + 1;
        while (j < len && depth > 0) {
          var ch = text[j];
          if (inStr) {
            if (ch === '\\') j++;
            else if (ch === '"') inStr = false;
          } else if (ch === '"') {
            inStr = true;
          } else if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
          }
          j++;
        }
        // j now points to char after closing }
        // skip optional whitespace then the mandatory closing ]
        while (j < len && (text[j] === ' ' || text[j] === '\t')) j++;
        if (j < len && text[j] === ']') j++;
        i = j;
        continue;
      }
      if (/^\[TOOL:(\w+)\b/.test(lookahead)) {
        removedInternalBlock = true;
        break;
      }
    }
    result += text[i];
    i++;
  }
  // Also strip DeepSeek web pseudo tool calls:
  //   Calling `manage_todo_list`
  //   {"todoList":[...]}
  // These are internal tool transcripts and must never render as assistant prose.
  var beforeShellCleanup = result;
  result = stripCallingShellTranscriptBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeShellCleanup;
  var beforeCallingCleanup = result;
  result = stripCallingToolBlocksFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeCallingCleanup;
  var beforeJsonCleanup = result;
  result = stripJsonToolPayloadsFromText(result);
  removedInternalBlock = removedInternalBlock || result !== beforeJsonCleanup;
  // Also strip <tool_call>...</tool_call> blocks (DeepSeek native format)
  var beforeXmlCleanup = result;
  var noXml = result.replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '');
  removedInternalBlock = removedInternalBlock || noXml !== beforeXmlCleanup;
  var cleaned = noXml.replace(/\n{3,}/g, '\n\n').trim();
  return removedInternalBlock ? cleaned.replace(/[ \t]*\n[ \t]*\n[ \t]*/g, '\n') : cleaned;
}

function stripIncompleteCallingTail(text) {
  var raw = String(text || '');
  var m = /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?[A-Za-z_]\w*`?\]?)?\s*$/i.exec(raw);
  return m ? raw.slice(0, m.index).trimEnd() : raw;
}

function containsPotentialInternalCallingTail(text) {
  return /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*(?:\[?`?[A-Za-z_]\w*`?\]?)?\s*$/i.test(String(text || ''));
}

function sanitizeAgentVisibleDelta(text) {
  return sanitizeAgentVisibleText(text);
}

function sanitizeAgentVisibleText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  var cleaned = stripIncompleteCallingTail(stripToolCallBlocks(raw)).trim();
  if (!cleaned && (raw.indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(raw) || containsPotentialInternalCallingTail(raw))) return '';
  return cleaned;
}

function sanitizeAssistantVisibleText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  var cleaned = stripIncompleteCallingTail(stripToolCallBlocks(raw)).trim();
  if (!cleaned && (raw.indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(raw) || containsPotentialInternalCallingTail(raw))) return '';
  return cleaned;
}

function renderVisibleAssistantText(text) {
  return isAgentMode ? sanitizeAgentVisibleText(text || '') : sanitizeAssistantVisibleText(text || '');
}

function containsAgentInternalTranscript(text) {
  return /(?:^|\n)\s*\[TOOL:(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__|\w+)\b/i.test(text)
    || /(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:bash|shell|sh|zsh|console|terminal|cmd|powershell|pwsh)\b/i.test(text)
    || /(?:^|\n)\s*(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(text)
    || /(?:^|\n)\s*\[(?:工具结果|run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(text)
    || /\b(?:run_terminal|manage_todo_list|task_complete|stdout|stderr|exitCode|exit code)\b/i.test(text)
    || /(?:^|\n)\s*\$\s+\S+/.test(text)
    || /(?:^|\n)\s*(?:命令输出|执行命令|终端输出)\s*[:：]/.test(text);
}

function cleanAgentFinalProseForUser(text) {
  if (containsAgentInternalTranscript(text || '')) return '';
  var cleaned = stripAgentGeneratedCodeBlocks(stripToolCallBlocks(text || '').trim())
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_calls>[\s\S]*?<\/tool_calls>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return '';
  var lines = cleaned.split('\n').filter(function(line) {
    var s = line.trim();
    if (!s) return true;
    if (/^\[TOOL:(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__|\w+)\b/i.test(s)) return false;
    if (/^(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:bash|shell|sh|zsh|console|terminal|cmd|powershell|pwsh)\b/i.test(s)) return false;
    if (/^(?:Calling[ \t]*:?(?:[ \t]+tool)?|Call[ \t]*:|调用)[ \t]*\[?`?(?:run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|mcp__)/i.test(s)) return false;
    if (/^\[(?:工具结果|run_terminal|read_file|grep_search|file_search|semantic_search|list_dir|get_errors|get_changed_files|create_file|write_file|replace_file|manage_todo_list|task_complete|memory_write|fetch_webpage|vscode_listCodeUsages|run_vscode_command|generated_file|permission_repair)\b/i.test(s)) return false;
    if (/^\$\s+\S+/.test(s)) return false;
    if (/^(?:stdout|stderr|exitCode|exit code|命令输出|执行命令|终端输出)\s*[:：]/i.test(s)) return false;
    return true;
  });
  cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned || containsAgentInternalTranscript(cleaned)) return '';
  return cleaned.length > 800 ? cleaned.slice(0, 797).trimEnd() + '...' : cleaned;
}

function normalizeModelTodoStatus(status) {
  var s = String(status || '').trim().toLowerCase().replace(/_/g, '-');
  if (/^(completed|complete|done|finished|success|passed|已完成|完成)$/.test(s)) return 'completed';
  if (/^(in-progress|inprogress|progress|doing|active|running|started|进行中|执行中)$/.test(s)) return 'in-progress';
  if (/^(failed|failure|error|blocked|失败|错误)$/.test(s)) return 'failed';
  return 'not-started';
}

function normalizeModelTodoItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];
  var items = [];
  rawItems.forEach(function(raw, idx) {
    if (!raw || typeof raw !== 'object') return;
    var title = raw.title || raw.desc || raw.description || raw.task || raw.name || raw.content || raw.text;
    title = String(title || '').trim();
    if (!title) return;
    var idNum = Number(raw.id != null ? raw.id : (idx + 1));
    items.push({
      id: Number.isFinite(idNum) && idNum > 0 ? idNum : idx + 1,
      title: title,
      status: normalizeModelTodoStatus(raw.status || raw.state),
      action: typeof raw.action === 'string' ? raw.action : undefined,
      desc: typeof raw.desc === 'string' ? raw.desc : (typeof raw.description === 'string' ? raw.description : undefined),
    });
  });
  return items;
}

function extractTodoItemsFromParsedToolObject(obj) {
  if (!obj || typeof obj !== 'object') return [];
  if (Array.isArray(obj.todoList)) return normalizeModelTodoItems(obj.todoList);

  var name = typeof obj.tool === 'string' ? obj.tool : (typeof obj.name === 'string' ? obj.name : '');
  if (name !== 'manage_todo_list') return [];
  var payload = obj.input || obj.arguments || obj.params || obj.parameters || obj;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (_) { payload = {}; }
  }
  return payload && Array.isArray(payload.todoList) ? normalizeModelTodoItems(payload.todoList) : [];
}

function extractTodoItemsFromJsonCandidate(jsonText) {
  try {
    var parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed)) {
      var fromTools = [];
      parsed.forEach(function(item) {
        fromTools = fromTools.concat(extractTodoItemsFromParsedToolObject(item));
      });
      if (fromTools.length > 0) return fromTools;
      return normalizeModelTodoItems(parsed);
    }
    return extractTodoItemsFromParsedToolObject(parsed);
  } catch (_) {
    return [];
  }
}

function extractTodoItemsFromModelText(text) {
  if (!text || !/(manage_todo_list|todoList|待办|任务清单)/i.test(text)) return [];

  var toolRe = /\[TOOL:manage_todo_list\s*/g;
  var m;
  while ((m = toolRe.exec(text)) !== null) {
    var jsonStart = m.index + m[0].length;
    if (text[jsonStart] === ']') jsonStart++;
    while (jsonStart < text.length && /[ \t\r\n]/.test(text[jsonStart])) jsonStart++;
    if (text[jsonStart] !== '{') continue;
    var jsonEnd = findJsonObjectEndInText(text, jsonStart);
    if (jsonEnd < 0) continue;
    var toolItems = extractTodoItemsFromJsonCandidate(text.slice(jsonStart, jsonEnd + 1));
    if (toolItems.length > 0) return toolItems;
  }

  var callRe = /(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?manage_todo_list`?\]?/gi;
  while ((m = callRe.exec(text)) !== null) {
    var callJsonStart = text.indexOf('{', callRe.lastIndex);
    if (callJsonStart < 0) continue;
    var callJsonEnd = findJsonObjectEndInText(text, callJsonStart);
    if (callJsonEnd < 0) continue;
    var callItems = extractTodoItemsFromJsonCandidate(text.slice(callJsonStart, callJsonEnd + 1));
    if (callItems.length > 0) return callItems;
  }

  var xmlRe = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  while ((m = xmlRe.exec(text)) !== null) {
    var body = m[1] || '';
    if (!/manage_todo_list/.test(body)) continue;
    var xmlJsonStart = body.indexOf('{');
    if (xmlJsonStart < 0) continue;
    var xmlJsonEnd = findJsonObjectEndInText(body, xmlJsonStart);
    if (xmlJsonEnd < 0) continue;
    var xmlItems = extractTodoItemsFromJsonCandidate(body.slice(xmlJsonStart, xmlJsonEnd + 1));
    if (xmlItems.length > 0) return xmlItems;
  }

  var searchAt = 0;
  while (searchAt < text.length) {
    var start = text.indexOf('{', searchAt);
    if (start < 0) break;
    var end = findJsonObjectEndInText(text, start);
    if (end < 0) break;
    var items = extractTodoItemsFromJsonCandidate(text.slice(start, end + 1));
    if (items.length > 0) return items;
    searchAt = end + 1;
  }

  return [];
}

function maybeHandleTodoUpdateFromModelText(text) {
  if (!isAgentMode || !text) return false;
  var items = extractTodoItemsFromModelText(text);
  if (!items.length) return false;
  var signature = JSON.stringify(items.map(function(item) {
    return [item.id, item.title, item.status];
  }));
  if (signature === agentLastParsedTodoSignature) return false;
  agentLastParsedTodoSignature = signature;
  handleTodoUpdate(items);
  return true;
}

function addUserBubble(markdown, promptText, images) {
  const turn = document.createElement('div');
  turn.className = 'turn user-turn';
  markTurnEnter(turn);
  const wrap = document.createElement('div');
  wrap.className = 'user-bubble-wrap';
  const bubble = document.createElement('div');
  bubble.className = 'user-bubble';
  bubble.innerHTML = md(markdown);

  // Vision: show image thumbnail(s) above the text content
  if (images && images.length > 0) {
    var imgRow = document.createElement('div');
    imgRow.className = 'user-bubble-images';
    images.forEach(function(dataUrl) {
      var img = document.createElement('img');
      img.src = dataUrl;
      img.className = 'user-bubble-img';
      img.alt = '\u56fe\u7247';
      imgRow.appendChild(img);
    });
    bubble.insertBefore(imgRow, bubble.firstChild);
  }

  const actions = document.createElement('div');
  actions.className = 'user-msg-actions';
  const editBtn = document.createElement('button');
  editBtn.textContent = '✎ 编辑重发';
  editBtn.title = '编辑后重新发送';
  editBtn.addEventListener('click', function() {
    enterUserEditMode(turn, promptText || markdown);
  });

  actions.appendChild(editBtn);
  wrap.appendChild(bubble);
  wrap.appendChild(actions);
  turn.appendChild(wrap);
  messagesEl.appendChild(turn);
  ensureWorkingAreaAttached();
  maybeScrollToBottom();
}

function addUserSteerBubble(markdown) {
  if (!messagesEl) return;
  var turn = document.createElement('div');
  turn.className = 'turn user-turn user-steer-turn';
  markTurnEnter(turn);
  var wrap = document.createElement('div');
  wrap.className = 'user-bubble-wrap';
  var bubble = document.createElement('div');
  bubble.className = 'user-bubble user-steer-bubble';
  bubble.innerHTML = '<div class="user-steer-label">补充要求</div>' + md(markdown || '');
  wrap.appendChild(bubble);
  turn.appendChild(wrap);
  messagesEl.appendChild(turn);
  ensureWorkingAreaAttached();
  scrollToBottom(true);
}

function summarizeAgentAnnouncement(text) {
  var raw = stripToolCallBlocks(String(text || ''))
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_`>\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/AGENTS\.md|CLAUDE\.md|copilot-instructions|项目指令|Project Instruction/i.test(raw)) {
    return '项目指令上下文';
  }
  if (/memory|记忆/i.test(raw)) return '项目记忆上下文';
  if (!raw) return '过程说明';
  return raw.length > 88 ? raw.slice(0, 86) + '…' : raw;
}

function addAgentAnnouncementBubble(text) {
  if (!text || !messagesEl) { return; }
  // Remove the "analyzing" placeholder when first real announcement arrives
  var _oldAnalyzing = document.getElementById('agent-analyzing-indicator');
  if (_oldAnalyzing) _oldAnalyzing.remove();
  var container = ensureAgentProgressContainer('Preparing context');
  var rows = container ? container.querySelector('.aut-rows') : null;
  if (!rows) return;
  var details = document.createElement('details');
  details.className = 'agent-announcement-details';
  var summary = document.createElement('summary');
  summary.className = 'agent-announcement-summary';
  summary.innerHTML = '<i class="codicon codicon-info"></i><span>' + escapeHtml(summarizeAgentAnnouncement(text)) + '</span>';
  var body = document.createElement('div');
  body.className = 'agent-announcement-body';
  body.innerHTML = md(text);
  if (!pruneEmptyRenderedBlocks(body)) return;
  details.appendChild(summary);
  details.appendChild(body);
  rows.appendChild(details);
  ensureWorkingAreaAttached();
  maybeScrollToBottom();
}

function getLatestAgentWorkingTurn() {
  if (!messagesEl) return null;
  var container = (agentExecContainer && agentExecContainer.isConnected)
    ? agentExecContainer
    : null;
  if (!container) {
    var allContainers = messagesEl.querySelectorAll('.aut-container');
    container = allContainers.length ? allContainers[allContainers.length - 1] : null;
  }
  if (!container) return null;
  var workingTurn = container.closest('.turn');
  return workingTurn && workingTurn.isConnected ? workingTurn : null;
}

function placeTurnAfterLatestAgentWorking(turn) {
  if (!messagesEl || !turn) return;
  var workingTurn = getLatestAgentWorkingTurn();
  if (workingTurn && workingTurn !== turn) {
    if (workingTurn.nextSibling !== turn) {
      messagesEl.insertBefore(turn, workingTurn.nextSibling);
    }
  } else if (!turn.isConnected) {
    messagesEl.appendChild(turn);
  }
  ensureWorkingAreaAttached();
}

function ensureAgentProseBubbleVisible() {
  if (!messagesEl || !currentBubble) return;
  var turn = currentBubble.closest('.turn') || agentDeferredBubbleTurn;
  if (!turn) return;
  var analyzing = document.getElementById('agent-analyzing-indicator');
  if (analyzing) analyzing.remove();
  placeTurnAfterLatestAgentWorking(turn);
  agentDeferredBubbleTurn = null;
}

function repositionAgentProseAfterLatestWorking() {
  if (!isAgentMode || !messagesEl || !currentBubble) return;
  var turn = currentBubble.closest('.turn') || agentDeferredBubbleTurn;
  if (!turn || !turn.isConnected) return;
  placeTurnAfterLatestAgentWorking(turn);
}

function hasActiveAgentWorkingContainer() {
  return !!(messagesEl && messagesEl.querySelector('.aut-container:not([data-done])'));
}

function refreshVisibleAgentProseFromCurrentRaw() {
  if (!isAgentMode || !currentBubble || !currentRaw || !currentRaw.trim()) return;
  ensureAgentProseBubbleVisible();
  var prose = cleanAgentFinalProseForUser(currentRaw);
  if (!prose) return;
  currentBubble.innerHTML = md(augmentAgentFinalSummary(prose)) + '<span class="cursor"></span>';
  pruneEmptyRenderedBlocks(currentBubble);
  enhanceCodeVisuals(currentBubble);
  maybeScrollToBottom();
}

function addAgentFinalSummaryBubble(text) {
  if (!text || !messagesEl || agentDoneSummaryInserted) { return; }
  var cleanedText = cleanAgentFinalProseForUser(text);
  if (!cleanedText) return;
  var turn = document.createElement('div');
  turn.className = 'turn assistant-turn';
  markTurnEnter(turn);
  var bubble = document.createElement('div');
  bubble.className = 'assistant-bubble';
  bubble.innerHTML = md(augmentAgentFinalSummary(cleanedText));
  if (!pruneEmptyRenderedBlocks(bubble)) { return; }
  enhanceCodeVisuals(bubble);
  turn.appendChild(bubble);
  placeTurnAfterLatestAgentWorking(turn);
  agentDoneSummaryInserted = true;
  renderMermaidBlocks(bubble).then(function() { addCodeToolbars(bubble); maybeScrollToBottom(); });
  maybeScrollToBottom();
}

function addAgentAnalysisFeedbackBubble(text, sourceContainer) {
  if (!text || !messagesEl || !sourceContainer || sourceContainer.hasAttribute('data-analysis-feedback-emitted')) return false;
  var cleaned = stripAgentGeneratedCodeBlocks(stripToolCallBlocks(text).trim());
  if (!cleaned) return false;

  var turn = document.createElement('div');
  turn.className = 'turn assistant-turn agent-analysis-feedback-turn';
  turn.setAttribute('data-analysis-feedback-id', String(++agentAnalysisFeedbackSeq));
  markTurnEnter(turn);

  var bubble = document.createElement('div');
  bubble.className = 'assistant-bubble agent-analysis-feedback-bubble';
  bubble.innerHTML = md(cleaned);
  if (!pruneEmptyRenderedBlocks(bubble)) return false;

  enhanceCodeVisuals(bubble);
  turn.appendChild(bubble);

  var sourceTurn = sourceContainer.closest('.turn');
  if (sourceTurn && sourceTurn.parentNode === messagesEl) {
    messagesEl.insertBefore(turn, sourceTurn.nextSibling);
  } else {
    messagesEl.appendChild(turn);
  }

  sourceContainer.setAttribute('data-analysis-feedback-emitted', '1');
  renderMermaidBlocks(bubble).then(function() {
    addCodeToolbars(bubble);
    pruneEmptyRenderedBlocks(bubble);
    maybeScrollToBottom();
  });
  maybeScrollToBottom();
  return true;
}

function getAgentSummaryTodoSource() {
  if (agentTodos && agentTodos.length > 0) {
    return agentTodos.map(function(t) {
      return {
        title: t.desc || (t.file ? basename(t.file) : ''),
        desc: t.file ? basename(t.file) : '',
        status: t.state === 'failed' ? 'failed' : (t.state === 'completed' ? 'completed' : t.state || 'completed')
      };
    });
  }
  if (agentToolTodos && agentToolTodos.length > 0) {
    return agentToolTodos.map(function(t) { return Object.assign({}, t); });
  }
  return [];
}

function buildAgentValidationSummarySection() {
  if (!agentValidationSummary || !agentValidationSummary.title) return '';
  var detail = (agentValidationSummary.detail || '').trim();
  if (detail.length > 160) detail = detail.slice(0, 157) + '...';
  return (agentValidationSummary.state === 'failed' ? '验证未通过' : '验证结果')
    + '：' + agentValidationSummary.title
    + (detail ? ' - ' + detail : '');
}

function augmentAgentFinalSummary(text) {
  var base = (text || '').trim();
  var todos = getAgentSummaryTodoSource().filter(function(t) { return t && (t.title || t.desc); });
  var extras = [];
  if (todos.length && !/执行过程|完成步骤|已完成\s*\d+\s*个任务|Completed \d+ task|Completed \d+ tasks/i.test(base)) {
    var matched = 0;
    todos.forEach(function(t) {
      var label = (t.title || t.desc || '').trim();
      if (label && base.indexOf(label) !== -1) matched++;
    });
    if (matched < Math.ceil(todos.length / 2)) {
      var doneTodos = todos.filter(function(t) { return t.status !== 'failed'; });
      var failedTodos = todos.filter(function(t) { return t.status === 'failed'; });
      var lines = [failedTodos.length > 0
        ? '已完成 ' + doneTodos.length + '/' + todos.length + ' 个任务（' + failedTodos.length + ' 个失败）：'
        : '已完成 ' + todos.length + ' 个任务：'];
      lines.push('');
      todos.forEach(function(t) {
        var icon = t.status === 'failed' ? '✗' : '✓';
        var label = (t.title || t.desc || '').trim();
        var sub = t.desc && t.desc !== label ? ' - `' + t.desc + '`' : '';
        if (label) lines.push(icon + ' ' + label + sub);
      });
      extras.push(lines.join('\n'));
    }
  }
  if (agentLastEditedFiles && agentLastEditedFiles.length > 0 && base.indexOf('file changed') === -1 && base.indexOf('文件') === -1) {
    var totalAdded = 0;
    var totalRemoved = 0;
    var fileParts = agentLastEditedFiles.map(function(f) {
      totalAdded += (f.linesAdded || 0);
      totalRemoved += (f.linesRemoved || 0);
      var stat = (f.linesAdded || f.linesRemoved) ? ' (+' + (f.linesAdded || 0) + ' -' + (f.linesRemoved || 0) + ')' : '';
      return '`' + (f.path || f.basename) + '`' + stat;
    });
    var lineStat = (totalAdded || totalRemoved) ? '，共 +' + totalAdded + ' -' + totalRemoved + ' 行' : '';
    extras.push('修改了 ' + agentLastEditedFiles.length + ' 个文件' + lineStat + '：' + fileParts.join('、'));
  }
  if (agentValidationSummary && agentValidationSummary.title && !/(编译|运行|验证|validate|compile|run)/i.test(base)) {
    extras.push(buildAgentValidationSummarySection());
  }
  if (!extras.length) return base;
  return (base ? base + '\n\n' : '') + extras.filter(Boolean).join('\n\n');
}

function makeAgentWidgetItemsFromTodos() {
  return agentTodos.map(function(t) {
    var status = t.state === 'completed' ? 'completed'
      : t.state === 'failed' ? 'failed'
      : t.state === 'started' ? 'in-progress'
      : 'not-started';
    return {
      __agentState: true,
      title: t.desc || basename(t.file || ''),
      action: t.action || 'modify',
      desc: basename(t.file || ''),
      status: status,
    };
  });
}

function syncAgentTodosWidget() {
  if (agentTodos && agentTodos.length > 0) {
    handleTodoUpdate(makeAgentWidgetItemsFromTodos());
  }
}

function addAssistantBubble() {
  const turn = document.createElement('div');
  turn.className = 'turn assistant-turn';
  markTurnEnter(turn);
  const bubble = document.createElement('div');
  bubble.className = 'assistant-bubble';
  bubble.innerHTML = '<span class="thinking-dots"><span></span><span></span><span></span></span><span class="cursor"></span>';
  turn.appendChild(bubble);
  messagesEl.appendChild(turn);
  ensureWorkingAreaAttached();
  maybeScrollToBottom();
  return bubble;
}

function enterUserEditMode(turn, originalText) {
  closeUserEditMode();
  editingUserTurn = turn;
  const wrap = turn.querySelector('.user-bubble-wrap');
  if (!wrap) return;
  const bubble = wrap.querySelector('.user-bubble');
  const actions = wrap.querySelector('.user-msg-actions');
  if (!bubble || !actions) return;

  bubble.style.display = 'none';
  actions.style.display = 'none';

  const edit = document.createElement('div');
  edit.className = 'user-edit-wrap';
  edit.innerHTML = '<textarea></textarea><div class="user-edit-actions"><button class="cancel">取消</button><button class="primary resend">↻ 重新发送</button></div>';
  const ta = edit.querySelector('textarea');
  const cancelBtn = edit.querySelector('button.cancel');
  const resendBtn = edit.querySelector('button.resend');
  ta.value = originalText || '';
  wrap.appendChild(edit);
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);

  cancelBtn.addEventListener('click', function() {
    closeUserEditMode();
  });
  resendBtn.addEventListener('click', function() {
    const text = ta.value.trim();
    closeUserEditMode();
    if (!text) return;
    sendExplicitPrompt(text, false);
  });
}

function closeUserEditMode() {
  if (!editingUserTurn) return;
  const wrap = editingUserTurn.querySelector('.user-bubble-wrap');
  if (wrap) {
    const edit = wrap.querySelector('.user-edit-wrap');
    const bubble = wrap.querySelector('.user-bubble');
    const actions = wrap.querySelector('.user-msg-actions');
    if (edit) edit.remove();
    if (bubble) bubble.style.display = '';
    if (actions) actions.style.display = '';
  }
  editingUserTurn = null;
}

function isNearBottom() {
  var threshold = 28;
  return messagesEl.scrollTop + messagesEl.clientHeight >= messagesEl.scrollHeight - threshold;
}

function showJumpLatest() {
  if (jumpLatestEl) jumpLatestEl.classList.add('show');
}

function hideJumpLatest() {
  if (jumpLatestEl) jumpLatestEl.classList.remove('show');
}

function scrollToBottom(force) {
  if (force || userPinnedToBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
    hideJumpLatest();
    if (scrollStickTimer) clearTimeout(scrollStickTimer);
    var remaining = 4;
    var stick = function() {
      if (!messagesEl || (!force && !userPinnedToBottom)) return;
      messagesEl.scrollTop = messagesEl.scrollHeight;
      hideJumpLatest();
      remaining -= 1;
      if (remaining > 0) {
        scrollStickTimer = setTimeout(function() {
          requestAnimationFrame(stick);
        }, 40);
      } else {
        scrollStickTimer = null;
      }
    };
    requestAnimationFrame(stick);
  } else {
    showJumpLatest();
  }
}

function maybeScrollToBottom() {
  scrollToBottom(false);
}

function markTurnEnter(turn) {
  turn.classList.add('enter');
  setTimeout(function() { turn.classList.remove('enter'); }, 260);
}

function addError(text) {
  const div = document.createElement('div');
  div.className = 'error-msg';
  div.textContent = '\u26a0\ufe0f ' + text;
  messagesEl.appendChild(div);
  ensureWorkingAreaAttached();
  maybeScrollToBottom();
}

function addLoginError(text) {
  const div = document.createElement('div');
  div.className = 'error-msg';
  const msg = document.createElement('div');
  msg.textContent = '\uD83D\uDD11 ' + text;
  const btn = document.createElement('button');
  btn.textContent = '\u91cd\u65b0\u767b\u5f55';
  btn.style.cssText = 'margin-top:6px;padding:3px 12px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:4px;cursor:pointer;font-size:12px;';
  btn.addEventListener('click', function() {
    btn.disabled = true;
    btn.textContent = '\u5df2\u6253\u5f00\u6d4f\u89c8\u5668...';
    vscode.postMessage({ type: 'relogin' });
  });
  div.appendChild(msg);
  div.appendChild(btn);
  messagesEl.appendChild(div);
  ensureWorkingAreaAttached();
  maybeScrollToBottom();
}

function addDivider(label) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'text-align:center;font-size:10px;opacity:.35;margin:4px 0';
  wrap.textContent = label;
  messagesEl.appendChild(wrap);
  ensureWorkingAreaAttached();
}

function addCodeToolbars(container) {
  container.querySelectorAll('pre').forEach(function(pre) {
    if (pre.closest('.mermaid-code-panel')) return;
    if (!preCodeText(pre)) { pre.remove(); return; }
    if (pre.querySelector('.code-toolbar')) return;
    const lang = detectCodeLanguage(pre);
    if (lang === 'text') return; // Skip plain text blocks — no language label or insert button needed
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    const langLabel = document.createElement('span');
    langLabel.className = 'code-lang';
    langLabel.textContent = lang;

    const actions = document.createElement('div');
    actions.className = 'code-actions';
    const insertBtn = document.createElement('button');
    insertBtn.className = 'insert-btn';
    insertBtn.textContent = '\u63d2\u5165';
    insertBtn.title = '\u63d2\u5165\u5230\u7f16\u8f91\u5668\u5149\u6807\u4f4d\u7f6e';
    insertBtn.addEventListener('click', function() {
      const code = (pre.querySelector('code') || pre).textContent;
      vscode.postMessage({ type: 'insertCode', code: code });
      insertBtn.textContent = '\u2713 \u5df2\u63d2\u5165';
      setTimeout(function() { insertBtn.textContent = '\u63d2\u5165'; }, 1500);
    });
    const copyBtn = document.createElement('button');
    copyBtn.textContent = '\u590d\u5236';
    copyBtn.title = '\u590d\u5236\u5230\u526a\u8d34\u677f';
    copyBtn.addEventListener('click', function() {
      const code = (pre.querySelector('code') || pre).textContent;
      navigator.clipboard.writeText(code).then(function() {
        copyBtn.textContent = '\u2713';
        setTimeout(function() { copyBtn.textContent = '\u590d\u5236'; }, 1500);
      });
    });
    actions.appendChild(insertBtn);
    actions.appendChild(copyBtn);
    // Add "在终端中运行" button for shell code blocks
    var shellLangs = ['bash', 'sh', 'shell', 'zsh', 'fish', 'powershell', 'cmd', 'bat'];
    if (shellLangs.indexOf(lang) >= 0) {
      var runBtn = document.createElement('button');
      runBtn.className = 'run-in-terminal-btn';
      runBtn.title = '在 VS Code 终端中运行';
      runBtn.innerHTML = '<i class="codicon codicon-terminal"></i> 运行';
      runBtn.addEventListener('click', function() {
        var code = ((pre.querySelector('code') || pre).textContent || '').trim();
        if (!code) return;
        vscode.postMessage({ type: 'runInVsTerminal', text: code, path: '' });
        runBtn.innerHTML = '<i class="codicon codicon-check"></i> 已发送';
        setTimeout(function() { runBtn.innerHTML = '<i class="codicon codicon-terminal"></i> 运行'; }, 2000);
      });
      actions.appendChild(runBtn);
    }
    toolbar.appendChild(langLabel);
    toolbar.appendChild(actions);
    pre.insertBefore(toolbar, pre.firstChild);

    // Auto-collapse code blocks longer than 20 lines (skip if already inside a collapsed body)
    if (!pre.closest('.collapsed-code-body')) {
      var rawCode = (pre.querySelector('code') || pre).textContent || '';
      var lineCount = rawCode.split('\n').length;
      if (lineCount > 20) {
        var uid = 'ccb-' + Math.random().toString(36).slice(2, 10);
        var wrapDiv = document.createElement('div');
        wrapDiv.className = 'collapsed-code-block';
        wrapDiv.setAttribute('data-uid', uid);
        var hdrDiv = document.createElement('div');
        hdrDiv.className = 'collapsed-code-header';
        hdrDiv.innerHTML = '<span class="collapsed-code-icon">\u203a</span>'
          + ' <span class="collapsed-code-label">' + escapeHtml(lang) + '</span>'
          + ' <span class="collapsed-code-linecount">\u00b7 ' + lineCount + ' \u884c</span>'
          + ' <span class="collapsed-code-hint">\u70b9\u51fb\u5c55\u5f00</span>';
        var bodyDiv = document.createElement('div');
        bodyDiv.className = 'collapsed-code-body';
        bodyDiv.id = uid;
        bodyDiv.style.display = 'none';
        pre.parentNode.insertBefore(wrapDiv, pre);
        wrapDiv.appendChild(hdrDiv);
        bodyDiv.appendChild(pre);
        wrapDiv.appendChild(bodyDiv);
      }
    }
  });
}

function detectCodeLanguage(pre) {
  var code = pre.querySelector('code');
  var cls = (code && code.className) || '';
  var m = cls.match(/language-([a-z0-9_+-]+)/i);
  if (!m) return 'text';
  return m[1].toLowerCase();
}

function enhanceCodeVisuals(container) {
  container.querySelectorAll('pre code').forEach(function(codeEl) {
    if (!((codeEl.textContent || '').replace(/\u200b/g, '').trim())) {
      var pre = codeEl.closest('pre');
      if (pre) pre.remove();
      return;
    }
    if (codeEl.getAttribute('data-ds-highlighted') === '1') return;
    if (codeEl.className.indexOf('language-mermaid') >= 0) return;

    var raw = codeEl.textContent || '';
    var lang = 'text';
    var m = (codeEl.className || '').match(/language-([a-z0-9_+-]+)/i);
    if (m) lang = m[1].toLowerCase();

    codeEl.innerHTML = highlightSource(raw, lang);
    codeEl.setAttribute('data-ds-highlighted', '1');
  });
}

function highlightSource(source, lang) {
  var html = escapeHtml(source);
  var bag = [];

  function protect(re, cls) {
    html = html.replace(re, function(m) {
      var key = '___DSHL_' + bag.length + '___';
      bag.push('<span class="' + cls + '">' + m + '</span>');
      return key;
    });
  }

  // Protect comments and strings first so later keyword passes don't break them.
  protect(/\/\*[\s\S]*?\*\//g, 'tok-comment');
  protect(/\/\/[^\n]*/g, 'tok-comment');
  protect(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, 'tok-string');

  if (/^(c|cc|cpp|cxx|h|hpp|java|js|jsx|ts|tsx|go|rust|rs)$/i.test(lang)) {
    html = html.replace(/(^|\n)(\s*#\s*[A-Za-z_][A-Za-z0-9_]*)/g, '$1<span class="tok-preproc">$2</span>');
    html = html.replace(/\b(class|struct|public|private|protected|virtual|override|const|static|return|if|else|for|while|switch|case|break|continue|namespace|using|include|new|delete|try|catch|throw|template|typename|this|auto|void|int|double|float|bool|char|string|std|true|false|nullptr)\b/g, '<span class="tok-keyword">$1</span>');
    html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
    html = html.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?=\()/g, '<span class="tok-fn">$1</span>');
    html = html.replace(/\b(std::string|string|vector|map|set|unordered_map)\b/g, '<span class="tok-type">$1</span>');
  } else if (/^(py|python)$/i.test(lang)) {
    html = html.replace(/\b(def|class|return|if|elif|else|for|while|try|except|finally|import|from|as|lambda|with|pass|break|continue|True|False|None)\b/g, '<span class="tok-keyword">$1</span>');
    html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
    html = html.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?=\()/g, '<span class="tok-fn">$1</span>');
  }

  html = html.replace(/___DSHL_(\d+)___/g, function(_, i) {
    return bag[Number(i)] || '';
  });
  return html;
}

function addWorkflowStatus(msg) {
  // Agent mode has its own authoritative Working surface. Keep workflow entries
  // only for completion snapshots so local validation/repair statuses do not
  // create a second live spinner under the agent task list.
  var renderLiveWorkflow = !isAgentMode;
  updateWorkingEntryFromWorkflow(msg, { render: renderLiveWorkflow });
  if (!renderLiveWorkflow) return;
  if (!shouldRenderWorkflowStatus(msg)) return;

  var key = workflowStatusKey(msg);
  var existingCard = workflowStateCards.get(key);
  if (existingCard && existingCard.isConnected) {
    renderWorkflowCard(existingCard, msg);
    maybeScrollToBottom();
    return;
  }

  var wrap = document.createElement('div');
  wrap.className = 'turn assistant-turn';
  markTurnEnter(wrap);

  var card = document.createElement('div');
  card.className = 'workflow-card state-' + (msg.state || 'completed');
  renderWorkflowCard(card, msg);

  wrap.appendChild(card);
  messagesEl.appendChild(wrap);
  workflowStateCards.set(key, card);
  maybeScrollToBottom();
}

// ── Agent-mode status cards ────────────────────────────────────────────────

/** Map from agent task key → DOM row element */
var agentTaskCards = new Map();
/** The plan card DOM element */
var agentPlanCard = null;
/** Single container card for all execute-phase task rows */
var agentExecContainer = null;
/** True while an agent-mode response is in progress — suppresses legacy file-detection UI */
var isAgentMode = false;
/** True once plan:completed fires — gate for allowing deltas into currentRaw */
var agentPlanDone = false;
/** Planned tasks for Todos panel: [{action, file, desc, state}] */
var agentTodos = [];
/** Stable task list from manage_todo_list; some models send partial updates. */
var agentToolTodos = [];
/** Raw model text buffer used to surface DeepSeek manage_todo_list as soon as it is parsed. */
var agentTodoParseBuffer = '';
/** De-dupe signature for todo lists parsed directly from model text. */
var agentLastParsedTodoSignature = '';
/** DOM element for the live Todos panel */
var agentTodosEl = null;
/** Shimmer/rolling-label timer while agent is working */
var agentShimmerTimer = null;
/** In agent mode, the prose bubble's turn div — held off-DOM until thinking box is placed */
var agentDeferredBubbleTurn = null;
/**
 * Copilot-aligned spinner word pools (3 categories, sampled without replacement).
 * eXo (thinking): LLM reasoning / initial state
 * tXo (terminal): terminal tool invocations
 * iXo (tool):     all other tool calls (read/search/list/etc.)
 */
var SPINNER_THINKING = ['Thinking', 'Reasoning', 'Considering', 'Analyzing', 'Evaluating'];
var SPINNER_TERMINAL = ['Executing', 'Running', 'Processing'];
var SPINNER_TOOL     = ['Processing', 'Preparing', 'Loading', 'Analyzing', 'Evaluating'];
var _spinnerPools = null; // reset per startWorkingShimmer call

function _initSpinnerPools() {
  _spinnerPools = {
    thinking: SPINNER_THINKING.slice(),
    terminal: SPINNER_TERMINAL.slice(),
    tool:     SPINNER_TOOL.slice()
  };
}

function getSpinnerWord(category) {
  if (!_spinnerPools) _initSpinnerPools();
  var key = (category === 'terminal') ? 'terminal' : (category === 'thinking') ? 'thinking' : 'tool';
  var pool = _spinnerPools[key];
  if (!pool || pool.length === 0) {
    _spinnerPools[key] = (key === 'thinking' ? SPINNER_THINKING : key === 'terminal' ? SPINNER_TERMINAL : SPINNER_TOOL).slice();
    pool = _spinnerPools[key];
  }
  var idx = Math.floor(Math.random() * pool.length);
  return pool.splice(idx, 1)[0];
}
/** G-tool: activity chip state */
var agentActivityRowId = null;
var agentActivityCounts = { read: 0, search: 0, list: 0, terminal: 0, write: 0, web: 0, memory: 0, todo: 0, prose: 0 };/** Tracks which taskIndex owns the current agentExecContainer (-1 = plan container) */
var agentActivitySeen = new Set();
var agentCurrentTaskIndex = -1;
/** Short label for the current task (file + brief desc), shown in finalized header */
var agentCurrentTaskLabel = '';
/** Per-file streaming analysis card state (filled by \x00AFILE: prefixed deltas) */
var analyzeCards = new Map();          // basename -> { el, body, raw }
var analyzeSummaryCardObj = null;      // { el, body, raw } for summary
var analyzeContainerEl = null;         // wraps all per-file analyze cards

/** Reference to the last finalized exec container — used to inject analysis text after endResponse */
var agentLastFinalizedContainer = null;
/** Latest compile/run validation result, used to enrich final prose. */
var agentValidationSummary = null;

function startWorkingShimmer(container) {
  stopWorkingShimmer();
  _initSpinnerPools();  // fresh pools for this Working box
  // P-O: add ● Status spinner row at bottom of aut-details (Copilot chat-thinking-spinner-item)
  // Initial label uses 'thinking' pool (Copilot: initContent → getRandomWorkingMessage('thinking'))
  if (container && container.isConnected) {
    var _autDetsForSpin = container.querySelector('.aut-details');
    if (_autDetsForSpin && !_autDetsForSpin.querySelector('.aut-spinner-row')) {
      var _spinRow = document.createElement('div');
      _spinRow.className = 'aut-spinner-row';
      _spinRow.innerHTML = '<i class="codicon codicon-circle-filled aut-spinner-dot"></i>'
        + '<span class="aut-spinner-label">' + getSpinnerWord('thinking') + '</span>';
      _autDetsForSpin.appendChild(_spinRow);
    }
  }
  // Heartbeat: quietly rotate thinking words during quiet periods (no tool events).
  // Copilot is fully event-driven; this fallback handles initial LLM planning silence.
  agentShimmerTimer = setInterval(function() {
    if (!container || !container.isConnected) { stopWorkingShimmer(); return; }
    var dets = container.querySelector('.aut-details');
    if (dets && dets.hasAttribute('data-done')) { stopWorkingShimmer(); return; }
    var spinLbl = dets ? dets.querySelector('.aut-spinner-label') : null;
    if (spinLbl) spinLbl.textContent = getSpinnerWord('thinking');
  }, 4000);
}

function stopWorkingShimmer() {
  if (agentShimmerTimer) { clearInterval(agentShimmerTimer); agentShimmerTimer = null; }
}

function agentActionBadgeClass(action) {
  if (action === 'create') return 'agent-badge-create';
  if (action === 'analyze') return 'agent-badge-analyze';
  if (action === 'explain') return 'agent-badge-analyze';
  if (action === 'delete') return 'agent-badge-delete';
  return 'agent-badge-modify';
}

function agentActionBadgeLabel(action) {
  if (action === 'analyze') return '分析';
  if (action === 'explain') return '解释';
  if (action === 'create') return '新建';
  if (action === 'delete') return '删除';
  return '修改';
}

function renderTodosContent() {
  // Unified list rows update in-place via agentTaskCards; just sync the header count.
  if (!agentExecContainer || !agentExecContainer.isConnected) return;
  var completed = agentTodos.filter(function(t) { return t.state === 'completed' || t.state === 'failed'; }).length;
  var countEl = agentExecContainer.querySelector('.aut-count');
  if (countEl) countEl.textContent = completed + '/' + agentTodos.length;
}

function normalizeTodoKey(item) {
  var text = String((item && (item.title || item.desc)) || '').trim().toLowerCase();
  return text
    .replace(/[\s`"'“”‘’。，,、；;：:（）()\[\]【】]+/g, '')
    .replace(/(并且|以及|然后|同时|并)/g, '')
    .replace(/(周末心情|动画效果|程序|代码文件|源码文件|文件)/g, '')
    .replace(/(创建|新建|生成|编写|实现|更新|验证|检查|测试|运行|编译)/g, function(m) { return m; });
}

function normalizeTodoCategory(item) {
  var text = String((item && (item.title || item.desc)) || '').toLowerCase();
  if (/(编译|gcc|g\+\+|compile|build)/i.test(text)) return 'compile';
  if (/(运行|执行|run|效果|输出)/i.test(text)) return 'run';
  if (/(测试|验证|检查|verify|test)/i.test(text)) return 'verify';
  if (/(创建|新建|生成|编写|实现|代码|源码|程序|文件|create|write|implement)/i.test(text)) return 'code';
  return normalizeTodoKey(item);
}

function dedupeTodoItems(items) {
  var seen = new Map();
  var result = [];
  items.forEach(function(raw) {
    if (!raw || !raw.title) return;
    var item = Object.assign({}, raw);
    var key = item.id != null ? ('id:' + item.id) : normalizeTodoKey(item);
    var matchIndex = -1;
    for (var i = 0; i < result.length; i++) {
      var existing = result[i];
      var existingKey = existing.id != null ? ('id:' + existing.id) : normalizeTodoKey(existing);
      if (existingKey === key) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex >= 0) {
      var prev = result[matchIndex];
      var rank = { 'failed': 5, 'completed': 4, 'in-progress': 3, 'not-started': 1 };
      var keepStatus = (rank[item.status] || 0) >= (rank[prev.status] || 0) ? item.status : prev.status;
      result[matchIndex] = Object.assign({}, prev, item, {
        title: item.title || prev.title,
        desc: item.desc || prev.desc,
        status: keepStatus || item.status || prev.status,
      });
      return;
    }
    if (!seen.has(key)) {
      seen.set(key, true);
      result.push(item);
    }
  });
  return result.map(function(item, idx) { return Object.assign({}, item, { id: idx + 1 }); });
}

function looksLikeFullTodoSnapshot(items) {
  if (!agentToolTodos.length) return true;
  if (items.length >= agentToolTodos.length) return true;
  var withIds = items.filter(function(it) { return it && it.id != null; });
  return withIds.length > 1 && withIds.every(function(it, idx) { return Number(it.id) === idx + 1; });
}

function stripAgentGeneratedCodeBlocks(text) {
  if (!text) return '';
  var removed = false;
  var cleaned = text.replace(/```[A-Za-z0-9_+-]*\s*\n[\s\S]*?```/g, function(block) {
    if (/#include\s*<|\bint\s+main\s*\(|\bfunction\s+|\bclass\s+|^\s*(?:const|let|var)\s+/m.test(block)) {
      removed = true;
      return '\n\n（代码已写入文件，详情请查看文件变更。）\n\n';
    }
    return block;
  });
  if (!removed) return text;
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * L-2: Handle manage_todo_list tool call from AI.
 * Updates the persistent Todos widget above the input area.
 * Also syncs agentTodos for per-task Working box logic.
 * @param {Array<{id:number,title:string,status:string,action?:string,desc?:string}>} items
 */
function handleTodoUpdate(items) {
  if (!items || !items.length) {
    agentToolTodos = [];
    if (todosWidgetEl) {
      todosWidgetEl.style.display = 'none';
      todosWidgetEl.innerHTML = '';
    }
    return;
  }
  var authoritativeAgentState = items.some(function(it) { return it && it.__agentState === true; });

  // NOTE: do NOT overwrite agentTodos here.
  // agentTodos is exclusively managed by plan/execute phase (action types like
  // 'create'/'analyze' are critical for isAnalysisSubTask detection).
  // manage_todo_list is the AI's internal task-tracking tool — different purpose.

  // ── Update / create persistent Todos widget above input ──────────────────
  var incomingItems = dedupeTodoItems(items.slice());
  // Keep a stable full todo list. DeepSeek sometimes sends only the latest item in
  // later manage_todo_list calls; Copilot's widget preserves the whole task list.
  if (!authoritativeAgentState && agentToolTodos.length > 0) {
    var incomingLooksFullSnapshot = looksLikeFullTodoSnapshot(incomingItems);
    var mergedTodos = incomingLooksFullSnapshot
      ? []
      : agentToolTodos.map(function(prev) { return Object.assign({}, prev); });
    incomingItems.forEach(function(next, idx) {
      var pos = -1;
      if (next && next.id != null) {
        pos = mergedTodos.findIndex(function(prev) { return prev.id === next.id; });
      }
      if (!incomingLooksFullSnapshot && pos < 0 && next && next.title) {
        var nextKey = normalizeTodoKey(next);
        var nextCat = normalizeTodoCategory(next);
        pos = mergedTodos.findIndex(function(prev) {
          return normalizeTodoKey(prev) === nextKey || normalizeTodoCategory(prev) === nextCat;
        });
      }
      if (!incomingLooksFullSnapshot && pos < 0 && idx < mergedTodos.length) pos = idx;
      if (pos >= 0) {
        var prevTodo = mergedTodos[pos];
        var rank = { 'failed': 5, 'completed': 4, 'in-progress': 3, 'not-started': 1 };
        var mergedStatus = (rank[next.status] || 0) >= (rank[prevTodo.status] || 0) ? next.status : prevTodo.status;
        mergedTodos[pos] = Object.assign({}, prevTodo, next, {
          title: next.title || prevTodo.title,
          desc: next.desc || prevTodo.desc,
          fullDesc: next.fullDesc || prevTodo.fullDesc,
          status: mergedStatus || next.status || prevTodo.status
        });
      }
      else mergedTodos.push(next);
    });
    items = dedupeTodoItems(mergedTodos);
  } else {
    items = dedupeTodoItems(incomingItems);
  }
  agentToolTodos = items.map(function(it) { return Object.assign({}, it); });

  var doneCount = items.filter(function(it) { return it.status === 'completed'; }).length;
  var inProgCount = items.filter(function(it) { return it.status === 'in-progress'; }).length;
  var header = doneCount > 0 || inProgCount > 0
    ? 'Todos (' + doneCount + '/' + items.length + ')'
    : 'Todos';

  // Build inner HTML — Copilot style: filename is primary, action icon secondary
  var listHtml = items.map(function(it) {
    var stateClass = it.status === 'completed' ? 'state-completed'
      : it.status === 'in-progress' ? 'state-started'
      : it.status === 'failed' ? 'state-failed'
      : 'state-pending';
    // State icon (left)
    var stateIcon = it.status === 'completed'
      ? '<i class="codicon codicon-pass"></i>'
      : it.status === 'in-progress'
      ? '<i class="codicon codicon-record"></i>'
      : it.status === 'failed'
      ? '<i class="codicon codicon-error"></i>'
      : '<i class="codicon codicon-circle-outline"></i>';
    // File-action icon (Copilot style: ○ for new, pencil for edit, trash for delete, eye for analyze)
    var action = it.action || '';
    var actionIcon = action === 'create'  ? 'codicon-add'
      : action === 'delete'              ? 'codicon-trash'
      : (action === 'analyze' || action === 'explain') ? 'codicon-eye'
      : 'codicon-edit';
    // Primary display: filename (from title), secondary: short desc
    var primaryText = it.title || '';
    var secondaryText = it.desc || '';
    // If desc is not provided but title has action prefix like "[create] foo.cpp", extract file
    if (!it.action && !it.desc) {
      var bracketM = primaryText.match(/^\[(\w+)\]\s+(.+)$/);
      if (bracketM) { action = bracketM[1]; primaryText = bracketM[2]; }
    }
    // Truncate secondary desc for display
    var shortDesc = secondaryText && secondaryText.length > 48 ? secondaryText.slice(0, 46) + '…' : secondaryText;
    var tooltip = escapeHtml(it.fullDesc || secondaryText || primaryText);
    return '<div class="agent-todo-item ' + stateClass + '" title="' + tooltip + '">'
      + '<span class="agent-todo-icon">' + stateIcon + '</span>'
      + (action ? '<i class="codicon ' + actionIcon + ' agent-todo-action-icon"></i>' : '')
      + '<span class="agent-todo-body">'
      + '<span class="agent-todo-fname">' + escapeHtml(primaryText) + '</span>'
      + (shortDesc ? '<span class="agent-todo-subdesc">' + escapeHtml(shortDesc) + '</span>' : '')
      + '</span>'
      + '</div>';
  }).join('');
  todosWidgetEl.innerHTML = '<details class="agent-todos-details" open>'
    + '<summary class="agent-todos-summary">'
    + '<span class="agent-todos-title">' + header + '</span>'
    + '<button class="agent-todos-close" title="关闭">\u00d7</button>'
    + '</summary>'
    + '<div class="agent-todos-list">' + listHtml + '</div>'
    + '</details>';
  todosWidgetEl.style.display = '';

  // Sync the Working-area header only while a todo is actively in progress.
  // Do NOT switch the active Working box to "已完成 N/N" from todo updates alone:
  // Copilot keeps completion/title finalization in the thinking-box lifecycle
  // (phase:done). Todo updates are an input-area widget, not the owner of the
  // response-flow order. This avoids showing "completed 5/5" before final prose.
  var inProgItem = items.find(function(it) { return it.status === 'in-progress'; });
  var labelItem = inProgItem;
  if (labelItem && labelItem.title) {
    var nextLabel = labelItem.title;
    var truncated = nextLabel.length > 40 ? nextLabel.slice(0, 38) + '…' : nextLabel;
    // 1) Update agentCurrentTaskLabel for future container creations. Do not update
    // the separate global Working area in Agent mode; the aut-container is the single
    // source of visible progress, matching Copilot/Claude Code.
    agentCurrentTaskLabel = truncated;
    // 2) Update aut-label in ALL active (non-done) aut-containers via direct DOM query.
    //    This is more reliable than the agentExecContainer reference, which may be
    //    null or stale if todoUpdate arrives before agentStatus creates the container.
    var activeContainers = document.querySelectorAll('.aut-container:not([data-done])');
    for (var ci = 0; ci < activeContainers.length; ci++) {
      var autLblEl = activeContainers[ci].querySelector('.aut-label');
      if (autLblEl) autLblEl.textContent = truncated;
    }
    // Also update agentExecContainer directly as a second safety path
    if (agentExecContainer && agentExecContainer.isConnected) {
      var autLblEl2 = agentExecContainer.querySelector('.aut-label');
      if (autLblEl2) autLblEl2.textContent = truncated;
    }
  }

  // Close button hides widget
  var closeBtn = todosWidgetEl.querySelector('.agent-todos-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      todosWidgetEl.style.display = 'none';
    });
  }

  scrollAgentProgressToBottom();
}

/**
 * Render the persistent File Changes widget above the input area.
 * Shows a compact list of files edited by the agent session.
 * Lifecycle: appears when agent done with edits, cleared when user sends new message.
 */
function renderFileChangesWidget(editedFiles) {
  if (!fileChangesWidgetEl || !editedFiles || editedFiles.length === 0) return;
  // Copilot has one file review surface. When Keep/Undo pending edits are present,
  // that panel is the review surface; do not render a second duplicate Files Changed list.
  if (Array.isArray(pendingEdits) && pendingEdits.length > 0) {
    fileChangesWidgetEl.style.display = 'none';
    fileChangesWidgetEl.innerHTML = '';
    fileChangesListExpanded = false;
    return;
  }
  var totalAdded = 0, totalRemoved = 0;
  editedFiles.forEach(function(f) {
    totalAdded += (f.linesAdded || 0);
    totalRemoved += (f.linesRemoved || 0);
  });
  var statHtml = (totalAdded > 0 || totalRemoved > 0)
    ? ' <span class="afc-stats"><span class="afc-added">+' + totalAdded + '</span> <span class="afc-removed">-' + totalRemoved + '</span></span>'
    : '';
  var listHtml = fileChangesListExpanded ? editedFiles.map(function(f, idx) {
    var iconClass = f.action === 'create' ? 'codicon-add'
      : f.action === 'delete' ? 'codicon-trash'
      : 'codicon-edit';
    var rowStat = (f.linesAdded || f.linesRemoved)
      ? '<span class="afc-row-stat"><span class="afc-added">+' + (f.linesAdded || 0) + '</span> <span class="afc-removed">-' + (f.linesRemoved || 0) + '</span></span>'
      : '';
    var dirName = f.path ? f.path.replace(/\\/g, '/').replace(/\/[^\/]+$/, '') : '';
    return '<div class="afc-row" data-idx="' + idx + '" title="' + escapeHtml(f.path || f.basename) + ' — 点击在编辑器中查看差异">'
      + '<i class="codicon ' + iconClass + ' afc-row-icon"></i>'
      + '<span class="afc-row-body">'
      + '<span class="afc-row-name">' + escapeHtml(f.basename) + '</span>'
      + (dirName ? '<span class="afc-row-dir">' + escapeHtml(dirName) + '</span>' : '')
      + '</span>'
      + rowStat
      + '</div>';
  }).join('') : '';
  var nFiles = editedFiles.length;
  var nLabel = nFiles + ' 个文件已修改';
  var chevronClass = 'afc-chevron' + (fileChangesListExpanded ? ' expanded' : '');
  fileChangesWidgetEl.innerHTML =
    '<div class="afc-header">'
    + '<button class="afc-toggle" data-afc-toggle="1">'
    + '<span class="' + chevronClass + '">▶</span>'
    + '<span class="afc-title">' + nLabel + '</span>'
    + statHtml
    + '</button>'
    + '<button class="afc-close" title="关闭">\u00d7</button>'
    + '</div>'
    + (fileChangesListExpanded ? '<div class="afc-list">' + listHtml + '</div>'
      + '<div class="afc-hint">\u70b9\u51fb\u6587\u4ef6\u53ef\u5728\u7f16\u8f91\u5668\u4e2d\u67e5\u770b\u5dee\u5f02</div>' : '');
  fileChangesWidgetEl.style.display = '';
  var toggleBtn = fileChangesWidgetEl.querySelector('[data-afc-toggle]');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function() {
      fileChangesListExpanded = !fileChangesListExpanded;
      renderFileChangesWidget(editedFiles);
    });
  }
  // Add click handlers to each row to open the diff in the editor
  var rows = fileChangesWidgetEl.querySelectorAll('.afc-row');
  for (var ri = 0; ri < rows.length; ri++) {
    (function(row, fileInfo) {
      row.addEventListener('click', function() {
        vscode.postMessage({ type: 'openPendingEdit', path: fileInfo.path || fileInfo.basename });
      });
    })(rows[ri], editedFiles[parseInt(rows[ri].getAttribute('data-idx'), 10)]);
  }
  var closeBtn = fileChangesWidgetEl.querySelector('.afc-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', function() {
      fileChangesWidgetEl.style.display = 'none';
      fileChangesListExpanded = false;
    });
  }
}

/**
 * Build a short, meaningful one-line summary for a finished task container.
 * Priority: task description/file name > step count fallback.
 * Example outputs: "Created Car.h", "Analyzed main.cpp (3 steps)", "修改 CMakeLists.txt"
 */
function buildFinishedLabel(isFailed, container) {
  // Count tool activity steps for appending step info
  var stepCount = 0;
  if (container) {
    stepCount = container.querySelectorAll('.aut-step').length;
  }
  if (!stepCount) {
    stepCount = Object.keys(agentActivityCounts).reduce(function(s, k) { return s + agentActivityCounts[k]; }, 0);
  }
  var stepSuffix = stepCount > 0 ? ' · ' + stepCount + ' step' + (stepCount === 1 ? '' : 's') : '';
  var containerLabel = container
    ? (container.getAttribute('data-finished-label') || container.getAttribute('data-running-label') || '')
    : '';
  if (isFailed) {
    var failedTodoLabel = findFailedTodoLabel();
    if (failedTodoLabel) return 'Failed: ' + failedTodoLabel + stepSuffix;
  }
  if (containerLabel) {
    return (isFailed ? 'Failed: ' : '') + containerLabel + stepSuffix;
  }
  // Priority 1: Use action-based label from current task (most specific — Copilot style).
  // Must check this BEFORE todoCount so execute-phase containers get their own label
  // ("Created foo.cpp") rather than the plan-level todo count fallback.
  if (agentCurrentTaskLabel) {
    if (isFailed) {
      var failFile = agentCurrentTaskLabel.replace(/^\w+ /, '');
      return 'Failed: ' + failFile;
    }
    var doneLabel = agentCurrentTaskLabel
      .replace(/^Creating /, 'Created ')
      .replace(/^Modifying /, 'Modified ')
      .replace(/^Editing /, 'Edited ')
      .replace(/^Deleting /, 'Deleted ')
      .replace(/^Analyzing /, 'Analyzed ')
      .replace(/^Exploring /, 'Explored ')
      .replace(/^Running /, 'Ran ')
      .replace(/^Working on /, 'Worked on ');
    return doneLabel + stepSuffix;
  }
  // Priority 2: Plan-only containers — show todo count as meaningful label
  var todoCount = agentToolTodos && agentToolTodos.length ? agentToolTodos.length : agentTodos.length;
  if (!isFailed && todoCount > 0) {
    return 'Planned ' + todoCount + (todoCount === 1 ? ' task' : ' tasks') + stepSuffix;
  }
  if (isFailed) return stepCount > 0 ? ('\u5931\u8d25 \u2014 ' + stepCount + ' \u6b65') : 'Failed';
  return stepCount > 0
    ? 'Completed ' + stepCount + ' step' + (stepCount === 1 ? '' : 's')
    : 'Finished working';
}

function findFailedTodoLabel() {
  var failedTodo = (agentToolTodos || []).find(function(t) { return t && t.status === 'failed' && t.title; });
  if (!failedTodo) return '';
  return failedTodo.title.length > 52 ? failedTodo.title.slice(0, 50) + '...' : failedTodo.title;
}

function markFirstActiveTodoFailedForFinalState(todos) {
  var hasExplicitFailed = (todos || []).some(function(t) { return t && t.status === 'failed'; });
  if (hasExplicitFailed) return todos.map(function(t) { return Object.assign({}, t); });

  var failedMarked = false;
  return (todos || []).map(function(t) {
    if (!failedMarked && t.status === 'in-progress') {
      failedMarked = true;
      return Object.assign({}, t, { status: 'failed' });
    }
    return Object.assign({}, t);
  });
}

/**
 * Finalize a task's Working container: collapse + show meaningful task summary.
 */
function finalizeExecContainer(container, isFailed) {
  if (!container || !container.isConnected) return;
  stopWorkingShimmer();
  var autDets = container.querySelector('.aut-details');
  // P-O: remove spinner row when done
  if (autDets) {
    var _spinnerRow = autDets.querySelector('.aut-spinner-row');
    if (_spinnerRow) _spinnerRow.remove();
  }
  // P-Q: finalize streaming analysis body (strip cursor, enhance code)
  var isAnalyzeContainer = container.hasAttribute('data-analyze');
  if (autDets) {
    var _analysisBodyFin = autDets.querySelector('.aut-analysis-body');
    if (_analysisBodyFin && _analysisBodyFin._raw) {
      var _analysisRawFin = sanitizeAgentVisibleText(_analysisBodyFin._raw);
      _analysisBodyFin.innerHTML = md(_analysisRawFin);
      enhanceCodeVisuals(_analysisBodyFin);
      renderMermaidBlocks(_analysisBodyFin).then(function() { addCodeToolbars(_analysisBodyFin); maybeScrollToBottom(); });
      if (isAnalyzeContainer) {
        addAgentAnalysisFeedbackBubble(_analysisRawFin, container);
      }
    }
  }
  if (autDets) {
    // Copilot pattern: collapse ALL Working boxes on completion (not just analyze).
    // The compact [data-done] CSS + buildFinishedLabel title summarises what happened;
    // users can click <details> to expand and inspect tool-activity steps.
    // For analyze containers the prose bubble below carries the conclusion anyway.
    autDets.removeAttribute('open');
    autDets.setAttribute('data-done', '1');
    if (isFailed) autDets.setAttribute('data-failed', '1');
  }
  // Stop any row-level loading icons that were left in started state. The final
  // thinking box must not keep a spinner after all tasks are complete.
  var startedRows = container.querySelectorAll('.aut-row.state-started');
  for (var sr = 0; sr < startedRows.length; sr++) {
    startedRows[sr].classList.remove('state-started');
    startedRows[sr].classList.add(isFailed ? 'state-failed' : 'state-completed');
    var rowIcon = startedRows[sr].querySelector('.aut-icon');
    if (rowIcon) {
      rowIcon.innerHTML = isFailed
        ? '<i class="codicon codicon-error"></i>'
        : '<i class="codicon codicon-check"></i>';
    }
  }
  container.setAttribute('data-done', '1');
  if (isFailed) container.setAttribute('data-failed', '1');
  var statusIcon = container.querySelector('.aut-status-icon');
  if (statusIcon) {
    // P-P: analysis mode (data-analyze) — hide status icon; plain text only
    if (isAnalyzeContainer) {
      statusIcon.innerHTML = '';
    } else {
      statusIcon.innerHTML = isFailed
        ? '<i class="codicon codicon-error"></i>'
        : '<i class="codicon codicon-check"></i>';
    }
  }
  var lbl = container.querySelector('.aut-label');
  if (lbl) {
    lbl.textContent = buildFinishedLabel(isFailed, container);
    lbl.classList.add('aut-label-done');
  }
  var cnt = container.querySelector('.aut-count');
  if (cnt) cnt.textContent = '';
  // Track for analysis text injection at endResponse
  agentLastFinalizedContainer = container;
}

function finalizeActiveAgentWorkingContainers(isFailed) {
  var active = messagesEl
    ? messagesEl.querySelectorAll('.aut-container:not([data-done])')
    : document.querySelectorAll('.aut-container:not([data-done])');
  for (var i = 0; i < active.length; i++) {
    finalizeExecContainer(active[i], isFailed);
  }
  if (agentExecContainer && agentExecContainer.isConnected && !agentExecContainer.hasAttribute('data-done')) {
    finalizeExecContainer(agentExecContainer, isFailed);
  }
}

function hasAgentFailureState() {
  if (agentValidationSummary && agentValidationSummary.state === 'failed') return true;
  if (agentTodos.some(function(t) { return t.state === 'failed'; })) return true;
  if (agentToolTodos.some(function(t) { return t.status === 'failed'; })) return true;
  return Array.from(workingEntries.values()).some(function(entry) {
    return entry && entry.state === 'failed';
  });
}

/**
 * P-Q: Route \x00AFILE:filename\x00content delta into the current aut-container's
 * analysis body, streaming AI prose/code directly inside the Working box (Copilot style).
 * The container already exists because execute:started fires before the LLM call begins.
 */
function routeAnalysisToWorkingBox(filename, text) {
  if (!agentExecContainer || !agentExecContainer.isConnected) return;
  // P-P: mark container as analysis mode for done-state border removal
  agentExecContainer.setAttribute('data-analyze', '1');
  var autDets = agentExecContainer.querySelector('.aut-details');
  if (!autDets) return;
  autDets.setAttribute('open', ''); // keep open while streaming
  // Get or lazily create analysis body
  var body = autDets.querySelector('.aut-analysis-body');
  if (!body) {
    body = document.createElement('div');
    body.className = 'aut-analysis-body';
    // Insert before spinner row so spinner stays at bottom
    var spinnerRowRef = autDets.querySelector('.aut-spinner-row');
    if (spinnerRowRef) autDets.insertBefore(body, spinnerRowRef);
    else autDets.appendChild(body);
    body._raw = '';
  }
  if (text.startsWith('\x00RESET\x00')) {
    body._raw = text.slice(7);
  } else {
    body._raw = (body._raw || '') + text;
  }
  scheduleAnalysisBodyRender(body);
}

/**
 * Create and insert a fresh aut-steps-list into a container.
 * Resets agentActivityRowId and agentActivityCounts for the new container.
 */
function createExecStepsList(container) {
  var dets = container.querySelector('.aut-details');
  var rows = container.querySelector('.aut-rows');
  if (dets && rows) {
    var sw = document.createElement('div');
    sw.className = 'aut-steps-list';
    sw.id = 'aut-activity-' + Date.now();
    dets.insertBefore(sw, rows);
    agentActivityRowId = sw.id;
    agentActivityCounts = { read: 0, search: 0, list: 0, terminal: 0, write: 0, web: 0, memory: 0, todo: 0, prose: 0 };
    agentActivitySeen = new Set();
  }
}

function setAgentContainerLabel(container, label, persistForDone) {
  if (!container || !label) return;
  var normalized = String(label).replace(/\s+/g, ' ').trim();
  if (!normalized) return;
  var activeLabel = container.querySelector('.aut-label');
  if (activeLabel) activeLabel.textContent = normalized;
  container.setAttribute('data-running-label', normalized);
  if (persistForDone !== false) container.setAttribute('data-finished-label', normalized);
}

function ensureAgentProgressContainer(label) {
  if (agentExecContainer && agentExecContainer.isConnected && !agentExecContainer.hasAttribute('data-done')) {
    if (!agentExecContainer.querySelector('.aut-steps-list')) createExecStepsList(agentExecContainer);
    return agentExecContainer;
  }

  var wrap = document.createElement('div');
  wrap.className = 'turn assistant-turn';
  markTurnEnter(wrap);
  agentExecContainer = document.createElement('div');
  agentExecContainer.className = 'aut-container';
  agentExecContainer.innerHTML = '<details class="aut-details" open>'
    + '<summary class="aut-summary">'
    + '<span class="aut-status-icon"><i class="codicon codicon-loading aut-spin"></i></span>'
    + '<span class="aut-label">' + escapeHtml(label || 'Working...') + '</span>'
    + '<span class="aut-count"></span>'
    + '</summary>'
    + '<div class="aut-rows"></div>'
    + '</details>';
  startWorkingShimmer(agentExecContainer);
  setAgentContainerLabel(agentExecContainer, label || 'Working...', true);
  createExecStepsList(agentExecContainer);
  wrap.appendChild(agentExecContainer);
  messagesEl.appendChild(wrap);
  repositionAgentProseAfterLatestWorking();
  return agentExecContainer;
}

var AGENT_ACTIVITY_DISPLAY = {
  read: { target: 'file', labelTarget: 'file', labelVerb: 'Reading', spinnerVerb: 'Reading', stepVerb: 'Read', icon: 'codicon-file-text', basename: true },
  search: { target: 'code', labelTarget: 'code', labelVerb: 'Searching', spinnerVerb: 'Searching', stepVerb: 'Searched for', icon: 'codicon-search', max: 60 },
  list: { target: 'directory', labelTarget: 'directory', labelVerb: 'Listing', spinnerVerb: 'Listing', stepVerb: 'Listed', icon: 'codicon-list-flat' },
  write: { target: 'file', labelTarget: 'file', labelVerb: 'Writing', spinnerVerb: 'Writing', stepVerb: 'Wrote', icon: 'codicon-edit', basename: true },
  web: { target: 'webpage', labelTarget: 'webpage', labelVerb: 'Fetching', spinnerVerb: 'Fetching', stepVerb: 'Fetched', icon: 'codicon-globe', max: 60 },
  diagnostics: { target: 'workspace diagnostics', labelTarget: 'diagnostics', labelVerb: 'Checking', spinnerVerb: 'Checking', stepVerb: 'Checked', icon: 'codicon-warning' },
  'vscode-command': { target: 'VS Code command', labelTarget: 'VS Code command', labelVerb: 'Running', spinnerVerb: 'Running', stepVerb: 'Ran', icon: 'codicon-extensions', max: 50 },
  mcp: { target: 'tool', labelTarget: 'tool', labelVerb: 'Calling', spinnerVerb: 'Calling', stepVerb: 'Called', icon: 'codicon-plug', max: 50 },
  terminal: { target: 'command', labelTarget: 'command', labelVerb: 'Running', spinnerVerb: 'Running', stepVerb: 'Ran', icon: 'codicon-terminal', max: 50, shellPrefix: true },
};

function getAgentActivityDisplay(kind) {
  return AGENT_ACTIVITY_DISPLAY[kind] || {
    target: 'tool',
    labelTarget: '',
    labelVerb: 'Working',
    spinnerVerb: 'Running',
    stepVerb: 'Ran',
    icon: 'codicon-terminal',
    max: 50,
    shellPrefix: true,
  };
}

function formatAgentActivityTarget(value, spec) {
  var target = String(value || '').replace(/\\/g, '/');
  if (spec && spec.basename) target = target.split('/').pop() || target;
  var max = (spec && spec.max) || 0;
  if (max > 0 && target.length > max) target = target.slice(0, max) + '\u2026';
  return target;
}

function buildAgentToolActivityLabel(kind, label) {
  var spec = getAgentActivityDisplay(kind);
  var raw = String(label || '').replace(/\s+/g, ' ').trim();
  var target = raw.replace(/\\/g, '/').split('/').pop() || raw;
  if (target.length > 52) target = target.slice(0, 50) + '…';
  return spec.labelVerb + ' ' + (target || spec.labelTarget || spec.target || '');
}

function normalizeAgentToolActivityKind(kind) {
  var raw = kind == null ? '' : String(kind).trim();
  if (!raw || raw === 'undefined' || raw === 'null' || raw === '[object Object]') return 'read';
  return raw;
}

function normalizeAgentToolActivityLabel(label) {
  if (label == null) return '';
  var raw = String(label).replace(/\s+/g, ' ').trim();
  if (raw === 'undefined' || raw === 'null' || raw === '[object Object]') return '';
  return raw;
}

function defaultAgentToolActivityTarget(kind) {
  return getAgentActivityDisplay(kind).target || 'tool';
}

function formatAgentToolActivityStep(kind, label) {
  var spec = getAgentActivityDisplay(kind);
  var target = formatAgentActivityTarget(label, spec) || spec.target || 'tool';
  return {
    icon: spec.icon || 'codicon-terminal',
    html: spec.stepVerb + ' <code>' + (spec.shellPrefix ? '$ ' : '') + escapeHtml(target) + '</code>',
  };
}

function activeAgentContainerHasProcessRows(container) {
  if (!container) return false;
  return !!container.querySelector('.aut-step, .aut-row, .term-output-details, .ran-command-row');
}

function prepareAgentToolActivityContainer(kind, label) {
  var nextLabel = buildAgentToolActivityLabel(kind, label);
  var nextToolKey = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  var current = agentExecContainer;
  if (current && current.isConnected && !current.hasAttribute('data-done')) {
    var currentKind = current.getAttribute('data-active-tool-kind') || '';
    var currentToolKey = current.getAttribute('data-active-tool-label') || '';
    var stepCount = current.querySelectorAll('.aut-step, .term-output-details, .ran-command-row').length;
    var hasTerminalOutput = !!current.querySelector('.term-output-details, .ran-command-row');
    var isDifferentTerminalCommand = kind === 'terminal' && currentKind === 'terminal'
      && hasTerminalOutput && currentToolKey && currentToolKey !== nextToolKey;
    var shouldSplit = activeAgentContainerHasProcessRows(current)
      && (
        (kind === 'terminal' && currentKind !== 'terminal')
        || isDifferentTerminalCommand
        || (currentKind === 'terminal' && kind !== 'terminal')
        || kind === 'write'
        || stepCount >= 3
        || (currentKind && currentKind !== kind)
        || hasTerminalOutput
      );
    if (shouldSplit) {
      finalizeExecContainer(current, false);
      agentExecContainer = null;
      agentActivityRowId = null;
      agentActivityCounts = { read: 0, search: 0, list: 0, terminal: 0, write: 0, web: 0, memory: 0, todo: 0, prose: 0 };
      agentActivitySeen = new Set();
    }
  }
  var container = ensureAgentProgressContainer(nextLabel);
  container.setAttribute('data-active-tool-kind', kind || 'tool');
  container.setAttribute('data-active-tool-label', nextToolKey);
  setAgentContainerLabel(container, agentCurrentTaskLabel || nextLabel, true);
  return container;
}

function appendAgentProgressStep(kind, label, detail, state) {
  var container = ensureAgentProgressContainer(label || 'Working...');
  var steps = agentActivityRowId ? document.getElementById(agentActivityRowId) : null;
  if (!steps) {
    createExecStepsList(container);
    steps = agentActivityRowId ? document.getElementById(agentActivityRowId) : null;
  }
  if (!steps) return;
  var icon = kind === 'plan' ? 'codicon-list-tree'
    : kind === 'done' ? 'codicon-check'
    : kind === 'failed' ? 'codicon-error'
    : kind === 'execute' ? 'codicon-play'
    : 'codicon-info';
  var step = document.createElement('div');
  step.className = 'aut-step aut-step-prose state-' + (state || 'started');
  var detailHtml = detail
    ? '<details class="aut-step-details"><summary>详情</summary><pre>' + escapeHtml(detail) + '</pre></details>'
    : '';
  step.innerHTML = '<i class="codicon ' + icon + ' aut-step-icon"></i>'
    + '<span class="aut-step-text">' + escapeHtml(label || '处理中') + detailHtml + '</span>';
  steps.appendChild(step);
  steps.scrollTop = steps.scrollHeight;
}

function scrollAgentProgressToBottom() {
  scrollToBottom(true);
}

function addAgentStatus(msg) {
  // P5: isAgentMode is now set synchronously in the startResponse handler.
  // Keep this as a fallback for backward compatibility.
  if (msg.phase === 'plan' && !isAgentMode) isAgentMode = true;

  // Agent mode uses the interactive aut-container as the single visible progress
  // surface. Do not also write to the global working-area, or the feedback area
  // shows duplicated blue status rows.
  var workingTitle = msg.title || (msg.taskFile ? basename(msg.taskFile) : '处理中');
  if (!isAgentMode) {
    updateWorkingEntry('agent-' + (msg.phase || 'run'), workingTitle, msg.detail || '', msg.state || 'started');
    if (msg.state === 'started' || msg.phase === 'plan') {
      setWorkingSessionState('running', workingTitle);
    }
  }

  // \u2500\u2500 Analyze file / summary phases \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (msg.phase === 'analyzeFile') {
    // P-M/P-N: no af-card — content streams inside Working box via routeAnalysisToWorkingBox
    return;
  }
  if (msg.phase === 'analyzeSummary') {
    // Summary flows to currentRaw → deferred prose bubble (Copilot: final prose below Working boxes)
    return;
  }

  // \u2500\u2500 Plan phase \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  if (msg.phase === 'plan') {
    if (msg.state !== 'completed') {
      var planLabel = msg.title || '分析任务，正在生成执行计划…';
      var analyzingNode = document.getElementById('agent-analyzing-indicator');
      if (analyzingNode) analyzingNode.remove();
      agentCurrentTaskIndex = -1;
      ensureAgentProgressContainer(planLabel);
      setAgentContainerLabel(agentExecContainer, planLabel, true);
      appendAgentProgressStep('plan', planLabel, msg.detail || '', msg.state || 'started');
      var planSpin = agentExecContainer && agentExecContainer.querySelector('.aut-spinner-label');
      if (planSpin) planSpin.textContent = planLabel;
      scrollAgentProgressToBottom();
      return;
    }

    // Remove the initial "analyzing" placeholder once the plan Working box is ready
    var _analyzingEl = document.getElementById('agent-analyzing-indicator');
    if (_analyzingEl) _analyzingEl.remove();
    var tasks = parsePlanDetail(msg.detail || '');
    agentPlanCard = null;
    agentPlanDone = true;  // unlock delta accumulation for subsequent analysis content

    // Build unified task list (F-4: Copilot append-style — no pre-built placeholder rows)
    // agentTodos tracks state for header count updates; rows are appended as tasks execute.
    agentTodos = tasks.map(function(t) {
      return { action: t.action, file: t.file, desc: t.desc || basename(t.file), state: 'pending' };
    });
    // Pre-populate Todos widget from plan tasks immediately (Copilot-style:
    // show task list as soon as the plan is ready, not just after completion).
    if (agentTodos.length > 0) {
      var planTodoItems = agentTodos.map(function(t) {
        // Copilot style: task INTENT (desc) is primary, filename is secondary
        // Users need to know WHAT will be done, not just WHICH file
        var fname2 = t.file ? basename(t.file) : '';
        var desc2 = t.desc || '';
        return { __agentState: true, title: desc2 || fname2, action: t.action || 'modify', desc: fname2, status: 'not-started' };
      });
      handleTodoUpdate(planTodoItems);
    }
    if (agentTodos.length > 0) {
      if (!agentExecContainer || !agentExecContainer.isConnected || agentExecContainer.hasAttribute('data-done')) {
        var unifiedWrap = document.createElement('div');
        unifiedWrap.className = 'turn assistant-turn';
        markTurnEnter(unifiedWrap);
        agentExecContainer = document.createElement('div');
        agentExecContainer.className = 'aut-container';
        agentExecContainer.innerHTML = '<details class="aut-details" open>'
          + '<summary class="aut-summary">'
          + '<span class="aut-status-icon"><i class="codicon codicon-loading aut-spin"></i></span>'
          + '<span class="aut-label">Working...</span>'
          + '<span class="aut-count"></span>'
          + '</summary>'
          + '<div class="aut-rows"></div>'
          + '</details>';
        startWorkingShimmer(agentExecContainer);
        setAgentContainerLabel(agentExecContainer, msg.title || '任务计划已生成', true);
        unifiedWrap.appendChild(agentExecContainer);
        messagesEl.appendChild(unifiedWrap);
      } else {
        setAgentContainerLabel(agentExecContainer, msg.title || '任务计划已生成', true);
      }
      agentTaskCards.clear();
      agentCurrentTaskIndex = -1; // -1 marks this as the plan container (not a task container)
      // Insert steps list above aut-rows (Copilot style: no planning prose inside working box)
      var autDetsEl = agentExecContainer.querySelector('.aut-details');
      var autRowsEl = agentExecContainer.querySelector('.aut-rows');
      if (autDetsEl && autRowsEl && !agentExecContainer.querySelector('.aut-steps-list')) {
        // Steps list — always created; each tool call appends one readable row here
        var stepsWrap = document.createElement('div');
        stepsWrap.className = 'aut-steps-list';
        stepsWrap.id = 'aut-activity-' + Date.now();
        autDetsEl.insertBefore(stepsWrap, autRowsEl);
        agentActivityRowId = stepsWrap.id;
        agentActivityCounts = { read: 0, search: 0, list: 0, terminal: 0, write: 0, web: 0, memory: 0, todo: 0, prose: 0 };
        agentActivitySeen = new Set();
      }
      appendAgentProgressStep('plan', msg.title || ('任务计划已生成：' + agentTodos.length + ' 个子任务'), msg.detail || '', 'completed');
    }
    scrollAgentProgressToBottom();
    return;
  }

  // ── Execute phase ────────────────────────────────────────────────────────
  if (msg.phase === 'execute') {
    if (!msg.taskFile && !msg.taskId) {
      var batchLabel = msg.title || (msg.state === 'completed' ? '执行阶段完成' : '开始执行任务');
      ensureAgentProgressContainer(batchLabel);
      var existingPhaseLabel = agentExecContainer
        ? (agentExecContainer.getAttribute('data-finished-label') || agentExecContainer.getAttribute('data-running-label') || '')
        : '';
      var combinedBatchLabel = existingPhaseLabel && existingPhaseLabel !== batchLabel
        ? existingPhaseLabel + '；' + batchLabel
        : batchLabel;
      setAgentContainerLabel(agentExecContainer, combinedBatchLabel, true);
      appendAgentProgressStep('execute', batchLabel, msg.detail || '', msg.state || 'started');
      var batchSpin = agentExecContainer && agentExecContainer.querySelector('.aut-spinner-label');
      if (batchSpin) batchSpin.textContent = batchLabel;
      scrollAgentProgressToBottom();
      return;
    }

    // F-4: rows are appended on-the-fly; look up existing row if this task was seen before
    var taskKey = msg.taskIndex != null
      ? 'agent-task-' + msg.taskIndex
      : 'agent-task-' + (msg.taskId || msg.taskFile);
    var row = agentTaskCards.get(taskKey);
    var stateIcon = msg.state === 'completed' ? 'codicon-check' : msg.state === 'failed' ? 'codicon-error' : msg.state === 'skipped' ? 'codicon-dash' : 'codicon-loading aut-spin';
    var fname = msg.taskFile ? basename(msg.taskFile) : '';

    // Per-task Working boxes: when a NEW task starts, finalize the previous container
    // and create a fresh one. Each file analysis gets its own Working box (Copilot style).
    var effectiveTaskAction = (msg.taskAction || (agentTodos[msg.taskIndex - 1] || {}).action || '');
    var isNewTask = msg.taskIndex != null && msg.taskIndex !== agentCurrentTaskIndex;
    if (isNewTask && (msg.state === 'started' || !msg.state)) {
      // Build label FIRST so finalizeExecContainer sees the correct task label
      var prevTaskIdx = agentCurrentTaskIndex;  // save BEFORE update
      agentCurrentTaskIndex = msg.taskIndex;
      if (msg.taskIndex != null && agentTodos.length > 0) {
        for (var pti = 0; pti < Math.max(0, msg.taskIndex - 1); pti++) {
          if (agentTodos[pti].state !== 'failed') agentTodos[pti].state = 'completed';
        }
        syncAgentTodosWidget();
      }
      var todoForLabel = msg.taskIndex != null ? agentTodos[msg.taskIndex - 1] : null;
      // Copilot style: Working box header = action + filename (short, identifiable).
      // Full task description lives in the Todos widget — not repeated in the Working header.
      var rawDesc = todoForLabel ? (todoForLabel.desc || '') : '';
      var taskDesc = fname
        || (todoForLabel && todoForLabel.file ? basename(todoForLabel.file) : '')
        || (rawDesc.length <= 40 ? rawDesc : rawDesc.slice(0, 38) + '…');
      if (!taskDesc && msg.title) taskDesc = msg.title.length > 40 ? msg.title.slice(0, 38) + '…' : msg.title;
      var taskAction = todoForLabel ? todoForLabel.action : (msg.taskAction || '');
      // Detect compile/run tasks: analyze action whose desc mentions run_terminal or compile.
      // These show "Running X" instead of "Analyzing X" for clearer intent (Claude Code pattern).
      var isRunTask = (taskAction === 'analyze' || taskAction === 'explain')
        && /run_terminal|run\s+\w|compile|execute|\$\s/i.test(rawDesc);
      var actionPrefix = taskAction === 'create' ? 'Creating '
        : taskAction === 'delete' ? 'Deleting '
        : taskAction === 'modify' ? 'Modifying '
        : taskAction === 'explore' ? 'Exploring '
        : isRunTask ? 'Running '
        : (taskAction === 'analyze' || taskAction === 'explain') ? 'Analyzing '
        : taskAction ? 'Working on ' : '';
      var prevTaskLabel = agentCurrentTaskLabel;  // save OLD label for finalization
      agentCurrentTaskLabel = actionPrefix + taskDesc;

      {
        if (agentExecContainer && agentExecContainer.isConnected) {
          // Finish the plan/batch or previous task container before opening the
          // next task. This preserves Copilot-style process history as separate
          // one-line thinking rows instead of replacing it with the newest task.
          var _newLabel = agentCurrentTaskLabel;
          agentCurrentTaskLabel = prevTaskLabel;
          finalizeExecContainer(agentExecContainer, false);
          agentCurrentTaskLabel = _newLabel;
        }
        agentExecContainer = null;
        agentActivityRowId = null;
        agentTaskCards.clear();
        agentActivityCounts = { read: 0, search: 0, list: 0, terminal: 0, write: 0, web: 0, memory: 0, todo: 0, prose: 0 };
        agentActivitySeen = new Set();
      }
    }

    // Create container for this task if not present
    if (!agentExecContainer || !agentExecContainer.isConnected) {
      var ecWrap = document.createElement('div');
      ecWrap.className = 'turn assistant-turn';
      markTurnEnter(ecWrap);
      agentExecContainer = document.createElement('div');
      agentExecContainer.className = 'aut-container';
      // Copilot-style label: show action-verb + file while working, e.g. "Creating sorting_algorithm.cpp"
      var initLabel = agentCurrentTaskLabel || (fname ? ('Working: ' + fname) : 'Working\u2026');
      agentExecContainer.innerHTML = '<details class="aut-details" open>'
        + '<summary class="aut-summary">'
        + '<span class="aut-status-icon"><i class="codicon codicon-loading aut-spin"></i></span>'
        + '<span class="aut-label">' + escapeHtml(initLabel) + '</span>'
        + '<span class="aut-count"></span>'
        + '</summary>'
        + '<div class="aut-rows"></div>'
        + '</details>';
      startWorkingShimmer(agentExecContainer);
      setAgentContainerLabel(agentExecContainer, initLabel, true);
      createExecStepsList(agentExecContainer);
      ecWrap.appendChild(agentExecContainer);
      messagesEl.appendChild(ecWrap);
    }

    if (row) {
      row.className = 'aut-row state-' + (msg.state || 'started');
      var iconEl = row.querySelector('.aut-icon');
      if (iconEl) {
        if (msg.state === 'completed') iconEl.innerHTML = '<i class="codicon codicon-check"></i>';
        else if (msg.state === 'failed') iconEl.innerHTML = '<i class="codicon codicon-error"></i>';
        else if (msg.state === 'skipped') iconEl.innerHTML = '<i class="codicon codicon-dash"></i>';
        else iconEl.innerHTML = '<i class="codicon codicon-loading aut-spin"></i>';
      }
      // Diff badge: add on first appearance, update on subsequent
      if (msg.linesAdded != null || msg.linesRemoved != null) {
        var diffEl = row.querySelector('.aut-diff');
        var addedTxt = '+' + (msg.linesAdded || 0);
        var removedTxt = '-' + (msg.linesRemoved || 0);
        if (diffEl) {
          diffEl.innerHTML = '<span class="aut-added">' + escapeHtml(addedTxt) + '</span>\u00a0'
            + '<span class="aut-removed">' + escapeHtml(removedTxt) + '</span>';
        } else {
          var fileEl = row.querySelector('.aut-file');
          if (fileEl) fileEl.insertAdjacentHTML('afterend',
            '<span class="aut-diff"><span class="aut-added">' + escapeHtml(addedTxt) + '</span>\u00a0'
            + '<span class="aut-removed">' + escapeHtml(removedTxt) + '</span></span>');
        }
      }
      // Failure detail inline
      if (msg.detail && msg.state === 'failed') {
        var detEl = row.querySelector('.aut-detail');
        if (!detEl) row.insertAdjacentHTML('beforeend', '<div class="aut-detail">' + escapeHtml(msg.detail) + '</div>');
        else detEl.textContent = msg.detail;
      }
    } else {
      // F-4: append style — create row on-the-fly when first seen for this task
      var todoEntry = msg.taskIndex != null ? agentTodos[msg.taskIndex - 1] : null;
      var effectiveAction = todoEntry ? todoEntry.action : (msg.taskAction || '');
      // Analysis/explain tasks show progress via tool-activity steps, not file rows
      if ((effectiveAction !== 'analyze' && effectiveAction !== 'explain') && agentExecContainer && agentExecContainer.isConnected) {
        var newRow = document.createElement('div');
        newRow.className = 'aut-row state-' + (msg.state || 'started');
        // Look up desc from agentTodos (keyed by 1-based taskIndex)
        var effectiveDesc = todoEntry ? todoEntry.desc : (msg.taskDesc || '');
        // Copilot-style codicon icons per action type
        var ficonClass = effectiveAction === 'delete' ? 'codicon-trash'
                       : effectiveAction === 'create' ? 'codicon-new-file'
                       : 'codicon-edit';
        var descHtml = effectiveDesc ? '<span class="aut-desc">' + escapeHtml(effectiveDesc) + '</span>' : '';
        newRow.innerHTML = '<span class="aut-icon"><i class="codicon ' + stateIcon + '"></i></span>'
          + '<span class="aut-ficon"><i class="codicon ' + ficonClass + '"></i></span>'
          + '<span class="aut-file">' + escapeHtml(fname) + '</span>'
          + (descHtml ? '&nbsp;<span class="aut-sep">—</span>&nbsp;' + descHtml : '');
        var rowsEl2 = agentExecContainer.querySelector('.aut-rows');
        if (rowsEl2) { rowsEl2.appendChild(newRow); rowsEl2.scrollTop = rowsEl2.scrollHeight; }
        agentTaskCards.set(taskKey, newRow);
        row = newRow;
      }
    }

    // Sync todos state
    if (msg.taskIndex != null) {
      var ti = msg.taskIndex - 1;
      if (ti >= 0 && ti < agentTodos.length) agentTodos[ti].state = msg.state || 'started';
      syncAgentTodosWidget();
    }
    // Update header: Working: {filename} when task starts, progress count otherwise
    var doneCount = agentTodos.filter(function(t) { return t.state === 'completed' || t.state === 'failed'; }).length;
    if (agentExecContainer && agentExecContainer.isConnected) {
      var autCount = agentExecContainer.querySelector('.aut-count');
      var autLbl = agentExecContainer.querySelector('.aut-label');
      // Only show N/M counter once at least one task is done (avoids confusing "0/N" at start)
      var showCount = agentTodos.length > 1 && doneCount > 0;
      if (msg.state === 'started' || (!msg.state && fname)) {
        // Use action-based label while working: "Creating X", "Editing Y", etc.
        if (autLbl) autLbl.textContent = agentCurrentTaskLabel || (fname ? ('Working: ' + fname) : 'Working\u2026');
        if (autCount) autCount.textContent = showCount ? (doneCount + '/' + agentTodos.length) : '';
      } else {
        if (autLbl) autLbl.textContent = agentCurrentTaskLabel || 'Working\u2026';
        if (autCount) autCount.textContent = showCount ? (doneCount + '/' + agentTodos.length) : '';
      }
    }
    maybeScrollToBottom();
    return;
  }

  // ── Validate phase ───────────────────────────────────────────────────────
  if (msg.phase === 'validate') {
    if (msg.state === 'started') {
      if (agentExecContainer && agentExecContainer.isConnected && !agentExecContainer.hasAttribute('data-done')) {
        var validateSpin = agentExecContainer.querySelector('.aut-spinner-label');
        if (validateSpin) validateSpin.textContent = msg.title || '正在执行验证';
      }
      return;
    }
    if (msg.state === 'completed' || msg.state === 'passed' || msg.state === 'failed' || msg.state === 'skipped') {
      settleAgentValidationSpinner(msg);
      agentValidationSummary = {
        state: msg.state === 'failed' ? 'failed' : 'completed',
        title: msg.title || '验证完成',
        detail: msg.detail || '',
      };
    }
    // If there's a tc-group confirm card in the chat, update its last row with compile result
    // instead of creating a separate validate card (avoids 3x duplication of the command).
    if (msg.state === 'completed' || msg.state === 'passed' || msg.state === 'failed') {
      var tcGrpWrap = messagesEl ? messagesEl.querySelector('.tc-group-wrap') : null;
      if (tcGrpWrap) {
        var tcAllRows = tcGrpWrap.querySelectorAll('.tc-row');
        var lastTR = tcAllRows.length ? tcAllRows[tcAllRows.length - 1] : null;
        if (lastTR) {
          var decidedEl = lastTR.querySelector('.tc-decided');
          var btnsEl = lastTR.querySelector('.tc-btns');
          var passed = msg.state !== 'failed';
          var resultText = passed ? '\u2713 \u7f16\u8bd1\u901a\u8fc7' : '\u2717 \u7f16\u8bd1\u5931\u8d25';
          var resultStyle = passed ? '' : ' style="color:var(--vscode-errorForeground)"';
          if (decidedEl) {
            decidedEl.innerHTML = '<span' + resultStyle + '>' + resultText + '</span>';
          } else if (btnsEl) {
            btnsEl.innerHTML = '<span class="tc-decided"' + resultStyle + '>' + resultText + '</span>';
          }
          // On failure only: also show details card
          if (!passed && msg.detail) {
            var failCard = document.createElement('div');
            failCard.className = 'agent-validate-card state-failed';
            failCard.innerHTML = '<div class="agent-validate-title">' + escapeHtml(msg.title || '\u7f16\u8bd1\u9a8c\u8bc1') + '</div>'
              + '<details class="agent-validate-details"><summary class="agent-validate-detail-toggle">\u8be6\u60c5</summary>'
              + '<div class="agent-validate-detail">' + escapeHtml(msg.detail) + '</div></details>';
            var vFailWrap = document.createElement('div');
            vFailWrap.className = 'turn assistant-turn';
            markTurnEnter(vFailWrap);
            vFailWrap.appendChild(failCard);
            messagesEl.appendChild(vFailWrap);
            agentTaskCards.set('agent-validate', failCard);
          }
          maybeScrollToBottom();
          return;
        }
      }
    }
    // No tc-group — fall back to standalone validate card
    var vKey = 'agent-validate';
    var existingV = agentTaskCards.get(vKey);
    if (existingV && existingV.isConnected) {
      existingV.className = 'agent-validate-card state-' + (msg.state || 'started');
      var vtEl = existingV.querySelector('.agent-validate-title');
      if (vtEl) vtEl.textContent = msg.title || '验证';
      if (msg.detail) {
        var vdEl = existingV.querySelector('.agent-validate-detail');
        if (vdEl) { vdEl.textContent = msg.detail; }
      }
      maybeScrollToBottom();
      return;
    }
    var vWrap = document.createElement('div');
    vWrap.className = 'turn assistant-turn';
    markTurnEnter(vWrap);
    var vCard = document.createElement('div');
    vCard.className = 'agent-validate-card state-' + (msg.state || 'started');
    vCard.innerHTML = '<div class="agent-validate-title">' + escapeHtml(msg.title || '验证') + '</div>'
      + (msg.detail
        ? '<details class="agent-validate-details"><summary class="agent-validate-detail-toggle">详情</summary>'
          + '<div class="agent-validate-detail">' + escapeHtml(msg.detail) + '</div></details>'
        : '');
    vWrap.appendChild(vCard);
    messagesEl.appendChild(vWrap);
    agentTaskCards.set(vKey, vCard);
    maybeScrollToBottom();
    return;
  }

  // ── Done / error phase ───────────────────────────────────────────────────
  if (msg.phase === 'done' || msg.phase === 'error') {
    agentTaskCards.clear();
    agentPlanCard = null;
    var doneFailed = msg.state === 'failed';
    var finalFailureTodosSynced = false;
    if (msg.phase === 'done' && doneFailed && agentToolTodos.length > 0) {
      handleTodoUpdate(markFirstActiveTodoFailedForFinalState(agentToolTodos));
      finalFailureTodosSynced = true;
    }
    finalizeActiveAgentWorkingContainers(doneFailed);
    agentExecContainer = null;
    agentCurrentTaskIndex = -1;
    if (msg.phase === 'done') setWorkingSessionState('idle', '');
    // Populate file changes widget with actual edited-file data from agent-loop
    if (msg.phase === 'done' && msg.editedFiles && msg.editedFiles.length > 0) {
      agentLastEditedFiles = msg.editedFiles;
      renderFileChangesWidget(msg.editedFiles);
    }
    // Force all todos to completed state and sync Todos widget so it shows full (N/N) immediately.
    // This is robust regardless of whether the AI called manage_todo_list explicitly.
    if (msg.phase === 'done' && msg.state !== 'failed' && agentTodos.length > 0) {
      agentTodos.forEach(function(t) {
        if (t.state !== 'failed') t.state = 'completed';
      });
      var finalWidgetItems = agentTodos.map(function(t) {
        return { __agentState: true, title: t.desc || basename(t.file || ''), action: t.action || 'modify', desc: basename(t.file || ''), status: t.state === 'failed' ? 'failed' : 'completed' };
      });
      handleTodoUpdate(finalWidgetItems);
    } else if (msg.phase === 'done' && msg.state !== 'failed' && agentToolTodos.length > 0) {
      // When the overall task succeeds, advance ALL active/retried todos to completed:
      // failed → completed (AI tried and retried via terminal, task did succeed overall)
      // in-progress → completed (still in flight at completion)
      // not-started stays as-is (genuinely skipped work)
      handleTodoUpdate(agentToolTodos.map(function(t) {
        var finalStatus = t.status === 'not-started' ? 'not-started' : 'completed';
        return Object.assign({}, t, { status: finalStatus });
      }));
    } else if (msg.phase === 'done' && msg.state === 'failed' && agentToolTodos.length > 0 && !finalFailureTodosSynced) {
      handleTodoUpdate(markFirstActiveTodoFailedForFinalState(agentToolTodos));
    }
    refreshVisibleAgentProseFromCurrentRaw();
    // If endResponse already fired before phase:done, or if the model produced no
    // prose, there may be no final chat feedback. Always try once after completion
    // data (todos/files) is available; agentDoneSummaryInserted prevents duplicates.
    setTimeout(function() {
      if (!agentDoneSummaryInserted) {
        var doneSummary = buildAgentAutoSummary();
        if (doneSummary) addAgentFinalSummaryBubble(doneSummary);
      }
    }, 160);
    maybeScrollToBottom();
  }
}

function settleAgentValidationSpinner(msg) {
  if (!agentExecContainer || !agentExecContainer.isConnected || agentExecContainer.hasAttribute('data-done')) return;
  var autDets = agentExecContainer.querySelector('.aut-details');
  var row = autDets ? autDets.querySelector('.aut-spinner-row') : null;
  if (!row) return;
  var failed = msg.state === 'failed';
  var skipped = msg.state === 'skipped';
  var icon = failed ? 'codicon-error' : skipped ? 'codicon-dash' : 'codicon-check';
  row.classList.add('is-settled');
  row.innerHTML = '<i class="codicon ' + icon + ' aut-spinner-settled-icon"></i>'
    + '<span class="aut-spinner-label is-settled' + (failed ? ' is-failed' : '') + '">'
    + escapeHtml(msg.title || (failed ? '验证失败' : skipped ? '已跳过验证' : '验证完成')) + '</span>';
}

/**
 * Auto-generate a completion prose summary when the LLM didn't produce final text.
 * Uses agentTodos and agentLastEditedFiles to build a Markdown summary.
 */
function buildAgentAutoSummary() {
  var summaryTodos = getAgentSummaryTodoSource();
  var hasTodos = summaryTodos && summaryTodos.length > 0;
  var hasFiles = agentLastEditedFiles && agentLastEditedFiles.length > 0;
  if (!hasTodos && !hasFiles) {
    // Agentic tasks (no plan/todos): build rich activity breakdown summary
    var _ac = agentActivityCounts;
    var _parts = [];
    if (_ac.read > 0) _parts.push('读取 ' + _ac.read + ' 个文件');
    if (_ac.search > 0) _parts.push('搜索 ' + _ac.search + ' 次');
    if (_ac.list > 0) _parts.push('列目录 ' + _ac.list + ' 次');
    if (_ac.write > 0) _parts.push('写入 ' + _ac.write + ' 个文件');
    if (_ac.terminal > 0) _parts.push('执行 ' + _ac.terminal + ' 条命令');
    if (_ac.web > 0) _parts.push('访问 ' + _ac.web + ' 个网页');
    var totalSteps = Object.keys(_ac).reduce(function(s, k) { return s + _ac[k]; }, 0);
    if (_parts.length > 0) return '任务已完成：' + _parts.join('，') + '。';
    if (totalSteps > 0) return '任务已完成（' + totalSteps + ' 步操作）。';
    return '';
  }

  var lines = [];

  if (hasTodos) {
    var doneTodos = summaryTodos.filter(function(t) { return t.status !== 'failed'; });
    var failedTodos = summaryTodos.filter(function(t) { return t.status === 'failed'; });
    var total = summaryTodos.length;
    if (failedTodos.length > 0) {
      lines.push('已完成 ' + doneTodos.length + '/' + total + ' 个任务（' + failedTodos.length + ' 个失败）：');
    } else {
      lines.push('已完成 ' + total + ' 个任务：');
    }
    lines.push('');
    summaryTodos.forEach(function(t) {
      var icon = t.status === 'failed' ? '✗' : '✓';
      var label = t.title || t.desc || '';
      if (label) lines.push(icon + ' ' + label);
    });
  }

  if (hasFiles) {
    if (lines.length > 0) lines.push('');
    var totalAdded = 0, totalRemoved = 0;
    var fileParts = agentLastEditedFiles.map(function(f) {
      totalAdded += (f.linesAdded || 0);
      totalRemoved += (f.linesRemoved || 0);
      var stat = (f.linesAdded || f.linesRemoved)
        ? ' (+' + (f.linesAdded || 0) + ' -' + (f.linesRemoved || 0) + ')'
        : '';
      return '`' + (f.path || f.basename) + '`' + stat;
    });
    var totalStat = (totalAdded || totalRemoved)
      ? '，共 +' + totalAdded + ' -' + totalRemoved + ' 行'
      : '';
    lines.push('**修改了 ' + agentLastEditedFiles.length + ' 个文件' + totalStat + '：** ' + fileParts.join('、'));
  }

  var validationSummary = buildAgentValidationSummarySection();
  if (validationSummary) {
    if (lines.length > 0) lines.push('');
    lines.push(validationSummary);
  }

  return lines.join('\n');
}

/** Render a brief overall completion card after all agent tasks finish */
function addAgentCompletionSummary(title, doneCount, failedCount, todos) {
  if (!messagesEl || !todos || todos.length === 0) return;
  var wrap = document.createElement('div');
  wrap.className = 'turn assistant-turn';
  markTurnEnter(wrap);
  var card = document.createElement('div');
  card.className = 'agent-done-summary';
  var iconClass = failedCount > 0 ? 'codicon-warning' : 'codicon-check-all';
  var summaryText = title || (doneCount + ' 个任务已完成');
  card.innerHTML = '<div class="ads-header">'
    + '<i class="codicon ' + iconClass + ' ads-icon"></i>'
    + '<span class="ads-title">' + escapeHtml(summaryText) + '</span>'
    + '</div>';
  if (todos.length > 1) {
    var detsEl = document.createElement('details');
    detsEl.className = 'ads-details';
    var sumEl = document.createElement('summary');
    sumEl.className = 'ads-toggle';
    sumEl.textContent = '展开详情';
    detsEl.appendChild(sumEl);
    var listEl = document.createElement('div');
    listEl.className = 'ads-list';
    todos.forEach(function(t) {
      var item = document.createElement('div');
      item.className = 'ads-item state-' + (t.state || 'pending');
      var stIcon = t.state === 'completed' ? '✓' : t.state === 'failed' ? '✗' : '−';
      // Strip internal tool-name prefixes like "使用run_terminal工具执行编译命令 g++ ..."
      var rawDesc = (t.desc || t.file || '');
      var cleanDesc = rawDesc
        .replace(/^\s*使用\w+(?:工具)?\s*(?:执行|运行|调用)?\s*/u, '')
        .replace(/^\s*[-—–]\s*/, '')
        .trim() || rawDesc;
      item.textContent = stIcon + ' ' + cleanDesc;
      listEl.appendChild(item);
    });
    detsEl.appendChild(listEl);
    card.appendChild(detsEl);
  }
  wrap.appendChild(card);
  messagesEl.appendChild(wrap);
  maybeScrollToBottom();
}

/** Parse the numbered list in plan detail text → [{action, file, desc}] */
function parsePlanDetail(detail) {
  if (!detail) return [];
  var results = [];
  var lines = detail.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var m = lines[i].match(/^\d+\.\s*\[(\w+)\]\s*([^\s—–-]+)\s*[—–-]\s*(.+)$/);
    if (m) {
      results.push({ action: m[1], file: m[2], desc: m[3].trim() });
    }
  }
  return results;
}

/** Extract basename from a path string */
function basename(p) {
  if (!p) return '';
  return p.replace(/\\/g, '/').split('/').pop() || p;
}

function injectWorkingAreaStyles() {
  var style = document.createElement('style');
  style.textContent = [
    '#working-area { display:none; width:100%; padding: 0; margin-top: 2px; }',
    '#working-area.show { display:block; }',
    '.working-card { border:1px solid rgba(120,170,255,.35); border-radius:10px; background: linear-gradient(180deg, rgba(80,120,200,.14), rgba(40,50,70,.08)); padding:8px 10px; margin: 0 0 8px; }',
    '.working-card.compact { display:flex; align-items:flex-start; gap:8px; padding:7px 10px; border-radius:8px; }',
    '.working-dot { width:7px; height:7px; border-radius:999px; margin-top:5px; background: rgba(99,179,255,.88); box-shadow: 0 0 0 2px rgba(20,26,34,.8); flex:0 0 auto; animation: wiBlink 1.2s ease-in-out infinite; }',    /* W1: animate dot */
    '.working-main { min-width:0; }',
    '.working-main .wi-title { font-size:12px; font-weight:600; line-height:1.35; }',
    '.working-main .wi-detail { font-size:11px; opacity:.78; margin-top:2px; line-height:1.35; }',
    '.working-head { font-size:11px; font-weight:700; letter-spacing:.02em; margin-bottom:6px; opacity:.95; display:flex; flex-direction:column; align-items:flex-start; gap:4px; }',
    '.working-chip { font-size:10px; border:1px solid rgba(127,127,127,.35); border-radius:999px; padding:2px 8px; opacity:.85; }',
    '.working-sub { font-size:11px; opacity:.76; margin-bottom:6px; }',
    '.working-list { display:flex; flex-direction:column; gap:6px; border-left: 1px solid rgba(127,127,127,.22); padding-left:12px; }',
    '.working-item { position: relative; border:1px solid rgba(127,127,127,.25); border-radius:8px; padding:6px 8px; background: rgba(127,127,127,.07); animation: workingItemIn .18s ease-out; }',
    '.working-item::before { content:""; position:absolute; left:-17px; top:11px; width:8px; height:8px; border-radius:999px; background: rgba(99,179,255,.75); box-shadow: 0 0 0 2px rgba(20,26,34,.8); }',
    '.working-item .wi-title { font-size:12px; font-weight:600; margin-bottom:2px; }',
    '.working-item .wi-detail { font-size:11px; opacity:.78; white-space: pre-wrap; }',
    '.working-item .wi-state { font-size:10px; font-weight:700; letter-spacing:.03em; opacity:.8; margin-bottom:2px; }',
    '.working-item.state-failed { border-color: rgba(255,120,120,.5); }',
    '.working-item.state-passed { border-color: rgba(120,220,150,.5); }',
    '.working-item.state-started { border-color: rgba(120,170,255,.5); }',
    '.working-item.state-failed::before { background: rgba(255,120,120,.82); }',
    '.working-item.state-passed::before { background: rgba(120,220,150,.85); }',
    '.working-item.wi-latest { border-color: rgba(99,179,255,.65); background: rgba(99,179,255,.14); }',
    '.working-item.wi-latest::before { background: rgba(99,179,255,.95); animation: wiBlink 1s ease-in-out infinite; }',
    '@keyframes wiBlink { 0%,100%{opacity:1} 50%{opacity:.4} }',
    '.working-list { max-height: 200px; overflow-y: auto; }',
    '@keyframes workingItemIn { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }',
    '.summary-steps-row { margin-top:6px; }',
    '.summary-steps-btn { font-size:10px; background:none; border:none; color:var(--vscode-textLink-foreground,#4ea6ff); cursor:pointer; padding:0; opacity:.82; text-align:left; }',
    '.summary-steps-btn:hover { opacity:1; text-decoration:underline; }',
    '.summary-steps-body { margin-top:5px; border-left:2px solid rgba(99,179,255,.3); padding-left:8px; max-height:220px; overflow-y:auto; }',
    '.ss-step { padding:3px 0; border-bottom:1px solid rgba(127,127,127,.12); }',
    '.ss-step:last-child { border-bottom:none; }',
    '.ss-title { font-size:11px; font-weight:600; }',
    '.ss-detail { font-size:10px; opacity:.72; margin-top:1px; }',
    '.ss-step.state-failed .ss-title { color:var(--vscode-errorForeground,rgba(255,130,130,.9)); }',
    '.ss-step.state-passed .ss-title { color:var(--vscode-charts-green,rgba(120,220,150,.9)); }',
    '.ss-step.state-completed .ss-title { color:var(--vscode-charts-green,rgba(120,220,150,.9)); }',
    /* ── Copilot 风格完成脚注行 fsr-* ── */
    '.fsr-row { padding: 0 10px 2px; }',
    '.fsr-btn { display:inline-flex; align-items:center; gap:5px; background:none; border:none; cursor:pointer; color:inherit; opacity:.62; padding:2px 0; white-space:nowrap; }',
    '.fsr-btn:hover { opacity:.9; }',
    '.fsr-label { font-size:11px; font-weight:600; }',
    '.fsr-sep { font-size:11px; opacity:.6; }',
    '.fsr-count { font-size:11px; }',
    '.fsr-chevron { font-size:9px; display:inline-block; transform-origin:center; transition: transform .18s ease; }',    /* W4: rotation chevron */
    '.fsr-btn.fsr-open .fsr-chevron { transform: rotate(90deg); }',
    '.fsr-btn.fsr-btn-warn { color: rgba(255,190,100,.9); }',    /* W2: failure tint */
    '.fsr-body { margin-top:5px; padding-left:6px; border-left:2px solid rgba(99,179,255,.22); max-height:0; overflow:hidden; transition: max-height .2s ease; }',    /* W3: smooth expand */
    '.fsr-body.fsr-open { max-height:250px; overflow-y:auto; }',
    /* ── P4-1: token usage badge ── */
    '.token-usage-row { padding: 1px 12px 4px; font-size:10px; opacity:.42; color:var(--vscode-foreground); letter-spacing:.02em; }',
    '.fsr-step { display:flex; gap:8px; padding:3px 2px; }',
    '.fsr-step + .fsr-step { border-top:1px solid rgba(127,127,127,.1); }',
    '.fsr-step-num { flex-shrink:0; width:16px; font-size:10px; font-weight:700; color:var(--vscode-charts-blue,rgba(99,179,255,.65)); line-height:1.5; }',
    '.fsr-step-content { min-width:0; flex:1; }',
    '.fsr-step-title { font-size:11px; font-weight:600; line-height:1.4; }',
    '.fsr-step-detail { font-size:10px; opacity:.65; margin-top:1px; line-height:1.35; white-space:pre-wrap; word-break:break-all; }',
    '.fsr-step.state-failed .fsr-step-title { color:var(--vscode-errorForeground,rgba(255,130,130,.9)); }',
    '.fsr-step.state-passed .fsr-step-title, .fsr-step.state-completed .fsr-step-title { color:var(--vscode-charts-green,rgba(120,220,150,.9)); }',
    '.gfp-meta { margin-top: 6px; font-size: 11px; opacity: .82; }',
    '.summary-card { border:1px solid var(--vscode-charts-green,rgba(120,220,150,.38)); border-radius:10px; background:rgba(0,0,0,.04); padding:8px 10px; }',
    '.summary-title { font-size:12px; font-weight:700; line-height:1.35; }',
    '.summary-sub { font-size:11px; opacity:.82; margin-top:3px; line-height:1.35; }',
    '.summary-files { display:flex; flex-wrap:wrap; gap:6px; margin-top:7px; }',
    '.summary-file { border:none; border-radius:999px; padding:2px 8px; cursor:pointer; font-size:10px; background: rgba(90,170,255,.22); color: var(--vscode-button-foreground); }',
    '.summary-file:hover { background: rgba(90,170,255,.35); }',
    '.summary-file.status-kept { background: rgba(120,220,150,.28); color: var(--vscode-charts-green,rgba(120,220,150,.95)); cursor:default; }',
    '.summary-file.status-undone { background: rgba(255,120,120,.18); color: var(--vscode-errorForeground,rgba(255,130,130,.85)); text-decoration:line-through; opacity:.75; cursor:default; }',
    '.summary-actions { font-size:10px; opacity:.8; margin-top:7px; }',
    '.action-notice-card { border:1px solid rgba(99,179,255,.35); border-radius:10px; background: linear-gradient(180deg, rgba(90,170,255,.12), rgba(35,45,60,.08)); padding:8px 10px; }',
    '.action-notice-card.undo { border-color: rgba(255,166,120,.45); background: linear-gradient(180deg, rgba(255,166,120,.12), rgba(55,45,35,.08)); }',
    '.action-notice-title { font-size:12px; font-weight:700; line-height:1.35; }',
    '.action-notice-detail { font-size:11px; opacity:.84; margin-top:3px; line-height:1.35; }',
    /* ── workflow-card（写入/验证/修复状态卡片）── */
    '.workflow-card { border:1px solid rgba(127,127,127,.28); border-radius:8px; padding:7px 10px; font-size:11px; line-height:1.4; }',
    '.workflow-card.state-failed { border-color:rgba(255,120,120,.5); background:rgba(255,80,80,.06); }',
    '.workflow-card.state-passed, .workflow-card.state-completed { border-color:var(--vscode-charts-green,rgba(120,220,150,.45)); background:rgba(0,0,0,.03); }',
    '.wf-head { font-weight:700; margin-bottom:3px; }',
    '.workflow-card.state-failed .wf-head { color:var(--vscode-errorForeground,rgba(255,140,140,.95)); }',
    '.workflow-card.state-passed .wf-head, .workflow-card.state-completed .wf-head { color:var(--vscode-charts-green,rgba(120,220,150,.95)); }',
    '.wf-detail { font-size:10px; opacity:.82; margin-top:2px; white-space:pre-wrap; word-break:break-word; max-height:120px; overflow-y:auto; }',
    /* ── agent-mode cards ── */
    '.agent-plan-card { border:1px solid rgba(120,170,255,.38); border-radius:10px; background:linear-gradient(180deg,rgba(80,120,200,.14),rgba(40,50,70,.08)); padding:9px 12px; }',
    '.agent-plan-details { }',
    '.agent-plan-summary { display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; font-weight:700; list-style:none; padding:2px 0; user-select:none; }',
    '.agent-plan-summary::-webkit-details-marker { display:none; }',
    '.agent-plan-summary::after { content:"›"; font-size:13px; opacity:.55; margin-left:auto; transition:transform .18s; }',
    '.agent-plan-details[open] .agent-plan-summary::after { transform:rotate(90deg); }',
    '.agent-task-list { display:flex; flex-direction:column; gap:4px; margin-top:8px; }',
    '.agent-task-item { display:flex; align-items:flex-start; gap:7px; font-size:11px; padding:4px 2px; border-bottom:1px solid rgba(127,127,127,.1); }',
    '.agent-task-item:last-child { border-bottom:none; }',
    '.agent-task-num { flex-shrink:0; width:16px; font-size:10px; font-weight:700; color:rgba(99,179,255,.7); }',
    '.agent-task-badge { flex-shrink:0; font-size:9px; font-weight:700; letter-spacing:.04em; border-radius:999px; padding:1px 6px; text-transform:uppercase; }',
    '.agent-badge-modify { background:rgba(99,179,255,.22); color:rgba(99,179,255,.9); }',
    '.agent-badge-create { background:rgba(120,220,150,.22); color:rgba(120,220,150,.9); }',
    '.agent-badge-analyze { background:rgba(200,180,90,.22); color:rgba(200,180,90,.9); }',
    '.agent-badge-delete { background:rgba(255,120,120,.22); color:rgba(255,120,120,.9); }',
    '.agent-task-file { font-weight:600; color:rgba(99,179,255,.85); }',
    '.agent-task-desc { opacity:.72; margin-top:1px; font-size:10px; }',
    '.agent-progress-badge { display:inline-block; font-size:10px; font-weight:700; border-radius:999px; padding:1px 7px; background:rgba(99,179,255,.18); color:rgba(99,179,255,.9); margin-left:6px; }',
    /* exec container — Copilot style: left-accent stroke, no heavy box */
    '.agent-exec-container { border-left:2px solid rgba(99,179,255,.38); padding:2px 0 4px 10px; margin-left:2px; background:none; }',
    '.agent-exec-details { }',
    '.agent-exec-summary { display:flex; align-items:center; gap:5px; cursor:pointer; font-size:11px; font-weight:600; list-style:none; padding:2px 0; user-select:none; opacity:.82; }',
    '.agent-exec-summary::-webkit-details-marker { display:none; }',
    '.agent-exec-summary::after { content:"›"; font-size:12px; opacity:.45; margin-left:auto; transition:transform .18s; }',
    '.agent-exec-details[open] .agent-exec-summary::after { transform:rotate(90deg); }',
    '.agent-exec-summary-title { font-size:11px; font-weight:600; }',
    '.agent-exec-summary-progress { font-size:10px; color:rgba(99,179,255,.7); margin-left:3px; }',
    '.agent-exec-rows { display:flex; flex-direction:column; gap:1px; margin-top:5px; }',
    '.agent-exec-row { display:flex; align-items:baseline; gap:5px; font-size:11px; padding:1px 2px; line-height:1.5; flex-wrap:wrap; }',
    '.agent-exec-row.state-completed { opacity:.82; }',
    '.agent-exec-row.state-failed { color:rgba(255,130,130,.9); }',
    '.agent-exec-row.state-skipped { opacity:.42; }',
    '.agent-exec-row.state-started { color:rgba(99,179,255,.9); }',
    '.agent-exec-row.state-started .agent-row-icon { display:inline-block; animation: wiBlink 1s ease-in-out infinite; }',
    '.agent-row-icon { flex-shrink:0; font-size:10px; width:12px; }',
    '.agent-row-fileicon { flex-shrink:0; font-size:10px; opacity:.62; }',
    '.agent-row-progress { display:none; }',
    '.agent-row-file { font-weight:600; color:var(--vscode-textLink-foreground,rgba(99,179,255,.9)); }',
    '.agent-exec-row.state-failed .agent-row-file { color:inherit; }',
    '.agent-row-detail { width:100%; font-size:10px; opacity:.6; padding-left:17px; white-space:pre-wrap; word-break:break-all; }',
    /* validate */
    '.agent-validate-card { border-left:2px solid rgba(127,127,127,.3); padding:4px 0 4px 10px; margin-left:2px; font-size:11px; background:none; }',
    '.agent-validate-card.state-completed { border-color:var(--vscode-charts-green,rgba(120,220,150,.55)); }',
    '.agent-validate-card.state-failed { border-color:var(--vscode-errorForeground,rgba(255,120,120,.6)); }',
    '.agent-validate-title { font-weight:600; }',
    '.agent-validate-card.state-completed .agent-validate-title { color:var(--vscode-charts-green,rgba(120,220,150,.9)); }',
    '.agent-validate-card.state-failed .agent-validate-title { color:var(--vscode-errorForeground,rgba(255,140,140,.9)); }',
    '.agent-validate-details { margin-top:3px; }',
    '.agent-validate-detail-toggle { cursor:pointer; font-size:10px; opacity:.65; list-style:none; }',
    '.agent-validate-detail-toggle::-webkit-details-marker { display:none; }',
    '.agent-validate-detail { font-size:10px; opacity:.7; margin-top:3px; white-space:pre-wrap; word-break:break-all; max-height:160px; overflow-y:auto; }',
    /* done — Copilot style: single compact inline line */
    '.agent-done-line { display:flex; align-items:center; gap:5px; font-size:11px; padding:2px 0; opacity:.9; }',
    '.agent-done-line.state-failed { color:var(--vscode-errorForeground,rgba(255,140,140,.9)); }',
    '.agent-done-line.state-completed { color:var(--vscode-charts-green,rgba(120,220,150,.9)); }',
    '.agent-done-icon { font-size:11px; flex-shrink:0; }',
    '.agent-done-text { font-weight:600; }',
    '.agent-done-detail-inline { font-size:10px; opacity:.65; font-weight:400; }',
    /* ── Agent overall completion summary ── */
    '.agent-done-summary { border-left:2px solid var(--vscode-charts-green,rgba(120,220,150,.45)); padding:3px 0 3px 10px; margin-left:2px; background:none; }',
    '.ads-header { display:flex; align-items:center; gap:5px; font-size:11px; font-weight:600; opacity:.88; }',
    '.ads-icon { color:var(--vscode-charts-green,rgba(120,220,150,.9)); font-size:11px; flex-shrink:0; }',
    '.ads-title { line-height:1.4; }',
    '.ads-details { margin-top:3px; }',
    '.ads-toggle { font-size:10px; opacity:.55; cursor:pointer; list-style:none; padding:0; user-select:none; }',
    '.ads-toggle::-webkit-details-marker { display:none; }',
    '.ads-list { display:flex; flex-direction:column; gap:1px; margin-top:3px; padding-left:6px; }',
    '.ads-item { font-size:11px; line-height:1.55; opacity:.85; }',
    '.ads-item.state-completed { color:var(--vscode-charts-green,rgba(120,220,150,.9)); opacity:1; }',
    '.ads-item.state-failed { color:var(--vscode-errorForeground,rgba(255,130,130,.9)); opacity:1; }',
    /* ── Persistent Todos widget (above input area, Copilot-style) ── */
    '#agent-todos-widget { margin:0 0 4px 0; border:1px solid var(--vscode-input-border,rgba(127,127,127,.2)); border-bottom:none; padding:4px 4px; background:var(--vscode-editor-background); border-radius:var(--vscode-cornerRadius-large,6px) var(--vscode-cornerRadius-large,6px) 0 0; overflow:hidden; user-select:none; }',  /* §13.9: Copilot todos widget style */
    '#agent-todos-widget .agent-todos-details { }',
    '#agent-todos-widget .agent-todos-summary { display:flex; align-items:center; gap:6px; cursor:pointer; list-style:none; padding:2px 0; user-select:none; }',
    '#agent-todos-widget .agent-todos-summary::-webkit-details-marker { display:none; }',
    '#agent-todos-widget .agent-todos-title { font-size:11px; font-weight:700; color:var(--vscode-foreground); flex:1; }',
    '#agent-todos-widget .agent-todos-close { margin-left:auto; background:none; border:none; cursor:pointer; color:var(--vscode-foreground); opacity:.45; font-size:14px; padding:0 2px; line-height:1; }',
    '#agent-todos-widget .agent-todos-close:hover { opacity:.9; }',
    '#agent-todos-widget .agent-todos-list { display:flex; flex-direction:column; gap:2px; margin-top:4px; padding-left:2px; max-height:136px; overflow-y:auto; overscroll-behavior:contain; }',  /* §13.9: max 6.5 items */
    /* Copilot style: task INTENT (desc) is primary — shows what will happen, not just which file.
       Filename shown as small monospace secondary text below the description.
       Animation: ONLY the working box (autShimmer+autSpin) indicates activity;
       the todos icon is a static colored dot — no wiBlink to avoid dual-animation overload. */
    '#agent-todos-widget .agent-todo-item { display:flex; align-items:flex-start; gap:6px; font-size:11px; padding:2px 3px; border-radius:3px; }',
    '#agent-todos-widget .agent-todo-icon { flex-shrink:0; width:14px; font-size:11px; text-align:center; margin-top:1px; }',
    '#agent-todos-widget .agent-todo-action-icon { flex-shrink:0; font-size:10px; opacity:.5; margin-top:2px; }',
    '#agent-todos-widget .agent-todo-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }',
    '#agent-todos-widget .agent-todo-fname { font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.92; }',
    '#agent-todos-widget .agent-todo-subdesc { font-size:10px; opacity:.5; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-family:var(--vscode-editor-font-family,monospace); letter-spacing:-.01em; }',
    '#agent-todos-widget .agent-todo-item.state-completed .agent-todo-icon { color:var(--vscode-charts-green,rgba(120,220,150,.9)); }',
    '#agent-todos-widget .agent-todo-item.state-completed .agent-todo-fname { opacity:.75; }',
    /* in-progress: static blue icon only — working box (autShimmer+autSpin) is the animation */
    '#agent-todos-widget .agent-todo-item.state-started .agent-todo-icon { color:var(--vscode-charts-blue,rgba(99,179,255,.95)); }',
    '#agent-todos-widget .agent-todo-item.state-started .agent-todo-fname { color:var(--vscode-charts-blue,rgba(99,179,255,.9)); font-weight:600; }',
    '#agent-todos-widget .agent-todo-item.state-failed .agent-todo-icon { color:var(--vscode-errorForeground,rgba(255,120,120,.95)); }',
    '#agent-todos-widget .agent-todo-item.state-failed .agent-todo-fname { color:var(--vscode-errorForeground,rgba(255,120,120,.85)); font-weight:600; }',
    '#agent-todos-widget .agent-todo-item.state-pending .agent-todo-icon { opacity:.45; }',
    '#agent-todos-widget .agent-todo-item.state-pending .agent-todo-fname { opacity:.55; }',
    /* Analyzing placeholder row shown before AI calls manage_todo_list */
    '#agent-todos-widget .agent-todos-analyzing { display:flex; align-items:center; gap:6px; font-size:11px; padding:4px 3px; opacity:.6; }',
    '#agent-todos-widget .agent-todos-analyzing .codicon { font-size:11px; animation:autSpin .9s linear infinite; }',
    /* Diff badge + task desc inline in exec rows */
    '.agent-row-diff { font-size:10px; font-weight:700; color:var(--vscode-charts-green,rgba(100,220,120,.85)); margin-left:3px; }',
    '.agent-row-taskdesc { font-size:10px; opacity:.5; margin-left:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }',
    /* ── Unified agent task list (aut-*) — Copilot chat-thinking-box style ── */
    /* Loading spin for codicon-loading icon */
    '@keyframes autSpin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }',
    /* Shimmer animation: gradient text sweep matching Copilot chat-thinking-shimmer */
    '@keyframes autShimmer { 0%{background-position:120% 0} 100%{background-position:-120% 0} }',
    /* Active working container — left-border only, no box frame (Copilot §2.1: 左边竖线，无方框) */
    '.aut-container { border:none; border-left:2px solid rgba(127,127,127,.28); border-radius:0; padding:5px 0 7px 12px; margin:0 0 6px 0; background:none; width:100%; box-sizing:border-box; user-select:none; }',
    /* Done: Copilot-like compact process row. Expands into a bordered details panel. */
    '.aut-container[data-done] { border:1px solid transparent; border-radius:5px; padding:0; margin:1px 0 3px 0; background:transparent; transition:border-color .12s ease, background .12s ease; }',
    '.aut-container[data-done]:hover { background:rgba(127,127,127,.025); }',
    '.aut-container[data-done]:has(.aut-details[open]) { border-color:rgba(127,127,127,.28); background:rgba(127,127,127,.025); }',
    '.aut-container[data-done][data-failed] { border-color:rgba(255,120,120,.38); background:rgba(255,120,120,.035); }',
    '.aut-details { }',
    /* Summary row — compact, normal weight matching Copilot */
    '.aut-summary { display:flex; align-items:center; gap:6px; cursor:pointer; font-size:12px; font-weight:400; list-style:none; padding:2px 0; user-select:none; color:var(--vscode-foreground,rgba(204,204,204,.92)); }',
    '.aut-summary::-webkit-details-marker { display:none; }',
    '.aut-summary::after { content:"\u203a"; font-size:13px; opacity:.38; margin-left:auto; transition:transform .16s; }',
    '.aut-details[open] .aut-summary::after { transform:rotate(90deg); }',
    /* Status icon: loading spinner while working, check/error on done */
    '.aut-status-icon { font-size:12px; width:16px; text-align:center; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; color:var(--vscode-charts-blue,rgba(99,179,255,.9)); }',
    '.aut-status-icon .aut-spin { animation: autSpin 1.4s linear infinite; }',
    '.aut-container[data-done] .aut-spin, .aut-details[data-done] .aut-spin { animation:none !important; }',
    '.aut-details[data-done] .aut-spinner-row { display:none !important; }',
    '.aut-details[data-done] .aut-status-icon { color:var(--vscode-charts-green,rgba(120,220,150,.9)); opacity:.55; }',
    '.aut-details[data-done][data-failed] .aut-status-icon { color:var(--vscode-errorForeground,rgba(255,130,130,.9)); }',
    /* Label: animated shimmer while working, bold and visible like Copilot "Working: {file}" */
    '.aut-label { font-size:12px; font-weight:600; color:var(--vscode-descriptionForeground,rgba(204,204,204,.9)); background:linear-gradient(90deg,var(--vscode-descriptionForeground,rgba(204,204,204,.9)) 0%,var(--vscode-descriptionForeground,rgba(204,204,204,.9)) 30%,var(--vscode-chat-thinkingShimmer,#ffffff) 50%,var(--vscode-descriptionForeground,rgba(204,204,204,.9)) 70%,var(--vscode-descriptionForeground,rgba(204,204,204,.9)) 100%); background-size:400% 100%; background-clip:text; -webkit-background-clip:text; -webkit-text-fill-color:transparent; animation:autShimmer 2s linear infinite; }',
    /* Done: ghost style — very subtle single-line text matching Copilot’s collapsed thinking box */
    '.aut-details[data-done] .aut-label { animation:none; background:none; -webkit-text-fill-color:unset; opacity:.58; font-weight:400; font-style:normal; font-size:11px; color:var(--vscode-descriptionForeground,rgba(204,204,204,.78)); }',
    '.aut-details[data-done][data-failed] .aut-label { opacity:.95; color:var(--vscode-errorForeground,rgba(255,130,130,.9)); }',
    /* Done: compact one-line row; click arrow to inspect details. */
    '.aut-container[data-done] .aut-summary { padding:2px 4px; border-radius:5px; }',
    '.aut-container[data-done] .aut-details[open] .aut-summary { border-bottom:1px solid rgba(127,127,127,.12); border-radius:5px 5px 0 0; }',
    '.aut-label-done { }',
    '.aut-count { font-size:11px; opacity:.5; margin-left:3px; }',
    '.aut-details[data-done] .aut-count { display:none; }',
    '.aut-rows { display:flex; flex-direction:column; gap:2px; margin-top:5px; max-height:200px; overflow-y:auto; overflow-x:hidden; scroll-behavior:smooth; }',
    '.aut-details[data-done] .aut-rows { max-height:none; overflow:visible; }',
    '.aut-row { display:flex; align-items:center; gap:5px; font-size:11px; padding:1px 2px; line-height:1.55; flex-wrap:wrap; }',
    '.aut-row.state-pending { opacity:.42; }',
    '.aut-row.state-completed { opacity:.88; }',
    '.aut-row.state-failed { color:var(--vscode-errorForeground,rgba(255,130,130,.9)); opacity:1; }',
    '.aut-row.state-started { }',
    '.aut-row.state-skipped { opacity:.32; }',
    /* State icons inside rows — codicon based */
    '.aut-icon { flex-shrink:0; font-size:11px; width:14px; text-align:center; display:inline-flex; align-items:center; justify-content:center; }',
    '.aut-row.state-started .aut-icon { color:var(--vscode-charts-blue,rgba(99,179,255,.95)); }',
    '.aut-row.state-started .aut-icon .aut-spin { animation: autSpin 1.2s linear infinite; }',
    '.aut-row.state-completed .aut-icon { color:var(--vscode-charts-green,rgba(120,220,150,.9)); }',
    '.aut-row.state-failed .aut-icon { color:var(--vscode-errorForeground,rgba(255,130,130,.9)); }',
    /* File-type action icon (codicon) */
    '.aut-ficon { flex-shrink:0; font-size:10px; opacity:.5; display:inline-flex; align-items:center; }',
    '.aut-file { font-weight:600; color:var(--vscode-textLink-foreground,rgba(99,179,255,.9)); }',
    '.aut-row.state-failed .aut-file { color:inherit; }',
    '.aut-row.state-completed .aut-file { color:inherit; opacity:.82; font-weight:500; }',
    '.aut-sep { opacity:.35; font-size:10px; }',
    '.aut-analysis-body { padding:6px 8px 4px; font-size:12px; line-height:1.6; }',
    '.aut-analysis-body p { margin:0 0 6px; }',
    '.aut-analysis-body p:last-child { margin-bottom:0; }',
    '.aut-analysis-body code { font-family:var(--vscode-editor-font-family,monospace); font-size:.88em; background:rgba(127,127,127,.15); padding:1px 3px; border-radius:3px; }',
    '.aut-analysis-body ul,.aut-analysis-body ol { margin:2px 0 6px 16px; padding:0; }',
    '.aut-analysis-body li { margin-bottom:2px; }',
    '.aut-details[data-done][open] .aut-analysis-body { border-top:1px solid rgba(127,127,127,.12); margin-top:4px; padding-top:8px; }',
    '.aut-details[data-done][open] .aut-steps-list { border-top:1px solid rgba(127,127,127,.12); margin-top:4px; padding-top:4px; }',
    '.aut-details[data-done][open] .aut-rows { border-top:1px solid rgba(127,127,127,.12); margin-top:4px; padding-top:4px; }',
    '.aut-diff { font-size:10px; font-weight:700; margin-left:2px; }',
    '.aut-added { color:var(--vscode-chat-linesAddedForeground,var(--vscode-charts-green,rgba(100,220,120,.9))); }',
    '.aut-removed { color:var(--vscode-chat-linesRemovedForeground,var(--vscode-errorForeground,rgba(255,120,120,.85))); }',
    '.aut-desc { font-size:11px; opacity:.82; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }',
    '.aut-row.state-started .aut-desc { opacity:1; color:var(--vscode-charts-blue,rgba(99,179,255,.9)); }',
    '.aut-row.state-completed .aut-desc { opacity:.78; }',
    '.aut-row.state-failed .aut-desc { opacity:.88; }',
    '.aut-detail { width:100%; font-size:10px; opacity:.6; padding-left:17px; white-space:pre-wrap; word-break:break-all; margin-top:2px; }',
    /* ── Terminal confirm card (G-2/G-6) ── */
    /* ── compact terminal confirm group (G-2/G-6) ── */
    '.tc-group { border:1px solid rgba(255,180,40,.32); border-radius:6px; overflow:hidden; font-size:11px; width:100%; user-select:none; }',
    '.tc-group-hdr { display:flex; align-items:center; gap:5px; padding:3px 8px; background:rgba(255,180,40,.06); border-bottom:1px solid rgba(255,180,40,.15); font-size:10px; font-weight:600; opacity:.72; }',
    '.tc-row { display:flex; align-items:center; gap:6px; padding:3px 8px; border-top:1px solid rgba(127,127,127,.1); }',
    '.tc-row:first-of-type { border-top:none; }',
    '.tc-row-pfx { flex-shrink:0; font-size:10px; opacity:.5; }',
    '.tc-cmd-preview { font-family:var(--vscode-editor-font-family,monospace); flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px; opacity:.9; }',
    '.tc-btns { display:flex; gap:4px; flex-shrink:0; align-items:center; }',
    '.tc-btn { border:none; border-radius:4px; padding:3px 10px; cursor:pointer; font-size:11px; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); }',
    '.tc-btn:hover { background:var(--vscode-button-secondaryHoverBackground); }',
    /* G-6: Split button — Allow (main) + arrow dropdown */
    '.tc-allow-group { position:relative; display:flex; }',
    '.tc-allow-main { border-radius:4px 0 0 4px !important; background:var(--vscode-button-background) !important; color:var(--vscode-button-foreground) !important; }',
    '.tc-allow-main:hover { background:var(--vscode-button-hoverBackground) !important; }',
    '.tc-allow-arrow { border-radius:0 4px 4px 0 !important; padding:3px 6px !important; border-left:1px solid rgba(0,0,0,.18) !important; background:var(--vscode-button-background) !important; color:var(--vscode-button-foreground) !important; font-size:9px; line-height:1; }',
    '.tc-allow-arrow:hover { background:var(--vscode-button-hoverBackground) !important; }',
    '.tc-dropdown { display:none; position:absolute; top:calc(100% + 3px); left:0; z-index:60; background:var(--vscode-input-background,#1e1e1e); border:1px solid var(--vscode-widget-border,rgba(127,127,127,.4)); border-radius:4px; min-width:120px; box-shadow:0 3px 10px rgba(0,0,0,.35); }',
    '.tc-dropdown.open { display:block; }',
    '.tc-dd-item { display:block; width:100%; text-align:left; border-radius:0 !important; padding:5px 12px !important; background:transparent !important; color:var(--vscode-foreground) !important; font-size:11px; }',
    '.tc-dd-item:hover { background:var(--vscode-list-hoverBackground) !important; color:var(--vscode-list-hoverForeground,inherit) !important; }',
    '.tc-decided { font-size:11px; opacity:.6; }',
    '.intent-turn { margin-top:6px; }',
    '.intent-card { border:1px solid rgba(99,179,255,.34); border-radius:6px; background:rgba(99,179,255,.07); padding:8px; width:100%; font-size:12px; box-sizing:border-box; }',
    '.intent-card.kind-confirm { border-color:rgba(255,180,40,.38); background:rgba(255,180,40,.07); }',
    '.ic-head { display:flex; align-items:center; gap:6px; font-weight:600; line-height:1.35; }',
    '.ic-title { min-width:0; overflow-wrap:anywhere; }',
    '.ic-body { margin-top:5px; opacity:.85; line-height:1.55; overflow-wrap:anywhere; }',
    '.ic-details { margin:6px 0 0 16px; padding:0; opacity:.72; line-height:1.45; }',
    '.ic-details li { margin:2px 0; overflow-wrap:anywhere; }',
    '.ic-actions { display:grid; grid-template-columns:1fr; gap:5px; margin-top:8px; }',
    '.ic-btn { border:1px solid rgba(127,127,127,.28); border-radius:5px; padding:6px 8px; cursor:pointer; text-align:left; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); min-width:0; }',
    '.ic-btn:hover { background:var(--vscode-button-secondaryHoverBackground); }',
    '.ic-btn.primary { background:var(--vscode-button-background); color:var(--vscode-button-foreground); border-color:transparent; }',
    '.ic-btn.primary:hover { background:var(--vscode-button-hoverBackground); }',
    '.ic-btn-label { display:block; font-size:12px; font-weight:600; line-height:1.25; overflow-wrap:anywhere; }',
    '.ic-btn-desc { display:block; margin-top:2px; font-size:10px; opacity:.72; line-height:1.35; overflow-wrap:anywhere; }',
    '.ic-decided { display:inline-flex; align-items:center; min-height:24px; font-size:11px; opacity:.68; }',
    '.user-steer-turn { margin-top:2px; }',
    '.user-steer-bubble { border:1px solid rgba(99,179,255,.35); background:rgba(99,179,255,.10); }',
    '.user-steer-label { font-size:10px; opacity:.72; margin-bottom:3px; text-transform:uppercase; letter-spacing:0; }',
    '.ran-command-row { display:flex; align-items:center; gap:5px; font-size:11px; opacity:.62; padding:2px 4px; border-left:2px solid rgba(127,127,127,.28); margin:2px 0 2px 10px; }',
    '.ran-command-row .rc-cmd { font-family:var(--vscode-editor-font-family,monospace); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }',    '.ran-command-row .rc-exit { font-size:10px; opacity:.7; margin-left:4px; color:var(--vscode-errorForeground,#f44); }',
    /* ── Terminal output collapsible in working area ── */
    '.term-output-details { border-left:2px solid rgba(127,127,127,.28); margin:2px 0 2px 10px; }',
    '.term-output-summary { display:flex; align-items:center; gap:5px; font-size:11px; opacity:.7; padding:2px 4px; cursor:pointer; list-style:none; font-family:var(--vscode-editor-font-family,monospace); }',
    '.term-output-summary::-webkit-details-marker { display:none; }',
    '.term-output-summary .rc-cmd { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }',
    '.term-output-summary .rc-exit { font-size:10px; opacity:.7; margin-left:4px; color:var(--vscode-errorForeground,#f44); }',
    '.term-output-pre { font-family:var(--vscode-editor-font-family,monospace); font-size:11px; white-space:pre-wrap; word-break:break-all; margin:2px 4px 4px 4px; padding:6px 8px; background:rgba(0,0,0,.18); border-radius:4px; max-height:300px; overflow-y:auto; opacity:.88; line-height:1.45; }',
    /* ── Run-in-terminal button on code blocks ── */
    '.run-in-terminal-btn { display:inline-flex; align-items:center; gap:3px; font-size:11px; padding:1px 6px; border-radius:4px; border:1px solid rgba(127,127,127,.3); background:transparent; color:inherit; cursor:pointer; opacity:.75; }',
    '.run-in-terminal-btn:hover { opacity:1; background:rgba(127,127,127,.12); }',
    /* ── Tool activity chip (shows "Read N  Search M") ── */
    /* ── Tool-call step list (one row per read/search/list/run, Copilot-style) ── */
    '.aut-steps-list { display:flex; flex-direction:column; gap:0; margin:4px 0 2px; max-height:180px; overflow-y:auto; overflow-x:hidden; scroll-behavior:smooth; }',
    /* Done-state steps: no height limit so all steps are visible after completion */
    '.aut-details[data-done] .aut-steps-list { max-height:none; overflow:visible; opacity:.82; margin:5px 8px 6px 14px; }',
    '.aut-details[data-done] .aut-step { opacity:.78; font-size:11px; padding:2px 0; }',
    '.aut-details[data-done] .aut-rows { opacity:.7; }',
    /* Show steps inline after done — collapse arrow still works for manual hide */
    '.aut-step { display:flex; align-items:center; gap:6px; font-size:11px; padding:1px 2px; line-height:1.6; opacity:.82; }',
    '.aut-step-icon { flex-shrink:0; font-size:10px; opacity:.55; }',
    '.aut-step-text { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }',
    '.aut-step-prose { align-items:flex-start; }',
    '.aut-step-prose .aut-step-text { white-space:normal; overflow:visible; text-overflow:clip; line-height:1.5; }',
    '.aut-step-prose .aut-step-text p { margin:0; }',
    '.aut-step-details { margin-top:3px; opacity:.82; }',
    '.aut-step-details summary { cursor:pointer; list-style:none; font-size:10px; opacity:.68; user-select:none; }',
    '.aut-step-details summary::-webkit-details-marker { display:none; }',
    '.aut-step-details pre { margin:4px 0 2px; padding:6px 8px; max-height:220px; overflow:auto; white-space:pre-wrap; word-break:break-word; background:rgba(0,0,0,.16); border-radius:4px; font-family:var(--vscode-editor-font-family,monospace); font-size:10.5px; line-height:1.45; }',
    '.aut-step-text code { font-family:var(--vscode-editor-font-family,monospace); font-size:.85em; color:var(--vscode-textPreformat-foreground); background-color:var(--vscode-textPreformat-background,rgba(127,127,127,.18)); border:1px solid var(--vscode-textPreformat-border,rgba(127,127,127,.25)); padding:1px 3px; border-radius:4px; }',
    /* Terminal step: visually distinct from file ops (Copilot: chat-terminal-thinking style) */
    '.aut-step-terminal { padding:2px 4px 2px 6px; border-left:2px solid rgba(127,127,127,.38); border-radius:0 3px 3px 0; background:rgba(0,0,0,.09); margin:1px 0; }',
    '.aut-step-terminal .aut-step-icon { color:var(--vscode-terminal-foreground,inherit); opacity:.8; }',
    '.aut-step-terminal .aut-step-text code { font-family:var(--vscode-editor-font-family,monospace); color:var(--vscode-terminal-foreground,var(--vscode-textPreformat-foreground)); background:rgba(0,0,0,.18); border-color:rgba(127,127,127,.2); }',
    '.aut-details[data-done] .aut-step-terminal { border-left-color:rgba(127,127,127,.22); background:transparent; }',
    '.aut-details[data-done] .aut-step-terminal .aut-step-text code { color:inherit; }',
    '.aut-activity-summary { font-size:10px; opacity:.55; font-style:italic; margin:3px 0 4px; }',
    /* ── Analysis text injected inside finished working box ── */
    '.aut-analysis-body { margin-top:6px; padding:8px 10px 6px; border-top:1px solid rgba(127,127,127,.15); font-size:12px; line-height:1.6; max-height:400px; overflow-y:auto; }',
    '.aut-analysis-body h1,.aut-analysis-body h2,.aut-analysis-body h3 { font-size:12px; font-weight:700; margin:6px 0 2px; }',
    '.aut-analysis-body p { margin:3px 0; }',
    '.aut-analysis-body ul,.aut-analysis-body ol { padding-left:16px; margin:3px 0; }',
    '.aut-analysis-body pre { margin:4px 0; }',
    /* ── P-O: ● Status spinner row (Copilot chat-thinking-spinner-item) ── */
    '.aut-spinner-row { display:flex; align-items:center; gap:5px; padding:4px 2px; margin-top:3px; }',
    '.aut-spinner-dot { font-size:8px; opacity:0.55; color:var(--vscode-descriptionForeground); }',
    '.aut-spinner-label { font-size:var(--vscode-chat-font-size-body-s,0.923em); font-style:italic; background:linear-gradient(90deg,var(--vscode-descriptionForeground,rgba(180,180,180,.65)) 0%,var(--vscode-descriptionForeground,rgba(180,180,180,.65)) 30%,var(--vscode-chat-thinkingShimmer,rgba(255,255,255,.9)) 50%,var(--vscode-descriptionForeground,rgba(180,180,180,.65)) 70%,var(--vscode-descriptionForeground,rgba(180,180,180,.65)) 100%); background-size:400% 100%; background-clip:text; -webkit-background-clip:text; -webkit-text-fill-color:transparent; animation:autShimmer 2.5s linear infinite; }',
    '.aut-spinner-row.is-settled { opacity:.78; }',
    '.aut-spinner-settled-icon { font-size:12px; color:var(--vscode-charts-green,rgba(120,220,150,.9)); }',
    '.aut-spinner-label.is-settled { animation:none; background:none; -webkit-text-fill-color:unset; color:var(--vscode-descriptionForeground,rgba(204,204,204,.75)); font-style:normal; }',
    '.aut-spinner-label.is-settled.is-failed, .aut-spinner-row.is-settled .codicon-error { color:var(--vscode-errorForeground,rgba(255,130,130,.9)); }',
    /* ── P-P: analysis mode done = plain borderless text (Copilot: "Analyzed X" pure text line) ── */
    '.aut-container[data-done][data-analyze] { border:none !important; padding:1px 0; margin:0 0 2px 0; }',
    '.aut-container[data-analyze] .aut-details[data-done] .aut-status-icon { display:none; }',
    '.aut-container[data-analyze] .aut-details[data-done] .aut-label { opacity:0.42; font-size:11px; font-weight:400; font-style:normal; }',
    /* Analysis containers: no height limit on analysis body (per-file, one at a time) */
    '.aut-container[data-analyze] .aut-analysis-body { max-height:none; overflow-y:visible; border-top:none; padding:4px 2px 6px; }',
    /* ── collapsible code blocks in AI reply ── */
    '.collapsed-code-block { margin: 6px 0; border-left: 2px solid rgba(99,179,255,.3); padding-left: 8px; }',
    '.collapsed-code-header { display:flex; align-items:center; gap:5px; cursor:pointer; padding: 3px 0; user-select:none; font-size:11px; opacity:.75; }',
    '.collapsed-code-header:hover { opacity:1; }',
    '.collapsed-code-icon { font-size:11px; display:inline-block; transition:transform .15s ease; width:10px; text-align:center; color:var(--vscode-textLink-foreground,rgba(99,179,255,.85)); }',
    '.collapsed-code-icon.open { transform:rotate(90deg); }',
    '.collapsed-code-label { font-weight:700; font-size:10px; letter-spacing:.04em; text-transform:uppercase; color:var(--vscode-textLink-foreground,rgba(99,179,255,.85)); }',
    '.collapsed-code-linecount { font-size:10px; opacity:.45; }',
    /* ── collapsible terminal output blocks in agent replies ── */
    '.terminal-collapse { margin:4px 0; border-left:2px solid rgba(127,127,127,.2); padding-left:8px; }',
    '.terminal-collapse-summary { list-style:none; cursor:pointer; padding:2px 0; opacity:.7; font-size:12px; }',
    '.terminal-collapse-summary::-webkit-details-marker { display:none; }',
    '.terminal-collapse-summary::before { content:"▶ "; font-size:9px; color:var(--vscode-textLink-foreground,rgba(99,179,255,.85)); }',
    'details[open].terminal-collapse > .terminal-collapse-summary::before { content:"▼ "; }',
    '.terminal-collapse-summary:hover { opacity:1; }',
    '.collapsed-code-hint { font-size:10px; opacity:.5; margin-left:2px; }',
    '.collapsed-code-body { margin-top:4px; }',
    '.collapsed-code-body pre { margin:0; }',
    /* ── File Changes widget (above input area, agent done phase) ── */
    '#agent-file-changes-widget { margin:0 0 4px 0; border:1px solid var(--vscode-input-border,rgba(127,127,127,.2)); border-bottom:none; padding:4px 6px; background:var(--vscode-editor-background); border-radius:var(--vscode-cornerRadius-large,6px) var(--vscode-cornerRadius-large,6px) 0 0; overflow:hidden; user-select:none; }',  /* §13.9: matches Copilot widget style */
    '.afc-header { display:flex; align-items:center; gap:6px; }',
    '.afc-toggle { display:flex; align-items:center; gap:6px; flex:1; min-width:0; background:transparent; border:none; color:inherit; cursor:pointer; padding:2px 0; text-align:left; }',
    '.afc-toggle:hover .afc-title { text-decoration:underline; }',
    '.afc-chevron { font-size:9px; opacity:.7; flex-shrink:0; transition:transform .15s ease; }',
    '.afc-chevron.expanded { transform:rotate(90deg); }',
    '.afc-title { font-size:11px; font-weight:700; opacity:.85; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.afc-stats { font-size:10px; }',
    '.afc-added { color:var(--vscode-chat-linesAddedForeground,var(--vscode-charts-green,rgba(100,220,120,.9))); }',
    '.afc-removed { color:var(--vscode-chat-linesRemovedForeground,var(--vscode-errorForeground,rgba(255,130,130,.9))); }',
    '.afc-close { margin-left:auto; background:none; border:none; cursor:pointer; color:inherit; opacity:.45; font-size:14px; padding:0 2px; line-height:1; }',
    '.afc-close:hover { opacity:.9; }',
    '.afc-list { display:flex; flex-direction:column; gap:0; border-top:1px solid rgba(127,127,127,.12); margin-top:3px; padding-top:2px; }',
    '.afc-row { display:flex; align-items:center; gap:5px; font-size:11px; padding:2px 4px; line-height:1.4; border-radius:3px; cursor:pointer; }',
    '.afc-row:hover { background:rgba(99,179,255,.1); }',
    '.afc-row-icon { flex-shrink:0; font-size:12px; width:14px; text-align:center; opacity:.7; }',
    '.afc-row-body { flex:1; min-width:0; display:flex; flex-direction:column; }',
    '.afc-row-name { font-weight:600; color:var(--vscode-textLink-foreground,rgba(99,179,255,.9)); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.afc-row-dir { font-size:9px; opacity:.5; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '.afc-row-stat { font-size:10px; white-space:nowrap; margin-left:4px; flex-shrink:0; }',
    '.afc-hint { font-size:10px; opacity:.45; padding:2px 6px 4px; text-align:center; }',
    /* ── Agent process notes: collapsed by default, queryable after final result ── */
    '.agent-announcement-details { margin:2px 0 3px 0; border-left:2px solid rgba(99,179,255,.28); padding-left:6px; font-size:11px; color:var(--vscode-descriptionForeground,rgba(204,204,204,.72)); }',
    '.agent-announcement-summary { list-style:none; display:flex; align-items:center; gap:5px; min-width:0; cursor:pointer; line-height:1.45; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '.agent-announcement-summary::-webkit-details-marker { display:none; }',
    '.agent-announcement-summary .codicon { flex-shrink:0; font-size:12px; opacity:.72; }',
    '.agent-announcement-summary span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
    '.agent-announcement-body { margin:4px 0 5px 0; line-height:1.5; color:var(--vscode-foreground); opacity:.9; overflow-wrap:anywhere; }',
    /* ── §8.5 Queue indicator ── */
    '#agent-queue-indicator { display:none; align-items:center; gap:5px; font-size:11px; padding:3px 6px 3px 8px; background:rgba(99,179,255,.07); border:1px solid rgba(99,179,255,.22); border-radius:5px; margin-bottom:3px; }',
    '.aqi-icon { flex-shrink:0; font-size:11px; }',
    '.aqi-text { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; opacity:.82; }',
    '.aqi-steer { border:none; background:rgba(99,179,255,.18); color:var(--vscode-textLink-foreground,rgba(99,179,255,.9)); border-radius:3px; padding:2px 7px; font-size:10px; cursor:pointer; white-space:nowrap; flex-shrink:0; }',
    '.aqi-steer:hover { background:rgba(99,179,255,.32); }',
    '.aqi-cancel { border:none; background:none; color:inherit; opacity:.45; cursor:pointer; font-size:13px; padding:0 2px; line-height:1; flex-shrink:0; }',
    '.aqi-cancel:hover { opacity:.9; }',
  ].join('\n');
  document.head.appendChild(style);
}

function toggleCollapsedCode(uid) {
  var body = document.getElementById(uid);
  if (!body) return;
  var block = body.closest('.collapsed-code-block');
  var icon = block ? block.querySelector('.collapsed-code-icon') : null;
  var hint = block ? block.querySelector('.collapsed-code-hint') : null;
  var isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (icon) { icon.classList.toggle('open', !isOpen); }
  if (hint) { hint.textContent = isOpen ? '点击展开' : '点击折叠'; }
  if (!isOpen) { addCodeToolbars(block); }
}

/**
 * G-2: Render an inline terminal-confirm card when the agent wants to run a command.
 * User can click Allow / Always Allow / Skip — no VS Code modal popup.
 */
function handleTerminalConfirm(msg) {
  var cmdFull = (msg.command || '');
  var cmdSafe = escapeHtml(cmdFull.slice(0, 600));
  var cmdPreview = escapeHtml(cmdFull.length > 120 ? cmdFull.slice(0, 120) + '\u2026' : cmdFull);
  var cidSafe = escapeHtml(msg.confirmId || '');
  var ddId = 'tc-dd-' + cidSafe;
  // Append to existing tc-group-wrap at bottom, or create a new one
  var lastEl = messagesEl ? messagesEl.lastElementChild : null;
  var groupWrap = (lastEl && lastEl.classList && lastEl.classList.contains('tc-group-wrap')) ? lastEl : null;
  if (!groupWrap) {
    var wrap = document.createElement('div');
    wrap.className = 'turn assistant-turn tc-group-wrap';
    markTurnEnter(wrap);
    var groupEl = document.createElement('div');
    groupEl.className = 'tc-group';
    var hdr = document.createElement('div');
    hdr.className = 'tc-group-hdr';
    hdr.innerHTML = '<i class="codicon codicon-terminal" style="font-size:10px"></i><span>AI 想要执行终端命令</span>';
    groupEl.appendChild(hdr);
    wrap.appendChild(groupEl);
    messagesEl.appendChild(wrap);
    groupWrap = wrap;
  }
  var groupEl = groupWrap.querySelector('.tc-group');
  var row = document.createElement('div');
  row.className = 'tc-row';
  row.setAttribute('data-confirm-id', cidSafe);
  row.innerHTML = '<span class="tc-row-pfx">$</span>'
    + '<span class="tc-cmd-preview" title="' + cmdSafe + '">' + cmdPreview + '</span>'
    + '<div class="tc-btns">'
    + '<div class="tc-allow-group">'
    + '<button class="tc-btn tc-allow-main" data-confirm-id="' + cidSafe + '" data-allow="true">允许</button>'
    + '<button class="tc-btn tc-allow-arrow" data-confirm-id="' + cidSafe + '" data-dd="' + ddId + '" title="更多选项">▾</button>'
    + '<div class="tc-dropdown" id="' + ddId + '">'
    + '<button class="tc-btn tc-dd-item" data-confirm-id="' + cidSafe + '" data-allow="true" data-always="true">本会话允许同类</button>'
    + '</div>'
    + '</div>'
    + '<button class="tc-btn tc-skip" data-confirm-id="' + cidSafe + '" data-allow="false">跳过</button>'
    + '</div>';
  groupEl.appendChild(row);
  maybeScrollToBottom();
}

function handleIntentConfirmation(msg) {
  if (!messagesEl || !msg || !msg.request) return;
  var request = msg.request || {};
  var requestId = String(request.id || ('intent-' + Date.now()));
  pendingIntentConfirmations.set(requestId, request);

  var turn = document.createElement('div');
  turn.className = 'turn assistant-turn intent-turn';
  markTurnEnter(turn);

  var card = document.createElement('div');
  card.className = 'intent-card kind-' + escapeHtml(request.kind || 'clarify');
  card.setAttribute('data-interaction-id', requestId);

  var title = escapeHtml(request.title || '需要确认');
  var body = escapeHtml(request.body || '');
  var details = Array.isArray(request.details) ? request.details : [];
  var options = Array.isArray(request.options) ? request.options : [];
  var detailHtml = details.length
    ? '<ul class="ic-details">' + details.map(function(item) {
        return '<li>' + escapeHtml(item) + '</li>';
      }).join('') + '</ul>'
    : '';
  var optionHtml = options.map(function(option, index) {
    var id = escapeHtml(option.id || '');
    var label = escapeHtml(option.label || '继续');
    var description = escapeHtml(option.description || '');
    var primaryClass = index === 0 ? ' primary' : '';
    return '<button class="ic-btn' + primaryClass + '" data-interaction-id="' + escapeHtml(requestId) + '" data-action="' + id + '" data-option-index="' + index + '" title="' + description + '">'
      + '<span class="ic-btn-label">' + label + '</span>'
      + (description ? '<span class="ic-btn-desc">' + description + '</span>' : '')
      + '</button>';
  }).join('');

  card.innerHTML = '<div class="ic-head">'
    + '<i class="codicon codicon-question" style="font-size:12px"></i>'
    + '<span class="ic-title">' + title + '</span>'
    + '</div>'
    + (body ? '<div class="ic-body">' + body + '</div>' : '')
    + detailHtml
    + '<div class="ic-actions">' + optionHtml + '</div>';

  turn.appendChild(card);
  messagesEl.appendChild(turn);
  ensureWorkingAreaAttached();
  maybeScrollToBottom();
}

function addPendingActionNoticeCard(msg) {
  if (!messagesEl || !msg) return;
  var isUndo = msg.action === 'undo';

  // ── Copilot style: update existing summary card in-place ──
  var allSummaryCards = messagesEl.querySelectorAll('.summary-card[data-agent-summary]');
  var lastSummaryCard = allSummaryCards.length ? allSummaryCards[allSummaryCards.length - 1] : null;

  if (lastSummaryCard) {
    var fileBtns = lastSummaryCard.querySelectorAll('.summary-file[data-file-path]');
    var iconTxt = isUndo ? '\u21a9\u202f' : '\u2713\u202f';
    var statusClass = isUndo ? 'status-undone' : 'status-kept';

    if (msg.scope === 'all' || !msg.path) {
      fileBtns.forEach(function(btn) {
        btn.classList.add(statusClass);
        var base = (btn.getAttribute('data-file-path') || '').split('/').pop() || btn.getAttribute('data-file-path') || '';
        btn.textContent = iconTxt + base;
      });
    } else {
      fileBtns.forEach(function(btn) {
        if (btn.getAttribute('data-file-path') === msg.path) {
          btn.classList.add(statusClass);
          var base = (msg.path || '').split('/').pop() || msg.path;
          btn.textContent = iconTxt + base;
        }
      });
    }

    var remaining = typeof msg.queueTotal === 'number' ? msg.queueTotal : -1;
    var titleEl = lastSummaryCard.querySelector('.summary-title');
    if (titleEl) {
      if (remaining === 0) {
        titleEl.textContent = isUndo ? '\u5df2\u5b8c\u6210 \u00b7 \u5df2\u64a4\u9500' : '\u5df2\u5b8c\u6210 \u00b7 \u5df2\u4fdd\u7559';
      } else if (remaining > 0) {
        titleEl.textContent = '\u5df2\u5b8c\u6210\uff0c\u8fd8\u5269 ' + remaining + ' \u4e2a\u6587\u4ef6\u5f85\u786e\u8ba4';
      }
    }

    var hintEl = lastSummaryCard.querySelector('.summary-action-hint');
    if (hintEl && remaining === 0) hintEl.remove();

    lastSummaryCard.setAttribute('data-resolved', isUndo ? 'undone' : 'kept');
    maybeScrollToBottom();
    return;
  }

  // ── Fallback: no summary card (non-agent mode) ──
  if (!msg.detail) return;
  var wrap = document.createElement('div');
  wrap.className = 'turn assistant-turn';
  markTurnEnter(wrap);
  var line = document.createElement('div');
  line.className = 'agent-done-line' + (isUndo ? '' : ' state-completed');
  line.innerHTML = '<span class="agent-done-icon">' + (isUndo ? '\u21a9' : '\u2713') + '</span>'
    + '<span class="agent-done-text">' + escapeHtml(msg.detail) + '</span>';
  wrap.appendChild(line);
  messagesEl.appendChild(wrap);
  maybeScrollToBottom();
}

function injectPendingEditsStyles() {
  var style = document.createElement('style');
  style.textContent = [
    /* 容器 */
    '#pending-edits-area { display:none; padding: 0 8px 6px; }',
    '#pending-edits-area.show { display:block; }',
    '.pe-card { border:1px solid var(--vscode-input-border,rgba(127,127,127,.22)); border-radius:4px; background:var(--vscode-editor-background); overflow:hidden; }',
    /* ── L1 摘要行 ── */
    '.pe-summary { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 10px; }',
    '.pe-toggle-btn { display:flex; align-items:center; gap:6px; background:transparent; border:none; color:inherit; cursor:pointer; font-size:12px; font-weight:700; padding:0; flex:1; text-align:left; min-width:0; }',
    '.pe-toggle-btn:hover .pe-summary-text { text-decoration:underline; }',
    '.pe-chevron { font-size:9px; opacity:.7; flex-shrink:0; transition: transform .15s ease; }',
    '.pe-chevron.expanded { transform: rotate(90deg); }',
    '.pe-summary-text { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '.pe-summary-delta { font-weight:400; opacity:.78; margin-left:6px; }',
    '.pe-actions { display:flex; flex-wrap:nowrap; gap:5px; flex-shrink:0; }',
    '.pe-btn { font-size:10px; padding:2px 8px; border:none; border-radius:4px; cursor:pointer; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); white-space:nowrap; }',
    '.pe-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }',
    '.pe-btn.pe-btn-accent { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }',
    '.pe-btn.pe-btn-accent:hover { background: var(--vscode-button-hoverBackground); }',
    '.pe-added { color:var(--vscode-chat-linesAddedForeground,var(--vscode-charts-green,rgba(120,220,150,.9))); }',
    '.pe-removed { color:var(--vscode-chat-linesRemovedForeground,var(--vscode-errorForeground,rgba(255,120,120,.9))); }',
    /* ── L2 文件列表 ── */
    '@keyframes peListIn { from { opacity:0; transform: translateY(-4px); } to { opacity:1; transform: translateY(0); } }',    /* F2 */
    '.pe-list { border-top:1px solid var(--vscode-input-border,rgba(127,127,127,.18)); display:flex; flex-direction:column; animation: peListIn .15s ease-out; }',
    '.pe-item { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 10px; border-bottom:1px solid rgba(127,127,127,.12); cursor:pointer; transition: background .1s; }',
    '.pe-item:last-child { border-bottom:none; }',
    '.pe-item:hover { background: rgba(99,179,255,.1); }',
    '.pe-file-info { min-width:0; flex:1; display:flex; flex-direction:column; }',
    '.pe-basename { font-size:12px; font-weight:700; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '.pe-dirname { font-size:10px; opacity:.65; line-height:1.3; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',    /* F1: readable opacity */
    '.pe-file-right { display:flex; align-items:center; gap:5px; flex-shrink:0; }',
    '.pe-delta { font-size:10px; opacity:.78; white-space:nowrap; }',
    /* ── L3 hunk 行 ── */
    '.pe-file-chevron { font-size:9px; opacity:.65; flex-shrink:0; transition:transform .15s ease; margin-right:4px; }',
    '.pe-file-chevron.expanded { transform:rotate(90deg); }',
    '.pe-placeholder { visibility:hidden; font-size:9px; margin-right:4px; }',
    '.pe-editor-hint { padding:6px 10px; font-size:11px; color:var(--vscode-descriptionForeground); border-top:1px solid rgba(127,127,127,.12); }',
    '.pe-hunk-list { border-top:1px solid rgba(110,170,255,.15); }',
    '.pe-hunk-row { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 10px 4px 24px; border-bottom:1px solid rgba(127,127,127,.08); font-size:11px; }',
    '.pe-hunk-row:last-child { border-bottom:none; }',
    '.pe-hunk-row.status-kept { opacity:.65; }',
    '.pe-hunk-row.status-undone { opacity:.45; text-decoration:line-through; }',
    '.pe-hunk-info { min-width:0; flex:1; display:flex; align-items:center; gap:6px; }',
    '.pe-hunk-title { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:.9; }',
    '.pe-hunk-line { font-size:10px; opacity:.55; flex-shrink:0; }',
    '.pe-hunk-right { display:flex; align-items:center; gap:5px; flex-shrink:0; }',
    '.pe-hunk-actions { display:flex; gap:3px; }',
    '.pe-hunk-btn { font-size:10px; padding:1px 6px; border:none; border-radius:3px; cursor:pointer; background:var(--vscode-button-secondaryBackground); color:var(--vscode-button-secondaryForeground); white-space:nowrap; }',
    '.pe-hunk-btn:hover { background:var(--vscode-button-secondaryHoverBackground); }',
    '.pe-hunk-btn.pe-btn-accent { background:var(--vscode-button-background); color:var(--vscode-button-foreground); }',
    '.pe-hunk-btn.pe-btn-accent:hover { background:var(--vscode-button-hoverBackground); }',
    '.pe-hunk-status { font-size:10px; }',
    '.pe-hunk-status-kept { color:rgba(120,220,150,.9); }',
    '.pe-hunk-status-undone { color:rgba(255,120,120,.9); }',
  ].join('\n');
  document.head.appendChild(style);
}

function renderPendingEdits() {
  if (!editsEl) return;
  if (!pendingEdits || pendingEdits.length === 0) {
    editsEl.classList.remove('show');
    editsEl.innerHTML = '';
    pendingHunkExpandState = {};
    pendingEditsListExpanded = false;
    syncGeneratedPanelsVisibility();
    return;
  }
  // Hide the legacy agent-file-changes widget while the Copilot-style Keep/Undo
  // review widget is visible; otherwise the same files appear twice.
  if (fileChangesWidgetEl) {
    fileChangesWidgetEl.style.display = 'none';
    fileChangesWidgetEl.innerHTML = '';
    fileChangesListExpanded = false;
  }

  // 计算全局 delta 汇总（+X -Y）
  var totalAdded = 0, totalRemoved = 0;
  pendingEdits.forEach(function(item) {
    totalAdded += (item.added || 0);
    totalRemoved += (item.removed || 0);
  });
  var fileCount = pendingEdits.length;
  var globalDeltaHtml = '<span class="pe-summary-delta">+'
    + totalAdded + '&nbsp;<span class="pe-removed">-' + totalRemoved + '</span></span>';

  // ── L2：展开后的文件列表 ──
  var fileListHtml = '';
  if (pendingEditsListExpanded) {
    var rows = pendingEdits.map(function(item) {
      var itemAdded = item.added || 0;
      var itemRemoved = item.removed || 0;
      var deltaHtml = '<span class="pe-added">+' + itemAdded + '</span>'
        + '&nbsp;<span class="pe-removed">-' + itemRemoved + '</span>';

      var fullPath = item.path || '';
      var pathBasename = fullPath.split('/').pop() || fullPath;
      var pathDirname = fullPath.includes('/') ? fullPath.slice(0, fullPath.lastIndexOf('/') + 1) : '';
      // Copilot 风格：前缀 workspace 文件夹名，再接目录路径
      var wsName = (typeof window.__wsFolderName === 'string' && window.__wsFolderName)
        ? window.__wsFolderName : '';
      var dirLabel = wsName
        ? (wsName + (pathDirname ? (' \u2022 ' + pathDirname) : ''))
        : pathDirname;

      var fileChevron = '<span class="pe-placeholder">\u25b6</span>';

      var fileRow = '<div class="pe-item" data-pe-toggle-hunks="' + escapeHtml(item.id) + '" title="点击在编辑器中查看差异">'
        + fileChevron
        + '<div class="pe-file-info">'
        + '<span class="pe-basename">' + escapeHtml(pathBasename) + '</span>'
        + (dirLabel ? '<span class="pe-dirname">' + escapeHtml(dirLabel) + '</span>' : '')
        + '</div>'
        + '<div class="pe-file-right">'
        + '<span class="pe-delta">' + deltaHtml + '</span>'
        + '</div>'
        + '</div>';

      return fileRow;
    }).join('');
    fileListHtml = '<div class="pe-list">' + rows + '</div>';
  }

  // ── L1：摘要行 ──
  var chevronClass = 'pe-chevron' + (pendingEditsListExpanded ? ' expanded' : '');
  var summaryHtml = '<div class="pe-summary">'
    + '<button class="pe-toggle-btn" data-pe-toggle="1">'
    + '<span class="' + chevronClass + '">▶</span>'
    + '<span class="pe-summary-text">'
    + fileCount + ' 个文件待确认'
    + '&nbsp;&nbsp;' + globalDeltaHtml
    + '</span>'
    + '</button>'
    + '<div class="pe-actions">'
    + '<button class="pe-btn pe-btn-accent" data-pe-keep-all="1">全部保留</button>'
    + '<button class="pe-btn" data-pe-undo-all="1">全部撤销</button>'
    + '</div>'
    + '</div>';

  editsEl.classList.add('show');
  editsEl.innerHTML = '<div class="pe-card">' + summaryHtml + fileListHtml
    + (fileCount > 0 ? '<div class="pe-editor-hint">点击文件在编辑器中查看差异；逐个修改点在编辑区处理。</div>' : '')
    + '</div>';

  // ── 事件：点击摘要行展开/折叠 ──
  var toggleBtn = editsEl.querySelector('[data-pe-toggle]');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function() {
      pendingEditsListExpanded = !pendingEditsListExpanded;
      renderPendingEdits();
    });
  }

  // ── 事件：点击文件行打开 VS Code 编辑器；逐个变更点在编辑区用 CodeLens Keep / Undo 处理 ──
  editsEl.querySelectorAll('[data-pe-toggle-hunks]').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('.pe-hunk-btn')) return;
      var id = el.getAttribute('data-pe-toggle-hunks');
      var item = pendingEdits.find(function(entry) { return entry.id === id; });
      if (!item) return;
      var firstHunk = item.hunks && item.hunks.length > 0 ? item.hunks[0] : null;
      vscode.postMessage({ type: 'openPendingEdit', editId: id, path: item.path, hunkLine: firstHunk && firstHunk.line ? firstHunk.line : undefined });
    });
  });

  // ── 事件：hunk 级 Keep / Undo ──
  editsEl.querySelectorAll('[data-pe-keep-hunk]').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      vscode.postMessage({ type: 'keepPendingHunk', editId: el.getAttribute('data-edit-id'), hunkId: el.getAttribute('data-hunk-id') });
    });
  });
  editsEl.querySelectorAll('[data-pe-undo-hunk]').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      vscode.postMessage({ type: 'undoPendingHunk', editId: el.getAttribute('data-edit-id'), hunkId: el.getAttribute('data-hunk-id') });
    });
  });

  // ── 事件：全局 Keep / Undo ──
  var keepAllBtn = editsEl.querySelector('[data-pe-keep-all]');
  if (keepAllBtn) {
    keepAllBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'keepAllPendingEdits' });
    });
  }
  var undoAllBtn = editsEl.querySelector('[data-pe-undo-all]');
  if (undoAllBtn) {
    undoAllBtn.addEventListener('click', function() {
      vscode.postMessage({ type: 'undoAllPendingEdits' });
    });
  }

  syncGeneratedPanelsVisibility();
}

function syncGeneratedPanelsVisibility() {
  var shouldHide = Array.isArray(pendingEdits) && pendingEdits.length > 0;
  document.querySelectorAll('.generated-files-panel').forEach(function(panel) {
    panel.style.display = shouldHide ? 'none' : '';

    var prev = panel.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains('assistant-generated-summary')) {
      prev.style.display = shouldHide ? 'none' : '';
    }
  });
}

function addCompletionSummaryCard() {
  if (!messagesEl || completionSummaryEmitted) return;
  // In agent mode the done card already summarizes everything; skip the generic footnote
  if (isAgentMode) { completionSummaryEmitted = true; return; }

  var refs = getResponseMetaPathRefs();
  var queueCount = Array.isArray(pendingEdits) ? pendingEdits.length : 0;
  // Pending edits already render a Copilot-style File Changes/Keep/Undo widget.
  // Do not add the extra green completion card; it duplicates the same information
  // and makes the input area look cluttered.
  if (queueCount > 0) {
    completionSummaryEmitted = true;
    completionSummaryHasQueue = true;
    return;
  }
  var expectedCount = extractRequestedFileCount(currentRequestPrompt);
  var previewRefs = refs.slice(0, 3);
  var hasFiles = refs.length > 0 || queueCount > 0;

  if (queueCount > 0) completionSummaryHasQueue = true;

  // 捕获执行步骤快照（在 resetWorkingArea 之前调用，entries 仍在）
  var stepsSnapshot = Array.from(workingEntries.values()).sort(function(a, b) {
    return a.updatedAt - b.updatedAt;
  });

  // 如果没有文件 artifact 也没有 workflow 步骤，跳过
  // Copilot 风格：非 agent 模式的普通回复不显示步骤摘要 — 只在有文件输出时才显示
  if (!hasFiles) {
    completionSummaryEmitted = true;
    return;
  }

  var wrap = document.createElement('div');
  wrap.className = 'turn assistant-turn';
  markTurnEnter(wrap);

  // ── Copilot 风格：小字脚注行 "已完成 · N 步  ›" ──
  // 仅在有失败步骤或有非平凡工作流步骤时显示，避免为普通 request+response 2步骤生成噪音
  var blockedSteps = stepsSnapshot.filter(function(s) { return isQualityGateBlockedText((s.title || '') + '\n' + (s.detail || '')); }).length;
  var failedSteps = Math.max(0, stepsSnapshot.filter(function(s) { return s.state === 'failed'; }).length - blockedSteps);
  var nonTrivialSteps = stepsSnapshot.filter(function(s) {
    return s.state === 'failed' || s.title === '编译验证' || s.title === '写入文件' || s.title === '自动修复' || /^QualityGate\b/.test(s.title || '');
  }).length;
  if (stepsSnapshot.length > 0 && (failedSteps > 0 || nonTrivialSteps > 0)) {
    var footnote = document.createElement('div');
    footnote.className = 'fsr-row';
    var fsrBtnClass = (failedSteps > 0 || blockedSteps > 0) ? 'fsr-btn fsr-btn-warn' : 'fsr-btn';    /* W2 */
    var fsrLabelText = failedSteps > 0
      ? ('已完成 · ' + failedSteps + ' 失败')
      : blockedSteps > 0
        ? ('已完成 · ' + blockedSteps + ' 阻塞')
      : '已完成';    /* W2 */
    var fsrInner = '<button class="' + fsrBtnClass + '">'
      + '<span class="fsr-label">' + fsrLabelText + '</span>'
      + '<span class="fsr-sep">·</span>'
      + '<span class="fsr-count">' + stepsSnapshot.length + ' 步</span>'
      + '<span class="fsr-chevron">›</span>'    /* W4: single char, rotates via CSS */
      + '</button>'
      + '<div class="fsr-body">'    /* W3: no inline display:none, use CSS class */
      + stepsSnapshot.map(function(e, idx) {
          return '<div class="fsr-step state-' + (e.state || 'started') + '">'
            + '<span class="fsr-step-num">' + (idx + 1) + '</span>'
            + '<div class="fsr-step-content">'
            + '<div class="fsr-step-title">' + escapeHtml(e.title || '') + '</div>'
            + (e.detail ? '<div class="fsr-step-detail">' + escapeHtml(e.detail) + '</div>' : '')
            + '</div>'
            + '</div>';
        }).join('')
      + '</div>';
    footnote.innerHTML = fsrInner;

    var fsrBtn = footnote.querySelector('.fsr-btn');
    var fsrBody = footnote.querySelector('.fsr-body');
    fsrBtn.addEventListener('click', function() {    /* W3+W4: class-based toggle */
      var isOpen = fsrBtn.classList.contains('fsr-open');
      fsrBtn.classList.toggle('fsr-open');
      fsrBody.classList.toggle('fsr-open');
    });
    wrap.appendChild(footnote);
  }

  // ── 文件摘要 card（仅在有文件 artifact 或 queue 时显示）──
  if (hasFiles) {
    var title = '已完成';
    if (refs.length > 0 && queueCount > 0) {
      title = '已完成：识别 ' + refs.length + ' 个候选，待确认 ' + queueCount + ' 个文件';
    } else if (queueCount > 0) {
      title = '已完成：' + queueCount + ' 个文件待确认';
    } else if (refs.length > 0) {
      title = '已完成：识别到 ' + refs.length + ' 个候选文件';
    }

    var sub = '';
    if (expectedCount > 0 && refs.length > 0) {
      sub = '目标 ' + expectedCount + ' 个文件，当前识别 ' + refs.length + ' 个。';
    } else if (refs.length > 0) {
      sub = '已切换为文件映射视图。';
    }
    var actionHint = queueCount > 0
      ? '下一步：使用 Keep/Undo 处理全部或按文件细化。'
      : '下一步：点击文件可打开查看。';

    var card = document.createElement('div');
    card.className = 'summary-card';
    card.setAttribute('data-agent-summary', 'true');
    card.innerHTML = '<div class="summary-title">' + escapeHtml(title) + '</div>'
      + (sub ? '<div class="summary-sub">' + escapeHtml(sub) + '</div>' : '')
      + '<div class="summary-files"></div>'
      + '<div class="summary-actions summary-action-hint">' + escapeHtml(actionHint) + '</div>';

    var filesEl = card.querySelector('.summary-files');
    previewRefs.forEach(function(item) {
      var btn = document.createElement('button');
      btn.className = 'summary-file';
      btn.setAttribute('data-file-path', item.path);
      btn.textContent = item.path.split('/').pop() || item.path;    /* W5: basename */
      btn.title = item.path;
      btn.addEventListener('click', function() {
        vscode.postMessage({
          type: 'openGeneratedPath',
          path: item.path,
          prompt: currentRequestPrompt,
          files: currentResponseMeta.pathHints || []
        });
      });
      filesEl.appendChild(btn);
    });
    if (refs.length > previewRefs.length && filesEl) {
      var extra = document.createElement('span');
      extra.className = 'summary-actions';
      extra.textContent = '还有 ' + (refs.length - previewRefs.length) + ' 个文件';
      filesEl.appendChild(extra);
    }
    wrap.appendChild(card);
  }

  messagesEl.appendChild(wrap);
  completionSummaryEmitted = true;
  maybeScrollToBottom();
}

function addQueueReadySummaryCard() {
  if (!messagesEl) return;
  // In agent mode the done card + files-changed panel already give full context.
  // Showing this extra "文件修改队列已就绪" card is redundant noise.
  if (isAgentMode) { completionSummaryHasQueue = true; return; }
  var queueCount = Array.isArray(pendingEdits) ? pendingEdits.length : 0;
  if (queueCount <= 0 || completionSummaryHasQueue) return;
  var queuePaths = pendingEdits.slice(0, 3).map(function(item) { return item.path; }).filter(Boolean);

  var wrap = document.createElement('div');
  wrap.className = 'turn assistant-turn';
  markTurnEnter(wrap);

  var card = document.createElement('div');
  card.className = 'summary-card';
  card.innerHTML = '<div class="summary-title">文件修改队列已就绪：' + queueCount + ' 个文件</div>'
    + '<div class="summary-sub">你可以先 Keep/Undo 全部，再按文件或修改点细化。</div>'
    + '<div class="summary-files"></div>';

  var filesEl = card.querySelector('.summary-files');
  queuePaths.forEach(function(path) {
    var btn = document.createElement('button');
    btn.className = 'summary-file';
    btn.textContent = path.split('/').pop() || path;    /* W6: basename */
    btn.title = path;
    btn.addEventListener('click', function() {
      var item = pendingEdits.find(function(entry) { return entry.path === path; });
      if (!item) return;
      vscode.postMessage({ type: 'openPendingEdit', editId: item.id, path: item.path });
    });
    filesEl.appendChild(btn);
  });

  wrap.appendChild(card);
  messagesEl.appendChild(wrap);
  completionSummaryHasQueue = true;
  maybeScrollToBottom();
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-file streaming analysis cards (Copilot/Claude Code style)
// Each file gets its own collapsible card that streams in real-time.
// Cards are routed via \x00AFILE:filename\x00 and \x00ASUM\x00 delta prefixes.
// ─────────────────────────────────────────────────────────────────────────────

function injectAnalyzeCardStyles() {
  var style = document.createElement('style');
  style.id = 'analyze-card-styles';
  style.textContent = [
    '.af-container { margin: 8px 0 4px 0; border-radius: 6px; border: 1px solid var(--vscode-panel-border, rgba(204,204,204,0.2)); background: var(--vscode-sideBar-background, transparent); overflow: hidden; }',
    '.af-card { border-bottom: 1px solid var(--vscode-panel-border, rgba(204,204,204,0.15)); }',
    '.af-card:last-child { border-bottom: none; }',
    '.af-header { display: flex; align-items: center; padding: 7px 10px; cursor: pointer; user-select: none; gap: 6px; }',
    '.af-header:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04)); }',
    '.af-icon { flex-shrink: 0; font-size: 13px; width: 16px; text-align: center; }',
    '.af-icon .codicon-check { color: var(--vscode-testing-iconPassed, #6ee7b7); }',
    '.af-icon .codicon-error { color: var(--vscode-testing-iconFailed, #f87171); }',
    '.af-filename { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.86em; font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.af-progress { font-size: 0.78em; color: var(--vscode-descriptionForeground, #888); flex-shrink: 0; }',
    '.af-toggle { flex-shrink: 0; font-size: 10px; color: var(--vscode-descriptionForeground, #666); transition: transform 0.15s ease; }',
    '.af-card.af-collapsed .af-toggle { transform: rotate(-90deg); }',
    '.af-card.af-collapsed .af-body { display: none; }',
    '.af-body { padding: 8px 14px 12px; font-size: 0.9em; line-height: 1.6; border-top: 1px solid var(--vscode-panel-border, rgba(204,204,204,0.1)); }',
    '.af-streaming { color: var(--vscode-descriptionForeground, #888); font-style: italic; font-size: 0.88em; }',
    '.af-summary-card { margin: 0; padding: 10px 12px 12px; background: var(--vscode-textBlockQuote-background, rgba(100,100,100,0.08)); border-top: 2px solid var(--vscode-activityBarBadge-background, #0e639c); }',
    '.af-summary-title { font-size: 0.83em; font-weight: 600; color: var(--vscode-activityBarBadge-background, #3794ff); margin-bottom: 6px; display: flex; align-items: center; gap: 5px; letter-spacing: 0.02em; text-transform: uppercase; }',
    '.af-summary-body { font-size: 0.9em; line-height: 1.6; }',
  ].join('\n');
  document.head.appendChild(style);
}

function injectVisionStyles() {
  var s = document.createElement('style');
  s.textContent = [
    '.img-badge { display:inline-flex; align-items:center; padding:2px 4px; gap:4px; }',
    '.img-badge-thumb { width:40px; height:40px; object-fit:cover; border-radius:3px; border:1px solid var(--vscode-widget-border,#ccc); }',
    '.user-bubble-images { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; }',
    '.user-bubble-img { max-width:180px; max-height:120px; border-radius:4px; border:1px solid var(--vscode-widget-border,#ccc); object-fit:contain; cursor:zoom-in; }',
    '.user-bubble-img:hover { opacity:0.85; }',
  ].join('\n');
  document.head.appendChild(s);
}

function ensureAnalyzeContainer() {
  if (analyzeContainerEl && analyzeContainerEl.isConnected) return analyzeContainerEl;
  analyzeContainerEl = document.createElement('div');
  analyzeContainerEl.className = 'af-container';
  if (messagesEl) messagesEl.appendChild(analyzeContainerEl);
  return analyzeContainerEl;
}

function createAnalyzeFileCard(filename, index, total) {
  var container = ensureAnalyzeContainer();
  var card = document.createElement('div');
  card.className = 'af-card';
  var header = document.createElement('div');
  header.className = 'af-header';
  header.innerHTML = '<span class="af-icon"><i class="codicon codicon-loading aut-spin"></i></span>'
    + '<span class="af-filename">' + escapeHtml(filename) + '</span>'
    + '<span class="af-progress">(' + index + '/' + total + ')</span>'
    + '<span class="af-toggle codicon codicon-chevron-down"></span>';
  header.addEventListener('click', function() { card.classList.toggle('af-collapsed'); });
  var body = document.createElement('div');
  body.className = 'af-body';
  body.innerHTML = '<span class="af-streaming">正在分析…</span>';
  card.appendChild(header);
  card.appendChild(body);
  container.appendChild(card);
  analyzeCards.set(filename, { el: card, body: body, raw: '' });
  maybeScrollToBottom();
}

function updateAnalyzeFileDelta(filename, text) {
  var obj = analyzeCards.get(filename);
  if (!obj) return;
  if (text.startsWith('\x00RESET\x00')) {
    obj.raw = text.slice(7);
  } else {
    obj.raw += text;
  }
  obj.body.innerHTML = md(obj.raw) + '<span class="cursor"></span>';
  addCodeToolbars(obj.body);
  maybeScrollToBottom();
}

function finalizeAnalyzeFileCard(filename, success) {
  var obj = analyzeCards.get(filename);
  if (!obj) return;
  var iconEl = obj.el.querySelector('.af-icon i');
  if (iconEl) {
    iconEl.className = success !== false ? 'codicon codicon-check' : 'codicon codicon-error';
  }
  obj.body.innerHTML = md(obj.raw);
  enhanceCodeVisuals(obj.body);
  renderMermaidBlocks(obj.body).then(function() { addCodeToolbars(obj.body); });
  // Auto-collapse after short delay so the next card is more visible
  setTimeout(function() { obj.el.classList.add('af-collapsed'); }, 800);
  maybeScrollToBottom();
}

function createAnalyzeSummaryCard() {
  var container = ensureAnalyzeContainer();
  var card = document.createElement('div');
  card.className = 'af-summary-card';
  var title = document.createElement('div');
  title.className = 'af-summary-title';
  title.innerHTML = '<i class="codicon codicon-book"></i> 综合总结';
  var body = document.createElement('div');
  body.className = 'af-summary-body';
  body.innerHTML = '<span class="af-streaming">正在生成总结…</span>';
  card.appendChild(title);
  card.appendChild(body);
  container.appendChild(card);
  analyzeSummaryCardObj = { el: card, body: body, raw: '' };
  maybeScrollToBottom();
}

function updateAnalyzeSummaryDelta(text) {
  if (!analyzeSummaryCardObj) return;
  if (text.startsWith('\x00RESET\x00')) {
    analyzeSummaryCardObj.raw = text.slice(7);
  } else {
    analyzeSummaryCardObj.raw += text;
  }
  analyzeSummaryCardObj.body.innerHTML = md(analyzeSummaryCardObj.raw) + '<span class="cursor"></span>';
  addCodeToolbars(analyzeSummaryCardObj.body);
  maybeScrollToBottom();
}

function finalizeAnalyzeSummaryCard() {
  if (!analyzeSummaryCardObj) return;
  var body = analyzeSummaryCardObj.body;
  body.innerHTML = md(analyzeSummaryCardObj.raw);
  enhanceCodeVisuals(body);
  renderMermaidBlocks(body).then(function() { addCodeToolbars(body); maybeScrollToBottom(); });
  analyzeSummaryCardObj = null;
}

function resetWorkingArea() {
  var options = arguments[0] || {};
  var immediate = options.immediate === true;
  if (workingResetTimer) {
    clearTimeout(workingResetTimer);
    workingResetTimer = null;
  }
  // Copilot pattern: fade out Working area gradually so user sees the "complete" state
  // rather than abruptly vanishing. Keep entries visible for ~500ms, then clear.
  if (!immediate && workingEl && workingEl.isConnected) {
    workingEl.style.opacity = '0.5';
    workingEl.style.transition = 'opacity 0.3s ease-out';
  }
  
  var doReset = function() {
    stopWorkingShimmer();
    workingEntries = new Map();
    workingSessionState = 'idle';
    workingSessionSummary = '';
    agentTaskCards.clear();
    agentPlanCard = null;
    agentExecContainer = null;
    agentTodos = [];
    agentToolTodos = [];
    agentTodoParseBuffer = '';
    agentLastParsedTodoSignature = '';
    agentLastEditedFiles = null;
    agentValidationSummary = null;
    agentDoneSummaryInserted = false;
    agentAnalysisFeedbackSeq = 0;
    agentTodosEl = null;
    agentPlanDone = false;
    isAgentMode = false;
    agentDeferredBubbleTurn = null;
    agentActivityRowId = null;
    agentActivityCounts = { read: 0, search: 0, list: 0, terminal: 0, write: 0, web: 0, memory: 0, todo: 0, prose: 0 };
    agentActivitySeen = new Set();
    agentCurrentTaskIndex = -1;
    // Remove the "analyzing" placeholder if it's still in the DOM
    var _oldAnalyzingEl = document.getElementById('agent-analyzing-indicator');
    if (_oldAnalyzingEl) _oldAnalyzingEl.remove();
    agentCurrentTaskLabel = '';
    agentLastFinalizedContainer = null;
    // Reset per-run analyze card state (DOM elements stay in messagesEl as history)
    analyzeCards = new Map();
    analyzeSummaryCardObj = null;
    analyzeContainerEl = null;
    // NOTE: todosWidgetEl is NOT cleared here — it persists until the user sends a new message
    renderWorkingArea();
    // Reset opacity after rendering
    if (workingEl) workingEl.style.opacity = '1';
  };
  if (immediate) {
    doReset();
  } else {
    // Delay the actual reset so the user can see the final state. Any newer reset
    // cancels this timer; otherwise a startResponse reset can erase live todos or
    // Working-card state shortly after a new agent run begins.
    workingResetTimer = setTimeout(function() {
      workingResetTimer = null;
      doReset();
    }, 500);
  }
}

function updateWorkingEntry(key, title, detail, state, options) {
  workingEntries.set(key, {
    title: title || '',
    detail: normalizeWorkingDetail(detail || ''),
    state: state || 'started',
    updatedAt: Date.now(),
  });
  if (!options || options.render !== false) renderWorkingArea();
}

function updateWorkingEntryFromWorkflow(msg, options) {
  var shouldRender = !options || options.render !== false;
  var key = workflowStatusKey(msg);
  var phaseLabel = workflowPhaseLabel(msg.phase, 'working');
  var state = msg.state || 'started';
  var title = buildWorkingTitle(phaseLabel, msg.title || '', state);
  var detail = buildWorkingDetail(msg.phase, state, msg.detail || '');
  updateWorkingEntry(key, title, detail, state, { render: shouldRender });
  if (shouldRender && msg.state === 'started') {
    setWorkingSessionState('running', getWorkingCopyStrategy().stageRunning(phaseLabel));
  }
}

function buildWorkingTitle(phaseLabel, rawTitle, state) {
  if (state === 'started') return phaseLabel;
  if (state === 'failed' && isQualityGateBlockedText(rawTitle)) return phaseLabel + ' · 阻塞';
  if (state === 'failed') return phaseLabel + ' · 失败';
  return phaseLabel;   // passed/completed: 标题简洁，颜色由 state class 区分
}

function buildWorkingDetail(phase, state, detail) {
  var d = normalizeWorkingDetail(detail || '');
  return getWorkingCopyStrategy().buildDetail(phase, state, d);
}

function normalizeWorkingDetail(detail) {
  if (!detail) return '';
  // Collapse intra-line whitespace but preserve newlines so multi-line content
  // (e.g. drift file lists) remains readable in pre-wrap containers.
  var lines = String(detail).split('\n').map(function(l) { return l.replace(/[ \t]+/g, ' ').trim(); }).filter(function(l) { return l.length > 0; });
  var joined = lines.join('\n');
  if (joined.length <= 280) return joined;
  return joined.slice(0, 277) + '...';
}

function setWorkingSessionState(state, summary) {
  workingSessionState = state || 'idle';
  workingSessionSummary = summary || '';
  renderWorkingArea();
}

function workingStateLabel(state) {
  if (state === 'started') return '进行中';
  if (state === 'passed') return '通过';
  if (state === 'failed') return '失败';
  if (state === 'completed') return '完成';
  return '跳过';
}

function renderWorkingArea() {
  if (!workingEl) return;
  ensureWorkingAreaAttached();
  var entries = Array.from(workingEntries.values()).sort(function(a, b) {
    return a.updatedAt - b.updatedAt;
  });
  if (entries.length === 0 || workingSessionState !== 'running') {
    workingEl.classList.remove('show');
    workingEl.innerHTML = '';
    return;
  }

  // Copilot 风格：只显示当前最新一步，紧凑单行卡片，不堆叠历史
  var latest = entries[entries.length - 1];
  workingEl.classList.add('show');
  workingEl.innerHTML = '<div class="working-card compact">'
    + '<span class="working-dot"></span>'
    + '<div class="working-main">'
    + '<div class="wi-title">' + escapeHtml(latest.title || '处理中') + '</div>'
    + (latest.detail ? '<div class="wi-detail">' + escapeHtml(latest.detail) + '</div>' : '')
    + '</div>'
    + '</div>';
}

function summarizeFinishedWorkingBrief() {
  var hasArtifacts = !!(currentResponseMeta && currentResponseMeta.hasGeneratedArtifacts);
  var count = hasArtifacts ? getResponseMetaPathRefs().length : 0;
  if (hasArtifacts && count > 0) return '本轮完成：已处理 ' + count + ' 个文件。';
  return '本轮完成。';
}

function summarizeFinishedWorking() {
  var entries = Array.from(workingEntries.values());
  var passedCount = entries.filter(function(item) { return item.state === 'passed' || item.state === 'completed'; }).length;
  var failedCount = entries.filter(function(item) { return item.state === 'failed'; }).length;
  var skippedCount = entries.filter(function(item) { return item.state === 'skipped'; }).length;
  var strategy = getWorkingCopyStrategy();
  var hasArtifacts = !!(currentResponseMeta && currentResponseMeta.hasGeneratedArtifacts);
  var count = hasArtifacts ? getResponseMetaPathRefs().length : 0;
  var hasRaw = !!(currentRaw && currentRaw.trim());
  return strategy.finishedSummary({ passed: passedCount, failed: failedCount, skipped: skippedCount }, count, hasArtifacts, hasRaw);
}

function shouldRenderWorkflowStatus(msg) {
  if (!msg || !msg.phase || !msg.state) return false;
  // In agent mode all sub-process status is noise — it shows via agentStatus instead
  if (isAgentMode) return false;
  if (msg.state === 'started') return false;
  return msg.state === 'failed';
}

function workflowStatusKey(msg) {
  if (msg.phase === 'repair') {
    var round = extractRepairRound(msg.title || '');
    if (round) return 'repair-round-' + round;
    return 'repair-final';
  }
  return msg.phase;
}

function extractRepairRound(title) {
  var m = (title || '').match(/第\s*(\d+)\s*轮/);
  if (!m) return 0;
  return Number(m[1]) || 0;
}

function renderWorkflowCard(card, msg) {
  card.className = 'workflow-card state-' + (msg.state || 'completed');
  card.innerHTML = '';

  var phaseLabel = workflowPhaseLabel(msg.phase, 'card');
  var isBlocked = msg.state === 'failed' && isQualityGateBlockedText((msg.title || '') + '\n' + (msg.detail || ''));
  var stateLabel = msg.state === 'started'
    ? '进行中'
    : msg.state === 'completed'
      ? '完成'
      : msg.state === 'passed'
        ? '成功'
        : msg.state === 'failed'
          ? (isBlocked ? '阻塞' : '失败')
          : '跳过';

  var head = document.createElement('div');
  head.className = 'wf-head';
  head.textContent = '[' + phaseLabel + ' · ' + stateLabel + '] ' + (msg.title || '');
  card.appendChild(head);

  if (msg.detail) {
    var detail = document.createElement('div');
    detail.className = 'wf-detail';
    if (msg.phase === 'validate') {
      detail.textContent = '编译/验证详情已精简显示。需要完整信息请查看输出日志或继续让智能体修复。';
    } else {
      detail.textContent = msg.detail;
    }
    card.appendChild(detail);
  }
}

function workflowPhaseLabel(phase, surface) {
  if (phase === 'apply') return surface === 'card' ? '应用' : '写入文件';
  if (phase === 'validate') return surface === 'card' ? '验证' : '编译验证';
  if (phase === 'quality') return 'QualityGate';
  if (phase === 'repair') return surface === 'card' ? '修正' : '自动修复';
  return surface === 'card' ? '处理' : '处理中';
}

function isQualityGateBlockedText(text) {
  return /QualityGate\s*阻塞|自动验证阻塞|no-auto-validation-target|\bblocked\b/i.test(String(text || ''));
}

function addGeneratedFilesActions(container, rawText, requestPrompt) {
  // Keep/Undo is the only review surface. Do not render a second action panel.
  return;
}

function shouldCollapseGeneratedBody(rawText) {
  if (currentResponseMeta.hasGeneratedArtifacts) return true;
  if (!rawText) return false;
  var candidateCount = countGeneratedFileCandidates(rawText);
  if (candidateCount <= 0) return false;

  // Strong signal: numbered file sections (e.g. "文件1: code/foo/Bar.cpp").
  var hasNumberedSections = hasStrongGeneratedHeadings(rawText);
  if (hasNumberedSections) return true;

  // Also treat explicit path declaration lines as strong generated-file signal.
  var hasNamedPathSections = hasStrongNamedPathHeadings(rawText);
  if (hasNamedPathSections) return true;

  var fenceCount = (rawText.match(/```/g) || []).length;
  if (fenceCount >= 2) return true;

  // Conservative fallback: many candidate files in one response should use mapping-first UX.
  return candidateCount >= 2;
}

function normalizeGeneratedContentDisplayMode(mode) {
  return mode === 'hidden' || mode === 'full' ? mode : 'collapsed';
}

function applyGeneratedContentDisplayMode(container, rawText) {
  var mode = normalizeGeneratedContentDisplayMode(generatedContentDisplayMode);
  var generated = shouldCollapseGeneratedBody(rawText);
  if (!generated || mode === 'full') return false;

  if (mode === 'hidden') {
    container.innerHTML = '<div class="assistant-generated-summary">已切换为文件映射视图：正文已隐藏。点击蓝色文件路径可直接在编辑区查看代码。</div>';
    return true;
  }

  container.innerHTML = '';
  var summary = document.createElement('div');
  summary.className = 'assistant-generated-summary';
  summary.textContent = '已检测到生成文件内容，正文默认折叠。';

  var expandBtn = document.createElement('button');
  expandBtn.className = 'gfp-btn';
  expandBtn.style.marginTop = '6px';
  expandBtn.textContent = '展开正文';
  expandBtn.addEventListener('click', function() {
    renderAssistantBody(container, rawText);
    addGeneratedFilesActions(container, rawText, currentRequestPrompt);
    maybeScrollToBottom();
  });

  container.appendChild(summary);
  container.appendChild(expandBtn);
  return true;
}

function shouldSuppressGeneratedStreaming(promptText, rawText) {
  if (normalizeGeneratedContentDisplayMode(generatedContentDisplayMode) === 'full') return false;
  if (expectGeneratedArtifacts || currentResponseMeta.hasGeneratedArtifacts) return true;

  if (countGeneratedFileCandidates(rawText || '') >= 1) return true;

  return promptLooksLikeGeneratedContentRequest(promptText);
}

function promptLooksLikeGeneratedContentRequest(promptText) {
  var p = (promptText || '').toLowerCase();
  return /(创建|生成|新建|编写|create|generate|scaffold|boilerplate)/i.test(p)
    && /(文件|目录|folder|file|code\/[a-z0-9_./-]+)/i.test(p);
}

function shouldCollapseRestoredGeneratedContent(promptText, rawText) {
  if (normalizeGeneratedContentDisplayMode(generatedContentDisplayMode) === 'full') return false;
  if (countGeneratedFileCandidates(rawText || '') >= 1) return true;
  return promptLooksLikeGeneratedContentRequest(promptText);
}

function renderGeneratedStreamingPlaceholder(container, rawText) {
  var text = rawText || '';

  // Show text before the first code fence so the user can read the analysis.
  var firstFenceIdx = text.indexOf('```');
  var preCodeText = firstFenceIdx >= 0 ? text.slice(0, firstFenceIdx).trim() : text.trim();

  // Detect completed and in-progress code blocks.
  var fenceCount = (text.match(/```/g) || []).length;
  var completedBlocks = Math.floor(fenceCount / 2);
  var hasOpenBlock = fenceCount % 2 === 1;

  var metaCount = getResponseMetaPathRefs().length;
  var candidateCount = metaCount > 0 ? metaCount : countGeneratedFileCandidates(text);
  var expectedCount = extractRequestedFileCount(currentRequestPrompt);

  var statusParts = [];
  if (expectedCount > 0) {
    var shown = Math.min(candidateCount, expectedCount);
    statusParts.push(shown > 0
      ? ('已匹配 ' + shown + '/' + expectedCount + '，继续补全中。')
      : ('正在匹配 0/' + expectedCount + '，继续补全中。'));
  } else {
    statusParts.push(candidateCount > 0 ? ('已识别 ' + candidateCount + ' 个文件候选。') : '正在识别文件候选。');
  }
  if (completedBlocks > 0) statusParts.push(completedBlocks + ' 个代码块已折叠。');
  if (hasOpenBlock) statusParts.push('代码块生成中…');

  var html = '';
  var mode = normalizeGeneratedContentDisplayMode(generatedContentDisplayMode);
  if (!isAgentMode && mode === 'collapsed') {
    html += buildResponseWithCollapsedCode(text);
  } else if (preCodeText.length > 0) {
    html += md(preCodeText);
  }
  // In agent mode the summary ("已识别N个文件候选") is irrelevant — skip it.
  if (!isAgentMode) {
    html += '<div class="assistant-generated-summary">' + escapeHtml(statusParts.join(' ')) + '</div>';
  }
  container.innerHTML = html;
}

function buildResponseWithCollapsedCode(text) {
  var result = '';
  var re = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g;
  var lastIdx = 0;
  var match;
  while ((match = re.exec(text)) !== null) {
    var textBefore = text.slice(lastIdx, match.index).trim();
    if (textBefore) result += md(textBefore);
    var lang = match[1] || 'code';
    var code = match[2] || '';
    var complete = match[3] === '```';
    var uid = 'collapsed-block-' + (++collapsedCodeUidSeq);
    // Escaped code for inline data attribute — use a hidden pre element
    var escapedCode = escapeHtml(code);
    result += '<div class="collapsed-code-block" data-uid="' + uid + '">'
      + '<div class="collapsed-code-header">'
      + '<span class="collapsed-code-icon">▶</span>'
      + '<span class="collapsed-code-label">[代码块 · ' + escapeHtml(lang) + (complete ? '' : ' · 生成中') + ']</span>'
      + '<span class="collapsed-code-hint">' + (complete ? '点击展开' : '同步接收中') + '</span>'
      + '</div>'
      + '<div class="collapsed-code-body" id="' + uid + '" style="display:none">'
      + '<pre><code class="language-' + escapeHtml(lang) + '">' + escapedCode + '</code></pre>'
      + '</div>'
      + '</div>';
    lastIdx = re.lastIndex;
    if (!complete) break;
  }
  var trailing = text.slice(lastIdx).trim();
  if (trailing) result += md(trailing);
  return result;
}

function renderGeneratedFinalPlaceholder(container, rawText) {
  var metaCount = getResponseMetaPathRefs().length;
  var candidateCount = metaCount > 0 ? metaCount : countGeneratedFileCandidates(rawText || '');
  var expectedCount = extractRequestedFileCount(currentRequestPrompt);
  var suffix = '';
  if (expectedCount > 0 && candidateCount > 0 && candidateCount < expectedCount) {
    suffix = '已检测到 ' + candidateCount + '/' + expectedCount + ' 个文件候选。';
  } else {
    suffix = candidateCount > 0 ? ('检测到 ' + candidateCount + ' 个文件候选。') : '可在下方尝试预览/应用。';
  }
  var bodyHtml = buildResponseWithCollapsedCode(rawText || '');
  if (!isAgentMode) {
    container.innerHTML = bodyHtml + '<div class="assistant-generated-summary">' + escapeHtml(suffix) + '</div>';
  } else {
    container.innerHTML = bodyHtml;
  }
}

function finishAssistantContentRender(container, onDone) {
  pruneEmptyRenderedBlocks(container);
  enhanceCodeVisuals(container);
  collapseTerminalOutputBlocks(container);
  pruneEmptyRenderedBlocks(container);
  renderMermaidBlocks(container).then(function() {
    addCodeToolbars(container);
    pruneEmptyRenderedBlocks(container);
    if (typeof onDone === 'function') onDone();
  });
}

function renderRestoredAssistantContent(container, text, promptText) {
  var visibleText = renderVisibleAssistantText(text || '');
  if (!visibleText) {
    container.innerHTML = '';
    return;
  }
  if (shouldCollapseRestoredGeneratedContent(promptText, visibleText)) {
    container.innerHTML = buildResponseWithCollapsedCode(visibleText);
  } else {
    container.innerHTML = md(visibleText);
  }
  finishAssistantContentRender(container);
}

function extractRequestedFileCount(promptText) {
  if (!promptText) return 0;
  var m = String(promptText).match(/(输出|生成|创建|新建)\s*(\d+)\s*(个|份)?\s*文件/i);
  if (!m) return 0;
  var n = Number(m[2] || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function getResponseMetaPathRefs() {
  var items = currentResponseMeta && Array.isArray(currentResponseMeta.generatedPaths)
    ? currentResponseMeta.generatedPaths
    : [];
  var seen = {};
  var refs = [];

  items.forEach(function(item) {
    if (!item || !item.path) return;
    var clean = String(item.path).trim().replace(/^a\//, '').replace(/^b\//, '').replace(/^\.\//, '');
    if (!clean || clean === '/dev/null' || seen[clean]) return;
    seen[clean] = true;
    refs.push({
      path: clean,
      kind: item.kind || 'file',
      operation: item.operation || (item.kind === 'patch' ? 'patch' : (item.exists ? 'update' : 'create')),
      exists: item.exists === true,
    });
  });

  return refs;
}

function renderAssistantBody(container, rawText) {
  container.innerHTML = md(rawText);
  finishAssistantContentRender(container);
}

function extractGeneratedPathRefs(rawText) {
  var out = [];
  var seen = {};

  function push(path, line) {
    if (!path) return;
    var clean = path.trim().replace(/^a\//, '').replace(/^b\//, '').replace(/^\.\//, '');
    if (!clean || clean === '/dev/null') return;
    var key = clean + ':' + (line || 0);
    if (seen[key]) return;
    seen[key] = true;
    out.push({ path: clean, line: line || undefined });
  }

  var m;
  var pathRe = /([A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql))(?:#L(\d+)|:(\d+)(?::\d+)?)?/gi;
  while ((m = pathRe.exec(rawText)) !== null) {
    var line = Number(m[2] || m[3] || 0) || undefined;
    push(m[1], line);
  }

  var patchPaths = rawText.match(/^[+]{3}\s+(?:b\/)?([^\n\r]+)/gm) || [];
  patchPaths.forEach(function(line) {
    push(line.replace(/^[+]{3}\s+/, ''));
  });

  return out;
}

function hasStrongGeneratedHeadings(rawText) {
  if (!rawText) return false;
  var re = /^(?:\*\*)?\s*(?:文件|File)\s*[\[(（【]?\s*\d+\s*[\])）】]?\s*[:：]\s*`?[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql)`?(?:\*\*)?\s*$/gim;
  return re.test(rawText);
}

function hasStrongNamedPathHeadings(rawText) {
  if (!rawText) return false;
  var re = /^(?:\*\*)?\s*(?:路径|文件|文件名|Path|File|Filename)\s*[:：]\s*`?[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql)`?(?:\*\*)?\s*$/gim;
  return re.test(rawText);
}

function countGeneratedFileCandidates(rawText) {
  var count = 0;
  var seen = {};

  if (rawText.indexOf('"actions"') >= 0) {
    count += (rawText.match(/"path"\s*:\s*"[^"]+"/g) || []).length;
  }

  var patchPaths = rawText.match(/^\+\+\+\s+(?:b\/)?([^\n\r]+)/gm) || [];
  patchPaths.forEach(function(line) {
    var p = line.replace(/^\+\+\+\s+/, '').replace(/^b\//, '').trim();
    if (p && p !== '/dev/null' && !seen[p]) {
      seen[p] = true;
      count++;
    }
  });

  var fileFence = rawText.match(/```[^\n`]*\s*(?:file|path|filename)\s*=\s*[^\n`]+\n/gi) || [];
  count += fileFence.length;

  var explicitPathLines = rawText.match(/^#{1,6}\s+`?[^`\n]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql)`?\s*$/gim) || [];
  count += explicitPathLines.length;

  // Support common multi-file reply format like "文件1: code/student/Person.h".
  var numberedFileLines = rawText.match(/^(?:\*\*)?\s*(?:文件|File)\s*[\[(（【]?\s*\d+\s*[\])）】]?\s*[:：]\s*`?[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql)`?(?:\*\*)?\s*$/gim) || [];
  count += numberedFileLines.length;

  // Also support plain "路径: xxx" / "文件名: xxx" lines.
  var namedPathLines = rawText.match(/^(?:\*\*)?\s*(?:路径|文件|文件名|Path|File|Filename)\s*[:：]\s*`?[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql)`?(?:\*\*)?\s*$/gim) || [];
  count += namedPathLines.length;

  return count;
}

window.addEventListener('message', function(event) {
  const msg = event.data;
  if (msg.type === 'userMessage') {
    // Clear todos and file-changes widgets when user sends a new message
    todosWidgetEl.style.display = 'none';
    todosWidgetEl.innerHTML = '';
    fileChangesWidgetEl.style.display = 'none';
    fileChangesWidgetEl.innerHTML = '';
    fileChangesListExpanded = false;
    resetWorkingArea({ immediate: true });
    // Issue-2: remove any dangling loading bubble (thinking-dots) from a prior
    // response that was never ended (e.g. cancelled before endResponse arrived).
    if (currentBubble) {
      if (currentRaw === '') {
        // Pure dots — nothing was ever shown, remove the whole turn div
        var staleParent = currentBubble.closest('.turn');
        if (staleParent) staleParent.remove();
      } else {
        // Has partial content — strip the cursor but keep the text
        currentBubble.innerHTML = md(renderVisibleAssistantText(currentRaw));
      }
      currentBubble = null;
      currentRaw = '';
      isGenerating = false;
      clearStreamRenderTimer();
      clearAnalysisRenderTimer();
    }
    addUserBubble(msg.text, msg.prompt || msg.text, msg.images);
  } else if (msg.type === 'startResponse') {
    settleReadyProgress();
    isGenerating = true; currentRaw = ''; hadResetRender = false;
    suppressGeneratedStreaming = false;
    expectGeneratedArtifacts = !!msg.expectGeneratedArtifacts;
    currentResponseMeta = { hasGeneratedArtifacts: false, generatedPaths: [], pathHints: [] };
    completionSummaryEmitted = false;
    completionSummaryHasQueue = false;
    agentDoneSummaryInserted = false;
    agentAnalysisFeedbackSeq = 0;
    currentRequestPrompt = msg.prompt || '';
    hadFirstDelta = false;
    pendingTokenUsage = null;  // reset per-response usage counter
    clearStreamRenderTimer();
    clearAnalysisRenderTimer();
    agentPlanDone = false;
    resetWorkingArea({ immediate: true });
    // P5: set isAgentMode synchronously from message property to eliminate the
    // race condition where isAgentMode was only set later when the first
    // agentStatus/plan message arrived (which could be after endResponse).
    // IMPORTANT: must be set AFTER resetWorkingArea() because resetWorkingArea()
    // resets isAgentMode = false, which would undo this assignment if done before.
    isAgentMode = msg.agentMode === true;
    // Issue-1: Only show working area for agent mode or artifact-generating requests.
    // For simple chat (agentMode=false, no generateArtifacts), the working area
    // is redundant — the response appears directly in the bubble.
    if (!isAgentMode && expectGeneratedArtifacts) {
      setWorkingSessionState('running', getWorkingCopyStrategy().stageRunning('分析请求'));
      // 步骤1: 分析请求（等首个 delta 到来时标记为 passed）
      updateWorkingEntry('request', '分析请求', '已收到提示词，正在连接模型…', 'started');
    }
    if (expectGeneratedArtifacts && normalizeGeneratedContentDisplayMode(generatedContentDisplayMode) !== 'full') {
      suppressGeneratedStreaming = true;
      setWorkingSessionState('running', getWorkingCopyStrategy().stageRunning('生成文件清单'));
    }
    sendBtn.textContent = '\u23f9'; sendBtn.title = '\u505c\u6b62\u751f\u6210';
    currentBubble = addAssistantBubble();
    // Agent mode: detach prose bubble from DOM so it appears BELOW the thinking box,
    // not above it. Will be reinserted after agentExecContainer is appended.
    if (isAgentMode && currentBubble && currentBubble.parentElement) {
      agentDeferredBubbleTurn = currentBubble.parentElement;
      agentDeferredBubbleTurn.remove();
      // Show a minimal "analyzing" placeholder so user knows work is in progress
      // before the Working box (plan phase) appears.
      var _analyzingTurn = document.createElement('div');
      _analyzingTurn.className = 'turn assistant-turn';
      _analyzingTurn.id = 'agent-analyzing-indicator';
      _analyzingTurn.innerHTML = '<div class="assistant-bubble" style="opacity:.55;font-size:.85em;padding:5px 10px;display:inline-flex;align-items:center;gap:6px"><i class="codicon codicon-loading aut-spin" style="font-size:.85em"></i>\u6b63\u5728\u5206\u6790\u4e2d\u2026</div>';
      if (messagesEl) { messagesEl.appendChild(_analyzingTurn); maybeScrollToBottom(); }
      // Todos widget stays hidden until manage_todo_list sends real items.
      // handleTodoUpdate() will show it with actual content when that arrives.
    }
  } else if (msg.type === 'delta') {
    if (!isAgentMode && msg.text && (String(msg.text).indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(String(msg.text)))) {
      var _cleanNonAgentToolDelta = sanitizeAgentVisibleDelta(String(msg.text));
      if (!_cleanNonAgentToolDelta) return;
      msg.text = _cleanNonAgentToolDelta;
    }
    if (isAgentMode && msg.text) {
      agentTodoParseBuffer += msg.text;
      if (agentTodoParseBuffer.length > 30000) agentTodoParseBuffer = agentTodoParseBuffer.slice(-30000);
      maybeHandleTodoUpdateFromModelText(agentTodoParseBuffer);
    }
    // Agent mode: suppress deltas until plan is complete so the decompose JSON
    // never leaks into the chat bubble (it belongs to the planning phase only).
    if (isAgentMode && !agentPlanDone) return;
    // Agent mode: suppress noisy tool-output dumps (read_file / grep_search / list_dir results).
    // These are shown as activity chips in the working area instead.
    if (isAgentMode && /^\n\n\*\*\[(?:文件|搜索|目录)\]/.test(msg.text)) return;
    // Agent mode: suppress terminal output deltas from chat bubble — shown via
    // collapsible blocks at endResponse only (Claude Code / Copilot pattern).
    if (isAgentMode && /^\n\n\*\*\[终端/.test(msg.text)) return;
    // Agent mode: suppress raw LLM "文件 N：path\n```" listings that may leak from
    // analyze task streaming or decompose deltas.
    if (isAgentMode && /^文件\s*\d+[：:]/u.test(msg.text.trimStart())) return;
    // ── Analyze file/summary delta routing (\ x00AFILE: / \x00ASUM\x00 prefix) ──
    var _afPfx = '\x00AFILE:';
    var _asPfx = '\x00ASUM\x00';
    if (msg.text && msg.text.startsWith(_afPfx)) {
      var _afSep = msg.text.indexOf('\x00', _afPfx.length);
      if (_afSep > _afPfx.length) {
        // P-Q: stream analysis content inside Working box (not af-cards)
        var _afRaw = msg.text.slice(_afSep + 1);
        if (_afRaw) routeAnalysisToWorkingBox(msg.text.slice(_afPfx.length, _afSep), _afRaw);
      }
      return;
    }
    if (msg.text && msg.text.startsWith(_asPfx)) {
      // P-Q/P-P: summary → currentRaw → deferred prose bubble below Working boxes (Copilot style)
      var _sumDelta = msg.text.slice(_asPfx.length);
      if (!_sumDelta) return;
      if (_sumDelta.startsWith('\x00RESET\x00')) {
        currentRaw = _sumDelta.slice(7);
      } else {
        currentRaw += _sumDelta;
      }
      if (isAgentMode && !renderVisibleAssistantText(currentRaw)) return;
      if (currentBubble) {
        if (isAgentMode && hasActiveAgentWorkingContainer()) {
          clearStreamRenderTimer();
          return;
        }
        if (isAgentMode) ensureAgentProseBubbleVisible();
        scheduleStreamingBubbleRender();
      }
      return;
    }
    var _visibleDelta = msg.text;
    if (!_visibleDelta) return;
    currentRaw += _visibleDelta;
    if (isAgentMode && !renderVisibleAssistantText(currentRaw)) return;
    if (currentBubble) {
      if (isAgentMode) ensureAgentProseBubbleVisible();
      if (!suppressGeneratedStreaming && shouldSuppressGeneratedStreaming(currentRequestPrompt, currentRaw)) {
        suppressGeneratedStreaming = true;
      }

      // 首个 delta：步骤1完成，切换到步骤2
      if (!hadFirstDelta) {
        hadFirstDelta = true;
        if (!isAgentMode) updateWorkingEntry('request', '分析请求', '模型已开始响应', 'passed');
      }
      if (suppressGeneratedStreaming) {
        renderGeneratedStreamingPlaceholder(currentBubble, currentRaw);
        var rawLen2 = currentRaw.length;
        var progLabel2 = rawLen2 > 0 ? ('已接收 ' + rawLen2.toLocaleString() + ' 字符') : '正在连接…';
        if (!isAgentMode) updateWorkingEntry('response', '生成文件清单', progLabel2, 'started');
      } else {
        scheduleStreamingBubbleRender();
        var rawLen = currentRaw.length;
        var progLabel = rawLen > 0 ? ('已接收 ' + rawLen.toLocaleString() + ' 字符') : '正在连接…';
        if (!isAgentMode) updateWorkingEntry('response', '接收回复', progLabel, 'started');
      }
      if (suppressGeneratedStreaming) maybeScrollToBottom();
    }
  } else if (msg.type === 'resetResponse') {
    if (isAgentMode) {
      agentTodoParseBuffer = msg.text || '';
      maybeHandleTodoUpdateFromModelText(agentTodoParseBuffer);
    }
    if (isAgentMode && !agentPlanDone) {
      currentRaw = '';
      hadResetRender = false;
      clearStreamRenderTimer();
      clearAnalysisRenderTimer();
      return;
    }
    currentRaw = isAgentMode ? sanitizeAgentVisibleDelta(msg.text || '') : (msg.text || '');
    clearStreamRenderTimer();
    clearAnalysisRenderTimer();
    if (currentBubble) {
      if (isAgentMode) ensureAgentProseBubbleVisible();
      if (!hadFirstDelta) {
        hadFirstDelta = true;
        if (!isAgentMode) updateWorkingEntry('request', '分析请求', '模型已开始响应', 'passed');
      }
      if (!isAgentMode) {
        var resetRawLen = currentRaw.length;
        var resetWillSuppress = suppressGeneratedStreaming || shouldSuppressGeneratedStreaming(currentRequestPrompt, currentRaw);
        var resetProgLabel = resetRawLen > 0 ? ('已接收 ' + resetRawLen.toLocaleString() + ' 字符') : '正在连接…';
        updateWorkingEntry('response',
          resetWillSuppress ? '生成文件清单' : '接收回复',
          resetProgLabel,
          'started');
      }
      if (suppressGeneratedStreaming || shouldSuppressGeneratedStreaming(currentRequestPrompt, currentRaw)) {
        suppressGeneratedStreaming = true;
        renderGeneratedStreamingPlaceholder(currentBubble, currentRaw);
        maybeScrollToBottom();
        hadResetRender = true;
        return;
      }

      // 生成已结束，立即渲染（不带光标），这样 mermaid 图表尽早显示
      var resetBubble = currentBubble;
      var displayRaw = renderVisibleAssistantText(currentRaw);
      resetBubble.innerHTML = md(displayRaw);
      if (isAgentMode && !pruneEmptyRenderedBlocks(resetBubble)) {
        if (resetBubble.parentElement) resetBubble.parentElement.remove();
        hadResetRender = true;
        return;
      }
      enhanceCodeVisuals(resetBubble);
      pruneEmptyRenderedBlocks(resetBubble);
      renderMermaidBlocks(resetBubble).then(function() {
        addCodeToolbars(resetBubble);
        pruneEmptyRenderedBlocks(resetBubble);
        maybeScrollToBottom();
      });
      hadResetRender = true;
    }
  } else if (msg.type === 'endResponse') {
    clearStreamRenderTimer();
    clearAnalysisRenderTimer();
    var _wasAgentMode = isAgentMode;
    if (_wasAgentMode) finalizeActiveAgentWorkingContainers(hasAgentFailureState());
    // If deferred bubble was never placed (no streaming prose arrived), insert it now
    // after the latest Working box so final feedback is not hidden in the thinking area.
    if (agentDeferredBubbleTurn) {
      ensureAgentProseBubbleVisible();
    }
    if (currentBubble) {
      var endBubble = currentBubble;
      if (isAgentMode) {
        // Agent mode: only render if we have real post-plan analysis content.
        // agentPlanDone gates the delta handler, so currentRaw only contains
        // analysis text from execute tasks — never the decompose JSON.
        // If only content is a task_complete tool call, extract its summary as the final prose.
        var strippedForEnd = cleanAgentFinalProseForUser(currentRaw);
        if (!strippedForEnd && /\[TOOL:task_complete\b/.test(currentRaw)) {
          strippedForEnd = cleanAgentFinalProseForUser(extractTaskCompleteSummary(currentRaw) || '');
        }
        // Copilot pattern: for analysis tasks the conclusion stays in currentRaw (prose bubble).
        // But if AFILE prefix routing was used, the raw content went to the Working box body
        // instead of currentRaw. Recover it now so the analysis conclusion is visible below
        // the Working box as a proper prose bubble, not buried in a collapsed details element.
        var lastContainer = agentLastFinalizedContainer;
        agentLastFinalizedContainer = null;
        if (!strippedForEnd
            && lastContainer
            && lastContainer.hasAttribute('data-analyze')
            && !lastContainer.hasAttribute('data-analysis-feedback-emitted')) {
          var analysisBodyEl = lastContainer.querySelector('.aut-analysis-body');
          if (analysisBodyEl && analysisBodyEl._raw) {
            strippedForEnd = cleanAgentFinalProseForUser(analysisBodyEl._raw);
          }
        }
        var isTaskCompleteOnly = false; // always render if strippedForEnd has content
        if (!hadResetRender && agentPlanDone && strippedForEnd && !isTaskCompleteOnly) {
          // ── Copilot / Claude Code pattern ──────────────────────────────────────────
          // Working area  = tool-call activity (terminal commands, file reads, etc.)
          // Standalone bubble = AI conclusions/summary — ALWAYS shown below working area
          // Never inject into the working box and remove the bubble: that makes the
          // summary invisible (buried in an overflow scroll no user finds).
          strippedForEnd = stripAgentGeneratedCodeBlocks(strippedForEnd);
          endBubble.innerHTML = md(augmentAgentFinalSummary(strippedForEnd));
          if (!pruneEmptyRenderedBlocks(endBubble)) {
            if (endBubble.parentElement) endBubble.parentElement.remove();
            return;
          }
          agentDoneSummaryInserted = true;
          enhanceCodeVisuals(endBubble);
          pruneEmptyRenderedBlocks(endBubble);
          // Wrap any terminal-output blocks left in currentRaw into collapsible
          // <details> so intermediate tool noise is collapsed but accessible.
          collapseTerminalOutputBlocks(endBubble);
          renderMermaidBlocks(endBubble).then(function() { addCodeToolbars(endBubble); pruneEmptyRenderedBlocks(endBubble); maybeScrollToBottom(); });
          ensureAgentProseBubbleVisible();
        } else if (!hadResetRender) {
          // No LLM prose — auto-generate summary from task/edit completion data
          var autoSummary = buildAgentAutoSummary();
          if (autoSummary) {
            endBubble.innerHTML = md(augmentAgentFinalSummary(autoSummary));
            if (!pruneEmptyRenderedBlocks(endBubble)) {
              if (endBubble.parentElement) endBubble.parentElement.remove();
              return;
            }
            agentDoneSummaryInserted = true;
            enhanceCodeVisuals(endBubble);
            pruneEmptyRenderedBlocks(endBubble);
            renderMermaidBlocks(endBubble).then(function() { addCodeToolbars(endBubble); pruneEmptyRenderedBlocks(endBubble); maybeScrollToBottom(); });
            ensureAgentProseBubbleVisible();
          } else if (endBubble.parentElement) {
            endBubble.parentElement.remove();
          }
        }
        // Safety: even after hadResetRender, if the bubble is still in DOM and
        // contains [TOOL:] raw text (leaked from streaming), strip it or remove it.
        if (endBubble && endBubble.isConnected && ((endBubble.textContent || '').indexOf('[TOOL:') !== -1 || containsAgentInternalTranscript(endBubble.textContent || ''))) {
          var _safeRaw = cleanAgentFinalProseForUser(currentRaw);
          if (_safeRaw) {
            endBubble.innerHTML = md(augmentAgentFinalSummary(_safeRaw));
            enhanceCodeVisuals(endBubble);
            pruneEmptyRenderedBlocks(endBubble);
          } else if (endBubble.parentElement) {
            endBubble.parentElement.remove();
          }
      }
    } else {
        var generatedModeAtEnd = normalizeGeneratedContentDisplayMode(generatedContentDisplayMode);
        var forceHiddenAtEnd = generatedModeAtEnd !== 'full'
          && (suppressGeneratedStreaming || hasStrongGeneratedHeadings(currentRaw) || hasStrongNamedPathHeadings(currentRaw));
        if (!hadResetRender) {
          if (forceHiddenAtEnd) {
            if (generatedModeAtEnd === 'hidden') {
              applyGeneratedContentDisplayMode(endBubble, currentRaw);
            } else {
              renderGeneratedFinalPlaceholder(endBubble, currentRaw);
            }
            addGeneratedFilesActions(endBubble, currentRaw, currentRequestPrompt);
            maybeScrollToBottom();
          } else if (applyGeneratedContentDisplayMode(endBubble, currentRaw)) {
            addGeneratedFilesActions(endBubble, currentRaw, currentRequestPrompt);
            maybeScrollToBottom();
          } else {
            var nonAgentEndDisplay = sanitizeAssistantVisibleText(currentRaw);
            if (nonAgentEndDisplay) {
              endBubble.innerHTML = md(nonAgentEndDisplay);
              pruneEmptyRenderedBlocks(endBubble);
              enhanceCodeVisuals(endBubble);
              pruneEmptyRenderedBlocks(endBubble);
              renderMermaidBlocks(endBubble).then(function() {
                addCodeToolbars(endBubble);
                pruneEmptyRenderedBlocks(endBubble);
                addGeneratedFilesActions(endBubble, currentRaw, currentRequestPrompt);
                maybeScrollToBottom();
              });
            } else if (endBubble.parentElement) {
              endBubble.parentElement.remove();
            }
          }
        } else {
          if (forceHiddenAtEnd) {
            if (generatedModeAtEnd === 'hidden') {
              applyGeneratedContentDisplayMode(endBubble, currentRaw);
            } else {
              renderGeneratedFinalPlaceholder(endBubble, currentRaw);
            }
          } else {
            applyGeneratedContentDisplayMode(endBubble, currentRaw);
          }
          addGeneratedFilesActions(endBubble, currentRaw, currentRequestPrompt);
        }
      }
      maybeScrollToBottom();
    }
    // 步骤2完成：在拿快照前将 response 条目终态化，fsr-body 可见完整链
    var _finalLen = currentRaw ? currentRaw.length : 0;
    if (!isAgentMode) {
      updateWorkingEntry('response',
        suppressGeneratedStreaming ? '生成文件清单' : '接收回复',
        _finalLen > 0 ? ('共 ' + _finalLen.toLocaleString() + ' 字符') : '已完成',
        'completed');
    }
    addCompletionSummaryCard();
    // P4-1: render token usage badge if available (show in both agent and normal mode)
    if (pendingTokenUsage && messagesEl) {
      var usageRow = document.createElement('div');
      usageRow.className = 'token-usage-row';
      var _total = pendingTokenUsage.promptTokens + pendingTokenUsage.completionTokens;
      usageRow.textContent = 'tokens: ' + _total.toLocaleString()
        + ' (↑' + pendingTokenUsage.promptTokens.toLocaleString()
        + ' ↓' + pendingTokenUsage.completionTokens.toLocaleString() + ')';
      messagesEl.appendChild(usageRow);
    }
    pendingTokenUsage = null;
    resetWorkingArea();
    hadResetRender = false;
    suppressGeneratedStreaming = false;
    expectGeneratedArtifacts = false;
    currentResponseMeta = { hasGeneratedArtifacts: false, generatedPaths: [], pathHints: [] };
    stopGenerating();
    // §8.5 Queue: after agent completes, auto-send any queued message
    if (_wasAgentMode && queuedAgentMsg) {
      var _q = queuedAgentMsg;
      queuedAgentMsg = null;
      renderQueueIndicator();
      setTimeout(function() {
        pendingFiles = _q.files || [];
        if (_q.mode) currentMode = _q.mode;
        pendingNewSession = _q.newSession || false;
        inputEl.value = _q.prompt || '';
        if (inputEl.value.trim() || (_q.attachPaths && _q.attachPaths.length > 0)) {
          sendMessage();
        }
      }, 600);
    }
  } else if (msg.type === 'responseMeta') {
    currentResponseMeta = {
      hasGeneratedArtifacts: !!msg.hasGeneratedArtifacts,
      generatedPaths: Array.isArray(msg.generatedPaths) ? msg.generatedPaths : [],
      pathHints: Array.isArray(msg.pathHints) ? msg.pathHints : [],
    };

    if (currentBubble && currentResponseMeta.hasGeneratedArtifacts && normalizeGeneratedContentDisplayMode(generatedContentDisplayMode) !== 'full') {
      suppressGeneratedStreaming = true;
      renderGeneratedStreamingPlaceholder(currentBubble, currentRaw);
      var matchedCount = getResponseMetaPathRefs().length;
      var expectedCount = extractRequestedFileCount(currentRequestPrompt);
      var progressText = expectedCount > 0
        ? ('已匹配 ' + Math.min(matchedCount, expectedCount) + '/' + expectedCount + ' 个文件路径。')
        : ('已识别 ' + matchedCount + ' 个文件路径。');
      // 步骤3: 独立 key，标记为 passed（供 fsr-body 快照）
      updateWorkingEntry('file-detect', '识别文件变更', progressText, 'passed');
      setWorkingSessionState('running', getWorkingCopyStrategy().stageRunning('收敛最终结果'));
      maybeScrollToBottom();
    }
  } else if (msg.type === 'error') {
    clearStreamRenderTimer();
    clearAnalysisRenderTimer();
    if (isAgentMode) finalizeActiveAgentWorkingContainers(true);
    // 如果思考气泡还没收到任何内容（纯 thinking-dots 状态），从 DOM 中移除它
    if (currentBubble && currentRaw === '') {
      const turn = currentBubble.closest('.turn');
      if (turn) turn.remove();
    } else if (currentBubble) {
      // 有部分内容：保留已显示内容，去掉光标
      currentBubble.innerHTML = md(renderVisibleAssistantText(currentRaw));
    }
    stopGenerating();
    if (msg.loginRequired) {
      addLoginError(msg.text || 'DevSeek \u767b\u5f55\u5df2\u8fc7\u671f');
    } else {
      addError(msg.text || '\u672a\u77e5\u9519\u8bef');
    }
    updateWorkingEntry('response', '本轮失败', msg.text || '未知错误', 'failed');
    setWorkingSessionState('failed', '本轮失败，请调整提示词后重试。');
    setTimeout(function() {
      resetWorkingArea();
    }, 1800);
  } else if (msg.type === 'newSessionStarted') {
    // Clear previous conversation DOM, state, and pending files for the new session.
    messagesEl.innerHTML = '';
    ensureWorkingAreaAttached();
    clearPendingFiles();
    resetWorkingArea();
    inheritedContextFiles = [];
    renderContextFilesRow();
    pendingNewSession = false;
    isGenerating = false;
    currentRaw = '';
    currentBubble = null;
    agentPlanDone = false;
    agentTodos = [];
    if (todosWidgetEl) { todosWidgetEl.style.display = 'none'; todosWidgetEl.innerHTML = ''; }
    if (fileChangesWidgetEl) { fileChangesWidgetEl.style.display = 'none'; fileChangesWidgetEl.innerHTML = ''; fileChangesListExpanded = false; }
    sendBtn.textContent = '\u27a4'; sendBtn.title = '\u53d1\u9001 (Enter)';
  } else if (msg.type === 'clearHistory') {
    messagesEl.innerHTML = '';
    ensureWorkingAreaAttached();
    clearPendingFiles();
    resetWorkingArea();
    inheritedContextFiles = [];
    renderContextFilesRow();
  } else if (msg.type === 'triggerStatusPoll') {
    pollStatus();
  } else if (msg.type === 'addToChat') {
    if (msg.directoryPaths && msg.directoryPaths.length > 0) {
      // Single directory badge; all file paths sent on submit
      pendingFiles.push({ label: msg.label || '未命名', filePath: null, content: null, directoryPaths: msg.directoryPaths });
      var dBadge = document.createElement('span');
      dBadge.className = 'file-badge';
      dBadge.title = msg.directoryPaths.join('\n');
      dBadge.textContent = '📁 ' + (msg.label || '');
      var dRm = document.createElement('span');
      dRm.className = 'badge-remove';
      dRm.textContent = '×';
      dRm.title = '移除';
      (function(badge, entry) {
        dRm.addEventListener('click', function() {
          pendingFiles = pendingFiles.filter(function(item) { return item !== entry; });
          badge.remove();
        });
      })(dBadge, pendingFiles[pendingFiles.length - 1]);
      dBadge.appendChild(dRm);
      fileBadgesEl.appendChild(dBadge);
      inputEl.focus();
    } else {
      addFileBadge(msg.label || '未命名', msg.filePath || null, msg.content || null);
    }
  } else if (msg.type === 'workflowStatus') {
    addWorkflowStatus(msg);
  } else if (msg.type === 'agentStatus') {
    addAgentStatus(msg);
  } else if (msg.type === 'intentConfirmation' || msg.type === 'planReview') {
    handleIntentConfirmation(msg);
  } else if (msg.type === 'agentAnnouncement') {
    // Phase B: transitional prose bubble between plan card and first Working box
    if (msg.text) { addAgentAnnouncementBubble(msg.text); }
  } else if (msg.type === 'todoUpdate') {
    // L-2: AI called manage_todo_list — rebuild the aut-rows to reflect AI's plan
    handleTodoUpdate(msg.items || []);
  } else if (msg.type === 'agentSteerRejected') {
    addError(msg.text || '当前无法追加补充要求。');
  } else if (msg.type === 'agentSteerAccepted') {
    // Local submit already rendered the user's supplement; no duplicate bubble.
    maybeScrollToBottom();
  } else if (msg.type === 'tokenUsage') {
    // P4-1: store token usage from API response to show after endResponse
    pendingTokenUsage = { promptTokens: msg.promptTokens || 0, completionTokens: msg.completionTokens || 0 };
  } else if (msg.type === 'contextFiles') {
    inheritedContextFiles = msg.files || [];
    renderContextFilesRow();
  } else if (msg.type === 'statusUpdate') {
    settleReadyProgress();
    if (msg.providerMode && msg.providerMode !== 'bridge') {
      // 非 bridge provider（deepseek-api / openai-compat）：显示可用状态不需要登录
      if (msg.online) {
        sDotEl.className = 's-dot s-online';
        statusTextEl.textContent = msg.providerLabel || '已就绪';
        loginBtn.style.display = 'none';
      } else {
        sDotEl.className = 's-dot s-offline';
        statusTextEl.textContent = 'API 不可用（请检查设置）';
        loginBtn.style.display = 'none';
      }
    } else if (!msg.online) {
      sDotEl.className = 's-dot s-offline';
      statusTextEl.textContent = 'Bridge 未运行';
      loginBtn.style.display = '';
      loginBtn.disabled = false;
      loginBtn.textContent = '🔑 登录';
    } else if (!msg.loggedIn) {
      sDotEl.className = 's-dot s-offline';
      statusTextEl.textContent = '未登录';
      loginBtn.style.display = '';
      loginBtn.disabled = false;
      loginBtn.textContent = '🔑 登录';
    } else {
      sDotEl.className = 's-dot s-online';
      statusTextEl.textContent = '已登录';
      loginBtn.style.display = 'none';
    }
  } else if (msg.type === 'pendingEdits') {
    pendingEdits = Array.isArray(msg.items) ? msg.items : [];
    if (pendingEdits.length > 0) {
      // In agent mode, do NOT reset the working area on pendingEdits — agent loop
      // sends multiple pendingEdits messages (one per file) and resetting mid-loop
      // clears agentExecContainer, which causes a new exec container to be created
      // for every subsequent task (the double/triple container bug).
      if (!isAgentMode) resetWorkingArea();
      if (!isGenerating) addQueueReadySummaryCard();
    }
    renderPendingEdits();
  } else if (msg.type === 'pendingActionNotice') {
    addPendingActionNoticeCard(msg);
  } else if (msg.type === 'uiSettings') {
    generatedContentDisplayMode = normalizeGeneratedContentDisplayMode(msg.generatedContentDisplayMode);
    workingCopyStyle = normalizeWorkingCopyStyle(msg.workingCopyStyle);
    if (msg.autopilotMode !== undefined) {
      autopilotMode = !!msg.autopilotMode;
      const apBtn = document.getElementById('autopilot-btn');
      if (apBtn) {
        apBtn.classList.toggle('active', autopilotMode);
        apBtn.title = autopilotMode
          ? '自动驾驶：开启 — Agent 完成时自动接受所有文件改动（点击关闭）'
          : '自动驾驶：关闭 — Agent 完成时显示 Keep/Undo 确认（点击开启）';
      }
    }
    if (msg.agentEnabled !== undefined) {
      agentEnabled = !!msg.agentEnabled;
      if (agentToggleBtn) {
        agentToggleBtn.classList.toggle('active', agentEnabled);
        agentToggleBtn.title = agentEnabled
          ? 'Agent 模式：开启 — 自动分析意图并执行多轮编辑（点击关闭，走普通对话）'
          : 'Agent 模式：关闭 — 强制普通对话，不触发多轮编辑（点击开启）';
      }
    }
  } else if (msg.type === 'terminalConfirm') {
    // G-2: AI wants to run a command — show inline confirm card (no modal)
    handleTerminalConfirm(msg);
  } else if (msg.type === 'terminalRanNotice') {
    // G-3: Command was executed — show result in the tc-group row if one exists (avoids
    // repeating the command a 2nd time when the user already saw it in the confirm card).
    var existingTcGroup = messagesEl ? messagesEl.querySelector('.tc-group-wrap') : null;
    if (existingTcGroup) {
      // The command was already confirmed and shown in the tc-group card.
      // Update the last tc-row's decided status with the execution result.
      var tcRows = existingTcGroup.querySelectorAll('.tc-row');
      var lastTcRow = tcRows.length ? tcRows[tcRows.length - 1] : null;
      if (lastTcRow) {
        var tcDecided = lastTcRow.querySelector('.tc-decided');
        var exitOkG3 = typeof msg.exitCode === 'number' ? msg.exitCode === 0 : true;
        if (tcDecided && tcDecided.textContent.includes('\u5df2\u5141\u8bb8')) {
          // keep "✓ 已允许" — validate phase will update it with compile result
        }
        // Append terminal output below tc-group (collapsed on success, open on failure)
        var outputG3 = (msg.output || '').trim();
        if (outputG3) {
          var termDetsG3 = document.createElement('details');
          termDetsG3.className = 'term-output-details';
          if (!exitOkG3) termDetsG3.setAttribute('data-failed', '1');
          var termSumG3 = document.createElement('summary');
          termSumG3.className = 'term-output-summary';
          var exitLblG3 = !exitOkG3
            ? '<span class="rc-exit">[exit ' + msg.exitCode + ']</span>'
            : '<span class="rc-exit" style="color:var(--vscode-charts-green,#4caf50)">[\u2713 ok]</span>';
          termSumG3.innerHTML = '<i class="codicon codicon-terminal"></i>'
            + '<span class="rc-cmd">\u8f93\u51fa</span>'
            + exitLblG3;
          var termPreG3 = document.createElement('pre');
          termPreG3.className = 'term-output-pre';
          termPreG3.textContent = outputG3;
          termDetsG3.appendChild(termSumG3);
          termDetsG3.appendChild(termPreG3);
          existingTcGroup.querySelector('.tc-group').appendChild(termDetsG3);
        }
      }
      maybeScrollToBottom();
    } else if (agentExecContainer && agentExecContainer.isConnected) {
      prepareAgentToolActivityContainer('terminal', msg.command || '');
      // No tc-group visible: show traditional ran-command-row in working container
      var ranRow = document.createElement('div');
      ranRow.className = 'ran-command-row';
      var cmd = msg.command || '';
      var cmdDisplay = cmd.length > 120 ? cmd.slice(0, 117) + '\u2026' : cmd;
      var exitOk = typeof msg.exitCode === 'number' ? msg.exitCode === 0 : true;
      var exitHtml = (typeof msg.exitCode === 'number' && msg.exitCode !== 0)
        ? '<span class="rc-exit">[exit ' + msg.exitCode + ']</span>'
        : '';
      var output = (msg.output || '').trim();
      if (output) {
        // Always show output in a collapsible block — collapsed on success, expanded on failure
        var termDets = document.createElement('details');
        termDets.className = 'term-output-details';
        if (!exitOk) termDets.setAttribute('data-failed', '1');
        var termSum = document.createElement('summary');
        termSum.className = 'term-output-summary';
        var exitLbl = exitOk
          ? '<span class="rc-exit" style="color:var(--vscode-charts-green,#4caf50)">[\u2713 ok]</span>'
          : '<span class="rc-exit">[exit ' + msg.exitCode + ']</span>';
        termSum.innerHTML = '<i class="codicon codicon-terminal"></i>'
          + '<span class="rc-cmd">$ ' + escapeHtml(cmdDisplay) + '</span>'
          + exitLbl;
        var termPre = document.createElement('pre');
        termPre.className = 'term-output-pre';
        termPre.textContent = output;
        termDets.appendChild(termSum);
        termDets.appendChild(termPre);
        var ranRowsEl = agentExecContainer.querySelector('.aut-rows');
        if (ranRowsEl) { ranRowsEl.appendChild(termDets); ranRowsEl.scrollTop = ranRowsEl.scrollHeight; }
      } else {
        ranRow.innerHTML = '<i class="codicon codicon-terminal"></i>'
          + '<span class="rc-cmd">$ ' + escapeHtml(cmdDisplay) + '</span>'
          + exitHtml;
        var ranRowsElPlain = agentExecContainer.querySelector('.aut-rows');
        if (ranRowsElPlain) { ranRowsElPlain.appendChild(ranRow); ranRowsElPlain.scrollTop = ranRowsElPlain.scrollHeight; }
      }
      setAgentContainerLabel(agentExecContainer, (exitOk ? 'Ran ' : 'Failed ') + (cmdDisplay || 'command'), true);
      var termSpinLbl = agentExecContainer.querySelector('.aut-spinner-label');
      if (termSpinLbl) {
        termSpinLbl.textContent = exitOk ? 'Command completed' : 'Command failed';
      }
      maybeScrollToBottom();
    }
  } else if (msg.type === 'agentToolActivity') {
    // Append one readable step row per tool call (Copilot-style: "Searched for X", "Read Y")
    var actKind = normalizeAgentToolActivityKind(msg.activityKind);
    var actLabel = normalizeAgentToolActivityLabel(msg.activityLabel);
    var actDisplayLabel = actLabel || defaultAgentToolActivityTarget(actKind);
    // 'label' kind: AI pre-tool intent → update Working box label only (no step row, no bubble).
    // Copilot never shows pre-tool prose as chat messages; it only updates the Working header.
    if (actKind === 'label') {
      if (actDisplayLabel && agentExecContainer && agentExecContainer.isConnected) {
        var labelTrunc = actDisplayLabel.length > 42 ? actDisplayLabel.slice(0, 40) + '\u2026' : actDisplayLabel;
        var intentLblEl = agentExecContainer.querySelector('.aut-label');
        if (intentLblEl && !agentExecContainer.hasAttribute('data-done') && !activeAgentContainerHasProcessRows(agentExecContainer)) {
          intentLblEl.textContent = labelTrunc;
          agentCurrentTaskLabel = labelTrunc;
        }
        var intentSpinEl = agentExecContainer.querySelector('.aut-spinner-label');
        if (intentSpinEl) intentSpinEl.textContent = labelTrunc;
      }
      return;
    }
    if (actKind === 'todo' || actKind === 'memory') return;
    prepareAgentToolActivityContainer(actKind, actLabel);
    var seenLabel = String(actDisplayLabel || '').replace(/\s+/g, ' ').trim();
    if (actKind === 'read' || actKind === 'write' || actKind === 'list') {
      seenLabel = seenLabel.replace(/\\/g, '/').split('/').pop() || seenLabel;
    }
    if (seenLabel.length > 120) seenLabel = seenLabel.slice(0, 120);
    var seenKey = actKind + ':' + seenLabel.toLowerCase();
    if (agentActivitySeen.has(seenKey)) return;
    agentActivitySeen.add(seenKey);
    if (agentActivityCounts[actKind] !== undefined) agentActivityCounts[actKind]++;
    // Lazy-create steps list if agentToolActivity fires before plan phase created it
    var actRow = agentActivityRowId ? document.getElementById(agentActivityRowId) : null;
    if (!actRow && agentExecContainer && agentExecContainer.isConnected) {
      var lazyDets = agentExecContainer.querySelector('.aut-details');
      var lazyRows = agentExecContainer.querySelector('.aut-rows');
      if (lazyDets && lazyRows) {
        var lazySteps = document.createElement('div');
        lazySteps.className = 'aut-steps-list';
        lazySteps.id = 'aut-activity-lazy-' + Date.now();
        lazyDets.insertBefore(lazySteps, lazyRows);
        agentActivityRowId = lazySteps.id;
        actRow = lazySteps;
      }
    }
    if (actRow) {
      // Format Copilot-style step description
      var step = formatAgentToolActivityStep(actKind, actDisplayLabel);
      var stepEl = document.createElement('div');
      stepEl.className = (actKind === 'terminal') ? 'aut-step aut-step-terminal' : 'aut-step';
      stepEl.innerHTML = '<i class="codicon ' + step.icon + ' aut-step-icon"></i>'
        + '<span class="aut-step-text">' + step.html + '</span>';
      actRow.appendChild(stepEl);
      // Auto-scroll steps list to bottom so newest activity is always visible (Copilot §26.2)
      actRow.scrollTop = actRow.scrollHeight;
      // Event-driven spinner label: show specific action info (2nd status row below steps)
      // aut-label (summary header) is kept stable at the task-level description.
      if (agentExecContainer && agentExecContainer.isConnected) {
        var actDets = agentExecContainer.querySelector('.aut-details');
        if (actDets && !actDets.hasAttribute('data-done')) {
          var actSpinLbl = actDets.querySelector('.aut-spinner-label');
          if (actSpinLbl) {
            var spinActWord = getAgentActivityDisplay(actKind).spinnerVerb || 'Running';
            var spinActTarget = actDisplayLabel.replace(/\\/g, '/').split('/').pop() || actDisplayLabel;
            if (spinActTarget.length > 35) spinActTarget = spinActTarget.slice(0, 33) + '\u2026';
            actSpinLbl.textContent = spinActWord + (spinActTarget ? ' ' + spinActTarget : '\u2026');
          }
        }
      }
      scrollAgentProgressToBottom();
    }
  } else if (msg.type === 'sessionList') {
    renderSessionsList(msg.sessions, msg.activeId);
  } else if (msg.type === 'clearAgentProse') {
    // Silently wipe intermediate working-round prose from the streaming buffer.
    // Called after each tool-calling round so currentRaw contains only the final
    // ASUM summary when endResponse fires — no intermediate bubble clutter.
    if (isAgentMode) { currentRaw = ''; clearStreamRenderTimer(); }
  } else if (msg.type === 'agentNotice') {
    // §8.3: Show a brief notice row in the active working box (e.g. protected file skip)
    var noticeRow = agentActivityRowId ? document.getElementById(agentActivityRowId) : null;
    if (noticeRow) {
      var noticeEl = document.createElement('div');
      noticeEl.className = 'aut-step';
      var noticeIcon = msg.kind === 'warn' ? 'codicon-warning' : 'codicon-info';
      noticeEl.innerHTML = '<i class="codicon ' + noticeIcon + ' aut-step-icon" style="color:var(--vscode-editorWarning-foreground,#cca700)"></i>'
        + '<span class="aut-step-text" style="opacity:.75">' + escapeHtml(msg.text || '') + '</span>';
      noticeRow.appendChild(noticeEl);
      noticeRow.scrollTop = noticeRow.scrollHeight;
      scrollAgentProgressToBottom();
    }
  } else if (msg.type === 'sessionLoaded') {
    loadSessionMessages(msg.history, msg.summary, msg.changedFiles, msg.messageCount, msg.createdAt);
  } else if (msg.type === 'agentCheckpointAvailable') {
    showCheckpointBanner(msg.resumeTaskIndex, msg.totalTasks, msg.userPrompt, msg.savedAt);
  } else if (msg.type === 'agentCheckpointCleared') {
    dismissCheckpointBanner();
  }
});

function stopGenerating() {
  isGenerating = false; currentBubble = null; currentRaw = '';
  workflowStateCards = new Map();
  sendBtn.textContent = '\u27a4'; sendBtn.title = '\u53d1\u9001 (Enter)';
}

// ── 断点续传 checkpoint banner ────────────────────────────────────────────────
var checkpointBannerId = 'ds-checkpoint-banner';

function showCheckpointBanner(resumeTaskIndex, totalTasks, userPrompt, savedAt) {
  dismissCheckpointBanner(); // remove any existing
  if (!totalTasks || resumeTaskIndex >= totalTasks) return;
  var banner = document.createElement('div');
  banner.id = checkpointBannerId;
  var elapsed = savedAt ? Math.round((Date.now() - savedAt) / 60000) : 0;
  var elapsedLabel = elapsed < 1 ? '刚才' : elapsed + ' 分钟前';
  var promptLabel = (userPrompt || '').slice(0, 60) + ((userPrompt || '').length > 60 ? '…' : '');
  var remaining = Math.max(0, totalTasks - resumeTaskIndex);
  banner.innerHTML =
    '<span style="flex:1;min-width:0">' +
      '<b>上次 Agent 任务中断</b>（' + elapsedLabel + '）：已完成 ' + resumeTaskIndex + '/' + totalTasks +
      ' 个任务，剩余 ' + remaining + ' 个。' +
      (promptLabel ? '<br><span style="opacity:.7;font-size:.9em">' + escapeHtml(promptLabel) + '</span>' : '') +
    '</span>' +
    '<button id="ds-cp-resume" style="margin-left:8px;padding:3px 10px;cursor:pointer;border-radius:4px;border:none;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff)">继续执行</button>' +
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
