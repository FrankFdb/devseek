// Generated artifact body rendering helpers for the DevSeek webview.
// Loaded after generated rules and before webview.js; main webview state remains in webview.js.

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

function shouldCollapseRestoredGeneratedContent(promptText, rawText) {
  if (normalizeGeneratedContentDisplayMode(generatedContentDisplayMode) === 'full') return false;
  if (countGeneratedFileCandidates(rawText || '') >= 1) return true;
  return promptLooksLikeGeneratedContentRequest(promptText);
}

function renderGeneratedStreamingPlaceholder(container, rawText) {
  var text = renderVisibleAssistantText(rawText || '');

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
    html += renderAssistantMarkdown(preCodeText);
  }
  // In agent mode the summary ("已识别N个文件候选") is irrelevant; skip it.
  if (!isAgentMode) {
    html += '<div class="assistant-generated-summary">' + escapeHtml(statusParts.join(' ')) + '</div>';
  }
  container.innerHTML = html;
}

function buildResponseWithCollapsedCode(text) {
  text = renderVisibleAssistantText(text || '');
  var result = '';
  var re = /```([\w+-]*)\n?([\s\S]*?)(```|$)/g;
  var lastIdx = 0;
  var match;
  while ((match = re.exec(text)) !== null) {
    var textBefore = text.slice(lastIdx, match.index).trim();
    if (textBefore) result += renderAssistantMarkdown(textBefore);
    var lang = match[1] || 'code';
    var code = match[2] || '';
    var complete = match[3] === '```';
    var uid = 'collapsed-block-' + (++collapsedCodeUidSeq);
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
  if (trailing) result += renderAssistantMarkdown(trailing);
  return result;
}

function renderGeneratedFinalPlaceholder(container, rawText) {
  var text = renderVisibleAssistantText(rawText || '');
  var metaCount = getResponseMetaPathRefs().length;
  var candidateCount = metaCount > 0 ? metaCount : countGeneratedFileCandidates(text);
  var expectedCount = extractRequestedFileCount(currentRequestPrompt);
  var suffix = '';
  if (expectedCount > 0 && candidateCount > 0 && candidateCount < expectedCount) {
    suffix = '已检测到 ' + candidateCount + '/' + expectedCount + ' 个文件候选。';
  } else {
    suffix = candidateCount > 0 ? ('检测到 ' + candidateCount + ' 个文件候选。') : '已收到回复，可继续输入下一步需求。';
  }
  var bodyHtml = buildResponseWithCollapsedCode(text);
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
    container.innerHTML = renderAssistantMarkdown(visibleText);
  }
  finishAssistantContentRender(container);
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
  container.innerHTML = renderAssistantMarkdown(rawText);
  finishAssistantContentRender(container);
}
