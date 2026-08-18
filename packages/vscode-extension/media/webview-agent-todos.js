// Agent todo-list parsing helpers for the DevSeek webview.
// Loaded after webview-agent-sanitizer.js and before webview.js.

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

function findFailedAgentTodoLabel(todos) {
  var failedTodo = (todos || []).find(function(todo) {
    return todo && todo.status === 'failed' && todo.title;
  });
  if (!failedTodo) return '';
  return failedTodo.title.length > 52 ? failedTodo.title.slice(0, 50) + '...' : failedTodo.title;
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

  var callRe = /(?:\[\s*)?(?:Calling\s*:?(?:\s+tool)?|Call\s*:|调用)\s*\[?`?manage_todo_list`?\]?/gi;
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
