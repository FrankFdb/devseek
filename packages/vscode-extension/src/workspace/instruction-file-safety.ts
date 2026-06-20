import * as nodePath from 'path';

const INSTRUCTION_BASENAMES = new Set(['AGENTS.md', 'CLAUDE.md']);
const INSTRUCTION_SUFFIXES = [
  '.devseek/rules.md',
  '.github/copilot-instructions.md',
];

export function isProjectInstructionFilePath(filePath: string): boolean {
  const normalized = normalizeSlashPath(filePath);
  const base = nodePath.posix.basename(normalized);
  if (INSTRUCTION_BASENAMES.has(base)) return true;
  return INSTRUCTION_SUFFIXES.some(suffix => normalized === suffix || normalized.endsWith(`/${suffix}`));
}

export function shouldBlockProjectInstructionFileContent(filePath: string, content: string): boolean {
  return isProjectInstructionFilePath(filePath) && looksLikeMisplacedSourceInInstructionFile(content);
}

export function looksLikeMisplacedSourceInInstructionFile(content: string): boolean {
  const text = String(content || '').trim();
  if (!text) return false;

  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;

  const instructionLineCount = lines.filter(looksLikeInstructionLine).length;
  if (instructionLineCount >= 2 && instructionLineCount >= Math.ceil(lines.length * 0.2)) {
    return false;
  }

  const firstLine = lines[0] || '';
  const strongSignals = [
    /^#include\s+["<]/m,
    /^\s*(?:using\s+namespace|namespace\s+\w+|template\s*<)/m,
    /^\s*(?:class|struct|enum)\s+\w+/m,
    /^\s*(?:public|private|protected):\s*$/m,
    /^[\w:<>,~*&\s]+\s+[A-Za-z_]\w*::[A-Za-z_~]\w*\s*\([^;]*\)\s*(?:const\s*)?\{/m,
    /^\s*import\s+.+\s+from\s+['"]/m,
    /^\s*export\s+(?:class|function|const|let|var|interface|type)\b/m,
  ].filter(re => re.test(text)).length;

  const codeLineCount = lines.filter(line =>
    /^#include\s+["<]/.test(line)
    || /(?:^|\s)std::\w+/.test(line)
    || /\b[A-Za-z_]\w*::[A-Za-z_~]\w*\s*\(/.test(line)
    || /[;{}]\s*$/.test(line)
    || /^\s*(?:return|if|for|while|switch|const|let|var|def|class|struct|namespace|template)\b/.test(line)
  ).length;

  if (/^#include\s+["<]/.test(firstLine) && strongSignals >= 1 && codeLineCount >= 3) {
    return true;
  }

  if (/^#include\s+["<]/.test(firstLine) && /\b[A-Za-z_]\w*::[A-Za-z_~]\w*\s*\(/.test(text)) {
    return true;
  }

  return strongSignals >= 2 && codeLineCount >= Math.max(4, Math.ceil(lines.length * 0.35));
}

function looksLikeInstructionLine(line: string): boolean {
  const clean = line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s*/, '').trim();
  return /(?:\b(?:AGENTS|CLAUDE|Codex|Claude|DevSeek|Copilot|instructions?|rules?|guidelines?|principles?|Always|Never|Do not|Prefer|Use)\b|规则|原则|指令|必须|不要|禁止|应该|优先|使用|保持|避免)/i.test(clean);
}

function normalizeSlashPath(filePath: string): string {
  return String(filePath || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
}
