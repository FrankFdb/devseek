// Agent activity display rules. This is data/formatting policy, not DOM ownership.

var AGENT_ACTIVITY_DISPLAY = {
  read: { target: '文件', labelTarget: '文件', labelVerb: '读取', spinnerVerb: '读取', stepVerb: '已读取', icon: 'codicon-file-text', basename: true },
  search: { target: '代码', labelTarget: '代码', labelVerb: '搜索', spinnerVerb: '搜索', stepVerb: '已搜索', icon: 'codicon-search', max: 60 },
  list: { target: '目录', labelTarget: '目录', labelVerb: '列出', spinnerVerb: '列出', stepVerb: '已列出', icon: 'codicon-list-flat' },
  write: { target: '文件', labelTarget: '文件', labelVerb: '写入', spinnerVerb: '写入', stepVerb: '已写入', icon: 'codicon-edit', basename: true },
  web: { target: '网页', labelTarget: '网页', labelVerb: '抓取', spinnerVerb: '抓取', stepVerb: '已抓取', icon: 'codicon-globe', max: 60 },
  diagnostics: { target: '工作区诊断', labelTarget: '诊断', labelVerb: '检查', spinnerVerb: '检查', stepVerb: '已检查', icon: 'codicon-warning' },
  'vscode-command': { target: 'VS Code 命令', labelTarget: 'VS Code 命令', labelVerb: '运行', spinnerVerb: '运行', stepVerb: '已运行', icon: 'codicon-extensions', max: 50 },
  mcp: { target: '工具', labelTarget: '工具', labelVerb: '调用', spinnerVerb: '调用', stepVerb: '已调用', icon: 'codicon-plug', max: 50 },
  terminal: { target: '命令', labelTarget: '命令', labelVerb: '运行', spinnerVerb: '运行', stepVerb: '已运行', icon: 'codicon-terminal', max: 50, shellPrefix: true },
};

function getAgentActivityDisplay(kind) {
  return AGENT_ACTIVITY_DISPLAY[kind] || {
    target: '工具',
    labelTarget: '',
    labelVerb: '处理',
    spinnerVerb: '运行',
    stepVerb: '已运行',
    icon: 'codicon-terminal',
    max: 50,
    shellPrefix: true,
  };
}

function formatAgentActivityTarget(value, spec, kind) {
  var target = sanitizeAgentActivityLabelValue(kind, value);
  if (!target) return '';
  target = target.replace(/\\/g, '/');
  if (spec && spec.basename) target = target.split('/').pop() || target;
  var max = (spec && spec.max) || 0;
  if (max > 0 && target.length > max) target = target.slice(0, max) + '\u2026';
  return target;
}

function looksLikeSourceActivitySnippet(value) {
  var raw = String(value || '').trim();
  if (!raw) return false;
  var text = raw.replace(/\s+/g, ' ');
  if (/^(?:Failed|Ran|Error|失败|成功)?\s*(?:void|int|bool|char|class|struct|template|#include)\b/i.test(text)) return true;
  if (/(?:#include\s*<|\bstd::|\bnullptr\b|\b[A-Za-z_]\w*::[A-Za-z_]\w*\b)/.test(text)) return true;
  return /[{};]/.test(text) && /\b(?:void|int|bool|char|class|struct|return|nullptr|std::)\b/.test(text);
}

function sanitizeAgentActivityLabelValue(kind, value) {
  var raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw === 'undefined' || raw === 'null' || raw === '[object Object]') return '';
  if (looksLikeSourceActivitySnippet(raw)) {
    return defaultAgentToolActivityTarget(kind || 'terminal');
  }
  return raw;
}

function sanitizeAgentTaskLabelValue(value) {
  var raw = sanitizeAgentActivityLabelValue('task', value);
  if (!raw) return '';
  if (/^(?:Failed|Ran)\b/i.test(raw)) return '';
  if (/^(?:失败|成功|执行完成|运行完成)[:：]?\s*(?:命令|command)$/i.test(raw)) return '';
  if (/^(?:命令|command)$/i.test(raw)) return '';
  return raw.replace(/^失败[:：]\s*/, '').trim();
}

function compactAgentTaskLabel(value, fallback, maxLen) {
  var raw = sanitizeAgentTaskLabelValue(value) || sanitizeAgentTaskLabelValue(fallback);
  if (!raw) return '';
  var max = maxLen || 40;
  return raw.length > max ? raw.slice(0, Math.max(0, max - 2)) + '…' : raw;
}

function formatTerminalCommandDisplay(command, maxLen) {
  var raw = sanitizeAgentActivityLabelValue('terminal', command);
  if (!raw) return 'command';
  var max = maxLen || 120;
  return raw.length > max ? raw.slice(0, Math.max(0, max - 1)) + '\u2026' : raw;
}

function buildAgentToolActivityLabel(kind, label) {
  var spec = getAgentActivityDisplay(kind);
  var raw = sanitizeAgentActivityLabelValue(kind, label);
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
  var target = formatAgentActivityTarget(label, spec, kind) || spec.target || 'tool';
  return {
    icon: spec.icon || 'codicon-terminal',
    html: spec.stepVerb + ' <code>' + (spec.shellPrefix ? '$ ' : '') + escapeHtml(target) + '</code>',
  };
}
