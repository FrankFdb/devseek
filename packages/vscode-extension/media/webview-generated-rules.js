// Generated artifact detection rules. Rendering remains in webview.js.

function promptLooksLikeGeneratedContentRequest(promptText) {
  var p = (promptText || '').toLowerCase();
  return /(创建|生成|新建|编写|create|generate|scaffold|boilerplate)/i.test(p)
    && /(文件|目录|folder|file|code\/[a-z0-9_./-]+)/i.test(p);
}

function extractRequestedFileCount(promptText) {
  if (!promptText) return 0;
  var m = String(promptText).match(/(输出|生成|创建|新建)\s*(\d+)\s*(个|份)?\s*文件/i);
  if (!m) return 0;
  var n = Number(m[2] || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
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

  var numberedFileLines = rawText.match(/^(?:\*\*)?\s*(?:文件|File)\s*[\[(（【]?\s*\d+\s*[\])）】]?\s*[:：]\s*`?[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql)`?(?:\*\*)?\s*$/gim) || [];
  count += numberedFileLines.length;

  var namedPathLines = rawText.match(/^(?:\*\*)?\s*(?:路径|文件|文件名|Path|File|Filename)\s*[:：]\s*`?[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx|json|md|css|scss|html|py|java|go|rs|c|cc|cpp|cxx|h|hpp|sh|sql)`?(?:\*\*)?\s*$/gim) || [];
  count += namedPathLines.length;

  return count;
}
