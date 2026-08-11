export interface SourceSanityIssue {
  kind:
    | 'unterminated-string-literal'
    | 'tool-protocol-contamination'
    | 'structured-data-source-mismatch'
    | 'markdown-emphasis-dunder-corruption'
    | 'collapsed-preprocessor-directive'
    | 'collapsed-line-comment-code';
  line: number;
  detail: string;
}

export interface SourceTransportRepairResult {
  content: string;
  repaired: boolean;
  repairCount: number;
}

const CPP_SOURCE_EXT_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;
const PYTHON_SOURCE_EXT_RE = /\.py$/i;
const CODE_SOURCE_EXT_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|py|js|jsx|ts|tsx|mjs|cjs|java|go|rs|cs|php|rb|swift|kt|kts|scala|sh|bash|zsh)$/i;
const SOURCE_TOOL_PROTOCOL_RE = /(?:\[调用\s+(?:create_file|write_file|replace_in_file|delete_file|run_terminal|read_file|list_dir|search_file)\]|\bCalling:\s*(?:create_file|write_file|replace_in_file|delete_file|run_terminal|read_file|list_dir|search_file)\b|<TOOL_[A-Za-z0-9_]+>|<\/TOOL_[A-Za-z0-9_]+>)/;
const PYTHON_DUNDER_NAME_RE = /(?:init|name|main|str|repr|len|iter|next|enter|exit|eq|ne|lt|le|gt|ge|hash|call|dict|class|module|all|file|doc|annotations|slots|getattr|setattr|delattr|contains|getitem|setitem|delitem|bool|bytes|format|new|del)/;
const PYTHON_MARKDOWN_DUNDER_RE = new RegExp(`\\*\\*${PYTHON_DUNDER_NAME_RE.source}\\*\\*`);
const PYTHON_MARKDOWN_DUNDER_GLOBAL_RE = new RegExp(`\\*\\*(${PYTHON_DUNDER_NAME_RE.source})\\*\\*`, 'g');
const CPP_WEB_TRANSPORT_RECOVERY_GUIDANCE =
  '请把整个 <write_file> 或 <replace_in_file> CDATA 工具块放入 ```xml 代码围栏后重试，不要输出裸 XML。';

export function findGeneratedSourceSanityIssue(filePath: string, content: string): SourceSanityIssue | undefined {
  if (!CODE_SOURCE_EXT_RE.test(filePath || '')) return undefined;
  return findSourceToolProtocolContamination(content || '')
    || findPythonMarkdownDunderCorruption(filePath, content || '')
    || (CPP_SOURCE_EXT_RE.test(filePath || '')
      ? findCppStructuredDataMismatch(content || '')
        || findCppCollapsedPreprocessorDirective(content || '')
        || findCppCollapsedLineCommentCode(content || '')
        || findCppUnterminatedStringLiteral(content || '')
      : undefined);
}

function findCppStructuredDataMismatch(content: string): SourceSanityIssue | undefined {
  const trimmed = content.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    return {
      kind: 'structured-data-source-mismatch',
      line: 1,
      detail: 'C/C++ 源文件内容是完整 JSON 文档，疑似把 todo、工具参数或结构化回复误绑定到了源码路径。请重新发送与目标文件对应的 write_file/replace_in_file 源码内容。',
    };
  } catch {
    return undefined;
  }
}

export function repairGeneratedSourceTransportEscapes(filePath: string, content: string): SourceTransportRepairResult {
  if (!CODE_SOURCE_EXT_RE.test(filePath || '')) {
    return { content, repaired: false, repairCount: 0 };
  }
  let current = content || '';
  let repairCount = 0;
  if (CPP_SOURCE_EXT_RE.test(filePath || '')) {
    const includeDirectiveRepair = repairCppCollapsedIncludeDirectives(current);
    current = includeDirectiveRepair.content;
    repairCount += includeDirectiveRepair.repairCount;
    const macroTransportRepair = repairCppMacroTransportEscapedNewlines(current);
    current = macroTransportRepair.content;
    repairCount += macroTransportRepair.repairCount;
    const newlineRepair = repairCppStringLiteralTransportNewlines(current);
    current = newlineRepair.content;
    repairCount += newlineRepair.repairCount;
    const macroRepair = repairCppMacroMarkdownEmphasisEscapes(current);
    current = macroRepair.content;
    repairCount += macroRepair.repairCount;
  }
  if (PYTHON_SOURCE_EXT_RE.test(filePath || '')) {
    const dunderRepair = repairPythonMarkdownDunderEscapes(current);
    current = dunderRepair.content;
    repairCount += dunderRepair.repairCount;
  }
  return {
    content: current,
    repaired: repairCount > 0,
    repairCount,
  };
}

