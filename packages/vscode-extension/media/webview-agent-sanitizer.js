// Presentation-only cleanup for DevSeek-owned routing markers.
// Tool calls, todo updates, and completion are typed host events; ordinary model
// prose must remain visible even when it contains JSON, XML, ReAct, or tool names.

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function stripToolCallBlocks(text) {
  return String(text || '');
}

function sanitizeAgentVisibleDelta(text) {
  return sanitizeAgentVisibleText(text);
}

function sanitizeAgentVisibleText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  raw = stripAgentLocalContextNoticeLeaks(raw);
  raw = stripAgentRoutingFileMarkerLeaks(raw);
  if (!raw.trim() || isAgentRoutingFileMarkerLeak(raw)) return '';
  return collapseDuplicateAgentTransitionSentences(
    stripAgentRoutingResetLeaks(stripAgentRoutingSummaryMarkerLeak(raw)),
  ).trim();
}

function sanitizeAssistantVisibleText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  raw = stripAgentLocalContextNoticeLeaks(raw);
  raw = stripAgentRoutingFileMarkerLeaks(raw);
  if (!raw.trim() || isAgentRoutingFileMarkerLeak(raw)) return '';
  return stripAgentRoutingResetLeaks(stripAgentRoutingSummaryMarkerLeak(raw)).trim();
}

function renderVisibleAssistantText(text) {
  return isAgentMode ? sanitizeAgentVisibleText(text || '') : sanitizeAssistantVisibleText(text || '');
}

function renderAssistantMarkdown(text) {
  return md(renderVisibleAssistantText(text || ''));
}

function renderAgentMarkdown(text) {
  return md(sanitizeAgentVisibleText(text || ''));
}

function containsAgentInternalTranscript(text) {
  return containsAgentRoutingMarkerLeak(text);
}

function containsAgentRoutingMarkerLeak(text) {
  return /(?:^|\n)\s*(?:\x00?AFILE:[^\x00\n]{0,220}(?:\x00|RESET)|AFILE:[^\n]{0,220}RESET|\x00?ASUM(?:\x00|RESET)?)/.test(String(text || ''));
}

function isAgentRoutingFileMarkerLeak(text) {
  return /^\s*(?:\x00?AFILE:|AFILE:)/.test(String(text || ''));
}

function stripAgentRoutingFileMarkerLeaks(text) {
  return String(text || '')
    .replace(/\x00?AFILE:[^\x00\n]{0,260}(?:\x00|\x00?RESET\x00?|RESET)/g, '')
    .replace(/\x00?AFILE:[^\x00\n]{0,260}$/g, '');
}

function stripAgentLocalContextNoticeLeaks(text) {
  return String(text || '')
    .replace(/_?\[自动识别目录\]\s*已加载\s*\d+\s*个源文件(?:（[^）]{0,240}）)?，完整清单仅用于本地上下文。_?/g, '')
    .replace(/_?\[自动识别目录\]\s*已加载\s*\d+\s*个源文件(?:（[^）]{0,240}）)?。_?/g, '')
    .replace(/_?\[同一 session 续作\]\s*已自动恢复上一轮工作文件：[^_\n]{0,360}_?/g, '');
}

function stripAgentRoutingResetLeaks(text) {
  return String(text || '')
    .replace(/\x00RESET\x00/g, '')
    .replace(/(^|[\s。！？；;])RESET(?=(?:好的|我(?:将|先|来|会|已经|已)|现在|首先|接下来|下一步|下面|已读取|已完成|分析|读取|查看))/g, '$1');
}

function collapseDuplicateAgentTransitionSentences(text) {
  return String(text || '').replace(
    /((?:好的，)?(?:我(?:将|先|来|会|已经|已)|现在|首先|接下来|下一步)[^。！？\n]{8,220}[。！？])(?:\s*\1)+/g,
    '$1',
  );
}

function stripAgentRoutingSummaryMarkerLeak(text) {
  return String(text || '')
    .replace(/^\s*\x00ASUM\x00\x00RESET\x00/, '')
    .replace(/^\s*\x00ASUM\x00/, '')
    .replace(/^\s*ASUMRESET/, '')
    .replace(/^\s*ASUM/, '');
}

function restoreAgentRoutingMarkerText(text) {
  var raw = String(text || '');
  if (!raw) return '';
  if (raw.indexOf('\x00AFILE:') === 0 || raw.indexOf('\x00ASUM\x00') === 0) return raw;
  var markerBody = raw.replace(/^\s+/, '');
  if (markerBody.indexOf('ASUMRESET') === 0) return '\x00ASUM\x00\x00RESET\x00' + markerBody.slice('ASUMRESET'.length);
  if (markerBody.indexOf('ASUM') === 0) return '\x00ASUM\x00' + markerBody.slice('ASUM'.length);
  var fileReset = /^AFILE:([^\s\x00]{1,120}?)RESET([\s\S]*)$/.exec(raw);
  if (fileReset) return '\x00AFILE:' + fileReset[1] + '\x00\x00RESET\x00' + fileReset[2];
  if (/^AFILE:[^\s\x00]{1,180}/.test(raw)) return '\x00AFILE:unknown\x00';
  return raw;
}
