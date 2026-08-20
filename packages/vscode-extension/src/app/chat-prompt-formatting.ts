import * as nodePath from 'path';
import type { ChatMessage } from '../llm/types';
import { fenceLangForFile } from '../utils';

export function normalizeConversationFiles(files?: string[]): string[] {
  if (!Array.isArray(files)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of files) {
    const value = (item || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function chatContentText(content: ChatMessage['content'] | undefined): string {
  return typeof content === 'string' ? content : '';
}

export function chatContentStartsWith(content: ChatMessage['content'] | undefined, prefix: string): boolean {
  return chatContentText(content).startsWith(prefix);
}

export function chatContentEquals(content: ChatMessage['content'] | undefined, expected: string): boolean {
  return chatContentText(content) === expected;
}

export function appendStructuredGenerationHint(prompt: string): string {
  return [
    prompt,
    '',
    '【输出格式要求（用于自动落地）】',
    '1. 如果是多文件，请按“文件 1：相对路径”+ 代码块逐个输出。',
    '2. 禁止把目录树、层次图、编译命令放进代码块。',
    '3. 每个代码块只包含该文件源码，不要附加说明文字。',
    '4. 路径请使用相对路径，且与文件名一一对应。',
  ].join('\n');
}

export function appendFileAwareFormatHint(prompt: string, absoluteFilePaths: string[]): string {
  const basenames = absoluteFilePaths.map(f => nodePath.basename(f));
  const exampleLang = (i: number) => fenceLangForFile(basenames[i] ?? '');
  const examples = basenames.slice(0, 3).map((name, i) =>
    `文件 ${i + 1}: ${name}\n\`\`\`${exampleLang(i)}\n// 文件完整内容\n\`\`\``
  );
  if (basenames.length > 3) {
    examples.push(`……（其余 ${basenames.length - 3} 个文件依此格式）`);
  }
  return [
    prompt,
    '',
    '【必须遵守的输出格式（用于自动落地文件）】',
    `涉及以下 ${basenames.length} 个文件的修改，每个代码块前必须有单独文件名标注行，示例：`,
    '',
    examples.join('\n\n'),
    '',
    `文件名列表（共 ${basenames.length} 个）：`,
    basenames.map(n => `  ${n}`).join('\n'),
    '',
    '禁止省略文件名标注，禁止合并多文件输出到一个代码块。',
  ].join('\n');
}

export function buildReformatPrompt(absoluteFilePaths: string[]): string {
  const basenames = absoluteFilePaths.map(f => nodePath.basename(f));
  const examples = basenames.slice(0, 3).map((name, i) => {
    const lang = fenceLangForFile(name);
    return `文件 ${i + 1}: ${name}\n\`\`\`${lang}\n// 文件完整内容\n\`\`\``;
  });
  const extraNote = basenames.length > 3
    ? `\n……（其余 ${basenames.length - 3} 个文件同样格式）`
    : '';
  return [
    '请将上面的修改按以下格式重新整理输出，每个代码块前必须有文件名行，只输出代码，不要解释：',
    '',
    examples.join('\n\n') + extraNote,
    '',
    `文件名从以下列表中选取（共 ${basenames.length} 个）：`,
    basenames.map(n => `  ${n}`).join('\n'),
  ].join('\n');
}
