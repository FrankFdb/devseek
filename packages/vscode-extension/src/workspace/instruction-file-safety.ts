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

export interface ProjectInstructionFileWriteDecision {
  allowed: boolean;
  reason?: string;
}

export function decideProjectInstructionFileWrite(input: {
  filePath: string;
  content: string;
  requestPrompt?: string;
}): ProjectInstructionFileWriteDecision {
  const { filePath, content, requestPrompt } = input;
  if (!isProjectInstructionFilePath(filePath)) return { allowed: true };

  if (looksLikeMisplacedSourceInInstructionFile(content)) {
    return {
      allowed: false,
      reason: '项目指令文件不能承载源码实现；请把源码写入真实源文件。',
    };
  }

  if (isExplicitProjectInstructionWriteRequest(requestPrompt, filePath)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: '目标是项目指令文件；只有用户明确要求创建或更新项目指令时才允许写入。',
  };
}

export function shouldBlockProjectInstructionFileWrite(input: {
  filePath: string;
  content: string;
  requestPrompt?: string;
}): boolean {
  return !decideProjectInstructionFileWrite(input).allowed;
}

export function isExplicitProjectInstructionWriteRequest(requestPrompt: string | undefined, filePath: string): boolean {
  const prompt = String(requestPrompt || '').trim();
  if (!prompt) return false;
  const normalizedPrompt = normalizeSlashPath(prompt).toLowerCase();
  const normalizedFile = normalizeSlashPath(filePath).toLowerCase();
  const base = nodePath.posix.basename(normalizedFile);

  const hasWriteIntent = /(?:创建|新建|修改|更新|编辑|补充|写入|维护|生成|重写|调整|完善|初始化|create|write|update|edit|add|maintain|init|scaffold|revise)/i.test(prompt);
  if (!hasWriteIntent) return false;

  const mentionsInstructionPath = normalizedPrompt.includes(normalizedFile)
    || normalizedPrompt.includes(base)
    || /\bagents\.md\b/i.test(prompt)
    || /\bclaude\.md\b/i.test(prompt)
    || /copilot-instructions\.md/i.test(prompt)
    || /(?:\.devseek\/rules\.md|rules\.md)/i.test(prompt);
  const mentionsInstructionConcept = /(?:项目指令|项目规则|智能体指令|代理指令|agent\s+rules?|agent\s+instructions?|codex\s+instructions?|claude\s+instructions?|instructions?|rules?|guidelines?)/i.test(prompt);

  return mentionsInstructionPath || mentionsInstructionConcept;
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
