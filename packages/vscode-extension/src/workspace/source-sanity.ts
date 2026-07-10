export interface SourceSanityIssue {
  kind: 'unterminated-string-literal' | 'tool-protocol-contamination' | 'markdown-emphasis-dunder-corruption';
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
const SOURCE_TOOL_PROTOCOL_RE = /(?:\[调用\s+(?:create_file|write_file|replace_in_file|run_terminal|read_file|list_dir|search_file)\]|\bCalling:\s*(?:create_file|write_file|replace_in_file|run_terminal|read_file|list_dir|search_file)\b|<TOOL_[A-Za-z0-9_]+>|<\/TOOL_[A-Za-z0-9_]+>)/;
const PYTHON_DUNDER_NAME_RE = /(?:init|name|main|str|repr|len|iter|next|enter|exit|eq|ne|lt|le|gt|ge|hash|call|dict|class|module|all|file|doc|annotations|slots|getattr|setattr|delattr|contains|getitem|setitem|delitem|bool|bytes|format|new|del)/;
const PYTHON_MARKDOWN_DUNDER_RE = new RegExp(`\\*\\*${PYTHON_DUNDER_NAME_RE.source}\\*\\*`);
const PYTHON_MARKDOWN_DUNDER_GLOBAL_RE = new RegExp(`\\*\\*(${PYTHON_DUNDER_NAME_RE.source})\\*\\*`, 'g');

export function findGeneratedSourceSanityIssue(filePath: string, content: string): SourceSanityIssue | undefined {
  if (!CODE_SOURCE_EXT_RE.test(filePath || '')) return undefined;
  return findSourceToolProtocolContamination(content || '')
    || findPythonMarkdownDunderCorruption(filePath, content || '')
    || (CPP_SOURCE_EXT_RE.test(filePath || '') ? findCppUnterminatedStringLiteral(content || '') : undefined);
}

export function repairGeneratedSourceTransportEscapes(filePath: string, content: string): SourceTransportRepairResult {
  if (!CODE_SOURCE_EXT_RE.test(filePath || '')) {
    return { content, repaired: false, repairCount: 0 };
  }
  let current = content || '';
  let repairCount = 0;
  if (CPP_SOURCE_EXT_RE.test(filePath || '')) {
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
