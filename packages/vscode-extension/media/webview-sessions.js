// Session history panel helpers for the DevSeek webview.

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
    sumBody.innerHTML = renderAssistantMarkdown(summary);
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
