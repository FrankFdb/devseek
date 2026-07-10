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

function isAgentValidationTask(taskAction, rawDesc) {
  var action = String(taskAction || '').trim();
  if (action !== 'analyze' && action !== 'explain') return false;
  var text = String(rawDesc || '').replace(/\s+/g, ' ');
  return /run_terminal|compile|build|execute|\$\s|cmake|make|ninja|pytest|npm\s+(?:test|run|exec)|cargo\s+test|go\s+test|编译|验证|运行/.test(text);
}

function getAgentTaskActionPrefix(taskAction, rawDesc) {
  if (taskAction === 'create') return '创建 ';
  if (taskAction === 'delete') return '删除 ';
  if (taskAction === 'modify') return '修改 ';
  if (taskAction === 'explore') return '探索 ';
  if (taskAction === 'respond') return '';
  if (isAgentValidationTask(taskAction, rawDesc)) return '验证 ';
  if (taskAction === 'analyze' || taskAction === 'explain') return '分析 ';
  return taskAction ? '处理 ' : '';
}

function formatFinishedAgentTaskLabel(label) {
  var raw = sanitizeAgentTaskLabelValue(label);
  if (!raw) return '';
  return raw
    .replace(/^Creating /, '已创建 ')
    .replace(/^Modifying /, '已修改 ')
    .replace(/^Editing /, '已编辑 ')
    .replace(/^Deleting /, '已删除 ')
    .replace(/^Analyzing /, '已分析 ')
    .replace(/^Exploring /, '已探索 ')
    .replace(/^Running /, '已运行 ')
    .replace(/^Validating /, '已验证 ')
    .replace(/^Working on /, '已处理 ')
    .replace(/^创建 /, '已创建 ')
    .replace(/^修改 /, '已修改 ')
    .replace(/^编辑 /, '已编辑 ')
    .replace(/^删除 /, '已删除 ')
    .replace(/^分析 /, '已分析 ')
    .replace(/^探索 /, '已探索 ')
    .replace(/^运行 /, '已运行 ')
    .replace(/^验证 /, '已验证 ')
    .replace(/^处理 /, '已处理 ');
}

function formatAgentValidationTitle(title, state) {
  var raw = sanitizeAgentTaskLabelValue(title);
  if (!raw) {
    if (state === 'failed') return '验证未通过';
    if (state === 'skipped') return '已跳过验证';
    return '验证完成';
  }
  return raw
    .replace(/^执行完成\s*✓?$/, '运行验证完成 ✓')
    .replace(/^执行完成/, '运行验证完成')
    .replace(/^Command completed$/i, '命令执行完成')
    .replace(/^Command failed$/i, '命令执行失败');
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

function decideAgentProgressTransition(currentStage, currentTitle, currentOwner, nextStage, nextTitle, nextOwner) {
  if (!currentStage || !currentTitle) return 'update';
  if (currentStage !== nextStage) return 'new-group';
  if (nextOwner === 'status' && currentTitle !== nextTitle) return 'new-group';
  if (nextOwner === 'activity' && currentOwner === 'status') return 'keep-summary';
  return 'update';
}

function shouldStartNewAgentProgressGroup(currentStage, nextStage) {
  return !!currentStage && !!nextStage && currentStage !== nextStage;
}

function formatAgentActivitySummary(counts) {
  var source = counts || {};
  var labels = [];
  var definitions = [
    ['read', '读取文件'],
    ['search', '搜索代码'],
    ['list', '查看目录'],
    ['write', '修改文件'],
    ['terminal', '运行命令'],
    ['diagnostics', '检查诊断'],
    ['web', '查看网页'],
    ['mcp', '调用工具'],
    ['vscode-command', '运行 VS Code 命令'],
  ];
  for (var i = 0; i < definitions.length; i++) {
    if (Number(source[definitions[i][0]] || 0) > 0) labels.push(definitions[i][1]);
  }
  if (labels.length === 0) return '';
  if (labels.length === 1) return labels[0];
  return labels.slice(0, -1).join('、') + '并' + labels[labels.length - 1];
}

function formatAgentToolActivityStep(kind, label) {
  var spec = getAgentActivityDisplay(kind);
  var target = formatAgentActivityTarget(label, spec, kind) || spec.target || 'tool';
  return {
    icon: spec.icon || 'codicon-terminal',
    html: spec.stepVerb + ' <code>' + (spec.shellPrefix ? '$ ' : '') + escapeHtml(target) + '</code>',
  };
}