function repairCppCollapsedIncludeDirectives(content: string): SourceTransportRepairResult {
  let current = content;
  let repairCount = 0;
  const collapsedInclude = /^([ \t]*#\s*include\s*(?:<[^>\r\n]+>|"[^"\r\n]+"))(?=[ \t]*[^ \t\r\n/])/gm;

  while (true) {
    let roundRepairs = 0;
    const repaired = current.replace(collapsedInclude, (_match, directive: string) => {
      roundRepairs += 1;
      return `${directive}\n`;
    });
    if (roundRepairs === 0) break;
    current = repaired;
    repairCount += roundRepairs;
  }

  return { content: current, repaired: repairCount > 0, repairCount };
}

function findCppUnterminatedStringLiteral(content: string): SourceSanityIssue | undefined {
  let line = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inChar = false;
  let inString = false;
  let escape = false;

  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index];
    const next = content[index + 1];

    if (ch === '\n') {
      if (inString) {
        return {
          kind: 'unterminated-string-literal',
          line,
          detail: `第 ${line} 行附近的 C/C++ 字符串字面量跨过真实换行。请在字符串内使用 \\\\n，或拆成多个字符串片段。`,
        };
      }
      line += 1;
      inLineComment = false;
      inChar = false;
      escape = false;
      continue;
    }

    if (inLineComment) continue;

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (inChar) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === "'") {
        inChar = false;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (ch === "'") {
      inChar = true;
      escape = false;
      continue;
    }
    if (ch === 'R' && next === '"') {
      const rawEnd = findRawStringLiteralEnd(content, index);
      if (rawEnd !== -1) {
        line += countNewlines(content.slice(index, rawEnd + 1));
        index = rawEnd;
        continue;
      }
    }
    if (ch === '"') {
      inString = true;
      escape = false;
    }
  }

  if (inString) {
    return {
      kind: 'unterminated-string-literal',
      line,
      detail: `第 ${line} 行附近的 C/C++ 字符串字面量没有闭合。`,
    };
  }
  return undefined;
}

interface CppPreprocessorMarker {
  line: number;
  column: number;
  directive: string;
}

function findCppCollapsedPreprocessorDirective(content: string): SourceSanityIssue | undefined {
  const lines = content.split('\n');
  const markers = scanCppPreprocessorMarkers(content);
  for (const marker of markers) {
    const lineText = lines[marker.line - 1] || '';
    const firstTokenColumn = lineText.search(/\S/);
    if (firstTokenColumn >= 0 && marker.column !== firstTokenColumn) {
      return {
        kind: 'collapsed-preprocessor-directive',
        line: marker.line,
        detail: `第 ${marker.line} 行的 #${marker.directive} 被拼接到其他源码后。C/C++ 预处理指令必须独占物理行。${CPP_WEB_TRANSPORT_RECOVERY_GUIDANCE}`,
      };
    }

    if (marker.directive === 'include') {
      const match = /^\s*#\s*include\s*(?:<[^>\n]+>|"[^"\n]+")\s*(.*)$/.exec(lineText);
      if (match && match[1] && !/^\/\//.test(match[1]) && !/^\/\*/.test(match[1])) {
        return collapsedDirectiveTailIssue(marker, 'include');
      }
    }
    if (marker.directive === 'pragma') {
      const match = /^\s*#\s*pragma\s+pack\s*\([^)]*\)\s*(.*)$/i.exec(lineText);
      if (match && match[1] && !/^\/\//.test(match[1]) && !/^\/\*/.test(match[1])) {
        return collapsedDirectiveTailIssue(marker, 'pragma');
      }
    }
  }
  return undefined;
}

