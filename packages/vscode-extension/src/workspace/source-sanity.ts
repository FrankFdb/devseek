export interface SourceSanityIssue {
  kind: 'unterminated-string-literal';
  line: number;
  detail: string;
}

export interface SourceTransportRepairResult {
  content: string;
  repaired: boolean;
  repairCount: number;
}

const CPP_SOURCE_EXT_RE = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i;

export function findGeneratedSourceSanityIssue(filePath: string, content: string): SourceSanityIssue | undefined {
  if (!CPP_SOURCE_EXT_RE.test(filePath || '')) return undefined;
  return findCppUnterminatedStringLiteral(content || '');
}

export function repairGeneratedSourceTransportEscapes(filePath: string, content: string): SourceTransportRepairResult {
  if (!CPP_SOURCE_EXT_RE.test(filePath || '')) {
    return { content, repaired: false, repairCount: 0 };
  }
  return repairCppStringLiteralTransportNewlines(content || '');
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
