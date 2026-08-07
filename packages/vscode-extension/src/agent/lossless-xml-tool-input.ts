import { normalizeCodingToolName as normalizeAgentToolName } from '@devseek-netai/shared';

const FULL_FILE_WRITE_NAMES = new Set(['create_file', 'write_file', 'replace_file']);
const PATH_KEYS = ['path', 'filePath', 'filepath', 'filename', 'targetPath'];
const CONTENT_KEYS = ['content', 'contents', 'text', 'body', 'fileContent', 'file_content', 'source', 'code', 'newContent', 'new_content'];
const OLD_TEXT_KEYS = ['old_str', 'oldString', 'old_string', 'oldText', 'old_text', 'search', 'find', 'target'];
const NEW_TEXT_KEYS = ['new_str', 'newString', 'new_string', 'newText', 'new_text', 'replace', 'replacement', 'with'];

/** Parses nested XML mutation parameters without decoding source-code bytes. */
export function parseLosslessXmlMutationInput(
  rawName: string,
  rawBody: string,
): Record<string, unknown> | undefined {
  const name = normalizeAgentToolName(rawName);
  const path = extractXmlParameter(rawBody, PATH_KEYS, false);
  if (path === undefined) return undefined;

  if (FULL_FILE_WRITE_NAMES.has(name)) {
    const content = extractXmlParameter(rawBody, CONTENT_KEYS, true);
    if (content === undefined) return undefined;
    return { path: path.trim(), content };
  }

  if (name === 'replace_in_file') {
    const oldStr = extractXmlParameter(rawBody, OLD_TEXT_KEYS, true);
    const newStr = extractXmlParameter(rawBody, NEW_TEXT_KEYS, true);
    if (oldStr === undefined || newStr === undefined) return undefined;
    const replaceAll = extractXmlParameter(rawBody, ['replaceAll'], false);
    return {
      path: path.trim(),
      old_str: oldStr,
      new_str: newStr,
      ...(replaceAll === undefined ? {} : { replaceAll: /^true$/i.test(replaceAll.trim()) }),
    };
  }

  return undefined;
}

function extractXmlParameter(rawBody: string, keys: string[], preserveLiteral: boolean): string | undefined {
  const names = keys.map(escapeRegExp).join('|');
  const cdata = new RegExp(
    `<\\s*(?:${names})\\b[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/\\s*(?:${names})\\s*>`,
    'i',
  ).exec(rawBody);
  if (cdata) return cdata[1];

  const pair = new RegExp(
    `<\\s*(?:${names})\\b[^>]*>([\\s\\S]*?)<\\/\\s*(?:${names})\\s*>`,
    'i',
  ).exec(rawBody);
  if (!pair) return undefined;
  return preserveLiteral ? pair[1] : decodeXmlScalar(pair[1]);
}

function decodeXmlScalar(value: string): string {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