function findCppCollapsedLineCommentCode(content: string): SourceSanityIssue | undefined {
  let line = 1;
  let inBlockComment = false;
  let inString = false;
  let inChar = false;
  let escape = false;

  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index];
    const next = content[index + 1];
    if (ch === '\n') {
      line += 1;
      inString = false;
      inChar = false;
      escape = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString || inChar) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if ((inString && ch === '"') || (inChar && ch === "'")) {
        inString = false;
        inChar = false;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (ch === 'R' && next === '"') {
      const rawEnd = findRawStringLiteralEnd(content, index);
      if (rawEnd !== -1) {
        line += countNewlines(content.slice(index, rawEnd + 1));
        index = rawEnd;
        continue;
      }
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "'") {
      inChar = true;
      continue;
    }
    if (ch !== '/' || next !== '/') continue;

    const lineEnd = content.indexOf('\n', index + 2);
    const comment = content.slice(index + 2, lineEnd < 0 ? content.length : lineEnd);
    if (looksLikeCollapsedCodeInLineComment(comment)) {
      return {
        kind: 'collapsed-line-comment-code',
        line,
        detail: `第 ${line} 行的 // 注释后检测到被折叠的源码语句。网页文本工具可能丢失了物理换行；${CPP_WEB_TRANSPORT_RECOVERY_GUIDANCE}`,
      };
    }
    if (lineEnd < 0) break;
    index = lineEnd - 1;
  }
  return undefined;
}

function looksLikeCollapsedCodeInLineComment(comment: string): boolean {
  const structuralTokenCount = (comment.match(/[;{}]/g) || []).length;
  if (structuralTokenCount < 2) return false;
  const nestedComment = /(^|[^:])\/\//.test(comment);
  const gluedControl = /[A-Za-z_\u3400-\u9fff）】](?:if|for|while|switch)\s*\(/.test(comment);
  const gluedDeclaration = /[\u3400-\u9fff）】](?:auto|return|throw|std::|[A-Za-z_]\w*\s*\()/.test(comment);
  return nestedComment || gluedControl || gluedDeclaration;
}

function collapsedDirectiveTailIssue(marker: CppPreprocessorMarker, directive: string): SourceSanityIssue {
  return {
    kind: 'collapsed-preprocessor-directive',
    line: marker.line,
    detail: `第 ${marker.line} 行的 #${directive} 后拼接了源码。C/C++ 预处理指令必须独占物理行。${CPP_WEB_TRANSPORT_RECOVERY_GUIDANCE}`,
  };
}

function scanCppPreprocessorMarkers(content: string): CppPreprocessorMarker[] {
  const markers: CppPreprocessorMarker[] = [];
  let line = 1;
  let lineStart = 0;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = false;
  let inChar = false;
  let escape = false;

  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index];
    const next = content[index + 1];
    if (ch === '\n') {
      line += 1;
      lineStart = index + 1;
      inLineComment = false;
      if (!inBlockComment) {
        inString = false;
        inChar = false;
        escape = false;
      }
      continue;
    }
    if (inLineComment) continue;
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString || inChar) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if ((inString && ch === '"') || (inChar && ch === "'")) {
        inString = false;
        inChar = false;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "'") {
      inChar = true;
      continue;
    }
    if (ch !== '#') continue;

    const match = /^#\s*(include|define|ifndef|ifdef|if|elif|else|endif|pragma|undef|error|warning|line)\b/i.exec(content.slice(index));
    if (!match) continue;
    markers.push({
      line,
      column: index - lineStart,
      directive: match[1].toLowerCase(),
    });
  }
  return markers;
}

function findSourceToolProtocolContamination(content: string): SourceSanityIssue | undefined {
  const match = SOURCE_TOOL_PROTOCOL_RE.exec(content);
  if (!match) return undefined;
  const line = countNewlines(content.slice(0, match.index)) + 1;
  return {
    kind: 'tool-protocol-contamination',
    line,
    detail: `第 ${line} 行附近的源码混入了工具调用协议文本（${match[0]}）。请只写入源码内容，工具调用必须由工具通道执行。`,
  };
}

function findPythonMarkdownDunderCorruption(filePath: string, content: string): SourceSanityIssue | undefined {
  if (!PYTHON_SOURCE_EXT_RE.test(filePath || '')) return undefined;
  const match = PYTHON_MARKDOWN_DUNDER_RE.exec(content);
  if (!match) return undefined;
  const line = countNewlines(content.slice(0, match.index)) + 1;
  return {
    kind: 'markdown-emphasis-dunder-corruption',
    line,
    detail: `第 ${line} 行附近的 Python 特殊标识符疑似被 Markdown 强调语法污染（${match[0]}）。请使用 __name__/__init__/__main__ 这类真实源码标识符。`,
  };
}

