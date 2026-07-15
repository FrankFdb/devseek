import { WORKSPACE_FILE_PATH_PATTERN } from '../workspace/path-patterns';

export interface SimpleFileWriteRequest {
  path: string;
  content: string;
}

const SIMPLE_FILE_WRITE_PATH_RE = new RegExp(
  '(?:创建|新建|生成|写入?|create|write)\\s*[`\'"]?(' + WORKSPACE_FILE_PATH_PATTERN.source + ')[`\'"]?',
  'i',
);
const SIMPLE_FILE_EXACT_LINE_CONTENT_RE = /(?:文件)?内容(?:必须|需要|需|应当|应该)?\s*(?:精确|准确|完全)?\s*(?:只)?(?:包含|为|是)\s*(一行|1\s*行)?\s*[:：]?\s*([^\r\n。；;]+)/i;

export function parseSimpleFileWriteRequest(userPrompt: string): SimpleFileWriteRequest | undefined {
  const text = String(userPrompt || '').trim();
  if (!text || text.length > 12000) return undefined;

  const pathMatch = SIMPLE_FILE_WRITE_PATH_RE.exec(text);
  if (!pathMatch || !pathMatch[1]) return undefined;

  const rawPath = pathMatch[1].trim();

  const content = parseSimpleFileContent(text, pathMatch.index);
  if (!content || content.length > 20000) return undefined;

  return { path: rawPath, content };
}

function parseSimpleFileContent(text: string, pathMatchIndex: number): string | undefined {
  const contentMarker = /(?:内容为|内容是|内容如下|写入内容(?:为|是)?|content\s*(?:is|:|=)|with\s+content)\s*[:：]?/i.exec(text);
  if (contentMarker && contentMarker.index >= pathMatchIndex) {
    return normalizeSimpleContent(text.slice(contentMarker.index + contentMarker[0].length).trim());
  }

  const tail = text.slice(pathMatchIndex);
  const exactLineMatch = SIMPLE_FILE_EXACT_LINE_CONTENT_RE.exec(tail);
  if (!exactLineMatch) return undefined;
  const content = normalizeSimpleContent(exactLineMatch[2] || '');
  if (!content) return undefined;
  return exactLineMatch[1] ? `${content}\n` : content;
}

function trimTrailingVerificationClause(value: string): string {
  return value
    .replace(/(?:[，,;；。.]?\s*(?:并|然后|并且|同时|随后)?\s*(?:验证|确认|检查|校验)[\s\S]*)$/i, '')
    .replace(/(?:[，,;；.]?\s*(?:and\s+then\s+|then\s+|and\s+)?(?:verify|check|confirm)\b[\s\S]*)$/i, '')
    .trim();
}

function normalizeSimpleContent(value: string): string {
  const text = trimTrailingVerificationClause(value);
  const unwrapped = unwrapSimpleContent(text);
  if (unwrapped !== text.trim()) return unwrapped;
  return unwrapped.replace(/。$/, '').trimEnd();
}

function unwrapSimpleContent(value: string): string {
  let text = value.trim();
  if (!text) return '';
  const quotePairs: Array<[string, string]> = [['`', '`'], ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’']];
  for (const [open, close] of quotePairs) {
    if (text.startsWith(open) && text.endsWith(close) && text.length >= open.length + close.length) {
      text = text.slice(open.length, text.length - close.length).trim();
      break;
    }
  }
  return text;
}
