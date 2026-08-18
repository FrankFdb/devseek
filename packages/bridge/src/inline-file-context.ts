import * as fs from 'fs';
import * as nodePath from 'path';

const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_CHARS = 120_000;

/** Builds the bounded read-only fallback used when DeepSeek Web upload is unavailable. */
export function buildInlineFileContext(files: readonly string[]): string | undefined {
  const sections: string[] = [];
  let totalChars = 0;

  for (const file of files) {
    const content = readBoundedFile(file);
    if (content === undefined) continue;
    const section = [
      `<devseek-file path="${file}">`,
      `\`\`\`${languageForFile(file)}`,
      content.replace(/\s+$/g, ''),
      '\`\`\`',
      '</devseek-file>',
    ].join('\n');
    if (totalChars + section.length > MAX_TOTAL_CHARS) {
      sections.push('[DevSeek Bridge omitted additional files because the inline context budget was reached.]');
      break;
    }
    sections.push(section);
    totalChars += section.length;
  }

  if (sections.length === 0) return undefined;
  return [
    'DevSeek Bridge could not use the DeepSeek Web file-upload control in this session.',
    'It is inlining the selected workspace files below as read-only context.',
    'Use these files only as context; return the requested DevSeek file tool call for edits.',
    '',
    ...sections,
  ].join('\n');
}

function readBoundedFile(file: string): string | undefined {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return undefined;
    const bytesToRead = Math.min(stat.size, MAX_FILE_BYTES);
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      fs.readSync(fd, buffer, 0, bytesToRead, 0);
      const suffix = stat.size > MAX_FILE_BYTES
        ? `\n...[truncated by DevSeek Bridge: ${stat.size} bytes total]`
        : '';
      return buffer.toString('utf8') + suffix;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function languageForFile(file: string): string {
  const languages: Readonly<Record<string, string>> = {
    '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
    '.js': 'javascript', '.jsx': 'jsx', '.json': 'json', '.mjs': 'javascript',
    '.py': 'python', '.ts': 'typescript', '.tsx': 'tsx', '.yml': 'yaml', '.yaml': 'yaml',
  };
  return languages[nodePath.extname(file).toLowerCase()] ?? '';
}