function repairCppStringLiteralTransportNewlines(content: string): SourceTransportRepairResult {
  let output = '';
  let inLineComment = false;
  let inBlockComment = false;
  let inChar = false;
  let inString = false;
  let escape = false;
  let repairCount = 0;

  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index];
    const next = content[index + 1];

    if (inLineComment) {
      output += ch;
      if (ch === '\n') {
        inLineComment = false;
        inChar = false;
        escape = false;
      }
      continue;
    }

    if (inBlockComment) {
      output += ch;
      if (ch === '*' && next === '/') {
        output += next;
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (ch === '\r' && next === '\n') {
        output += '\\n';
        repairCount += 1;
        escape = false;
        index += 1;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        output += '\\n';
        repairCount += 1;
        escape = false;
        continue;
      }
      output += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (inChar) {
      output += ch;
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === "'") {
        inChar = false;
      } else if (ch === '\n') {
        inChar = false;
        escape = false;
      }
      continue;
    }

    if (ch === 'R' && next === '"') {
      const rawEnd = findRawStringLiteralEnd(content, index);
      if (rawEnd !== -1) {
        output += content.slice(index, rawEnd + 1);
        index = rawEnd;
        continue;
      }
    }
    if (ch === '/' && next === '/') {
      output += ch + next;
      inLineComment = true;
      index += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      output += ch + next;
      inBlockComment = true;
      index += 1;
      continue;
    }
    if (ch === "'") {
      output += ch;
      inChar = true;
      escape = false;
      continue;
    }
    if (ch === '"') {
      output += ch;
      inString = true;
      escape = false;
      continue;
    }
    output += ch;
  }

  return {
    content: output,
    repaired: repairCount > 0,
    repairCount,
  };
}

function repairCppMacroTransportEscapedNewlines(content: string): SourceTransportRepairResult {
  let repairCount = 0;
  const output = content.split('\n').map((line) => {
    if (!/^\s*#\s*define\b/.test(line) || !/\\n/.test(line)) return line;
    let next = '';
    let inString = false;
    let inChar = false;
    let escape = false;

    for (let index = 0; index < line.length; index += 1) {
      const ch = line[index];
      const following = line[index + 1];

      if (inString) {
        next += ch;
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (inChar) {
        next += ch;
        if (escape) {
          escape = false;
        } else if (ch === '\\') {
          escape = true;
        } else if (ch === "'") {
          inChar = false;
        }
        continue;
      }

      if (ch === '"') {
        next += ch;
        inString = true;
        escape = false;
        continue;
      }
      if (ch === "'") {
        next += ch;
        inChar = true;
        escape = false;
        continue;
      }
      if (ch === '\\' && following === 'n') {
        next += '\\\n';
        repairCount += 1;
        index += 1;
        continue;
      }
      next += ch;
    }
    return next;
  }).join('\n');
  return {
    content: output,
    repaired: repairCount > 0,
    repairCount,
  };
}

function repairCppMacroMarkdownEmphasisEscapes(content: string): SourceTransportRepairResult {
  let repairCount = 0;
  const output = content.replace(/^(\s*#\s*define[^\n]*(?:\*\*VA_ARGS\*\*|\*\*VA_OPT\*\*)[^\n]*)$/gm, (line) => {
    let next = line.replace(/\*\*VA_ARGS\*\*/g, () => {
      repairCount += 1;
      return '__VA_ARGS__';
    });
    next = next.replace(/\*\*VA_OPT\*\*/g, () => {
      repairCount += 1;
      return '__VA_OPT__';
    });
    return next;
  });
  return {
    content: output,
    repaired: repairCount > 0,
    repairCount,
  };
}

function repairPythonMarkdownDunderEscapes(content: string): SourceTransportRepairResult {
  let repairCount = 0;
  const output = content.replace(PYTHON_MARKDOWN_DUNDER_GLOBAL_RE, (_match, name: string) => {
    repairCount += 1;
    return `__${name}__`;
  });
  return {
    content: output,
    repaired: repairCount > 0,
    repairCount,
  };
}

function findRawStringLiteralEnd(content: string, start: number): number {
  const delimiterStart = start + 2;
  const openParen = content.indexOf('(', delimiterStart);
  if (openParen === -1 || openParen - delimiterStart > 16) return -1;
  const delimiter = content.slice(delimiterStart, openParen);
  if (/[\\s()\\\\]/.test(delimiter)) return -1;
  const closeStart = content.indexOf(`)${delimiter}"`, openParen + 1);
  return closeStart === -1 ? -1 : closeStart + delimiter.length + 1;
}

function countNewlines(text: string): number {
  return (text.match(/\n/g) || []).length;
}
