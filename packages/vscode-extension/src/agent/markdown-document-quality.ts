export interface MarkdownDocumentQuality {
  ok: boolean;
  firstLineLength: number;
  maxLineLength: number;
  headingCount: number;
  emptyHeadingCount: number;
  hasCopyControls: boolean;
  gluedMetadataLineCount: number;
  rawChineseSectionCount: number;
  reasons: string[];
}

export interface MarkdownDocumentQualityPolicy {
  minHeadingCount?: number;
}

const MAX_MARKDOWN_FIRST_LINE_CHARS = 260;
const MAX_MARKDOWN_LINE_CHARS = 2_400;
const PROVIDER_COPY_CONTROL_RE = /(?:plain\s*text|text|json|cpp|c\+\+|c|bash|shell|sh|python|typescript|javascript|yaml|yml|xml|html|sql|ini|toml|go|rust|markdown|md)\s*复制\s*下载/gi;
const MARKDOWN_METADATA_LABELS = '文档编号|文档版本|对应需求版本|对应需求|关联需求|关联旧实现|旧实现|参考实现|文档路径|目标路径|创建日期|生成日期|生成时间|文档类型|状态|版本';
const MARKDOWN_METADATA_LABEL_RE = new RegExp(`(?:\\*\\*)?(${MARKDOWN_METADATA_LABELS})(?:\\*\\*)?\\s*[:：]`, 'g');
const MARKDOWN_METADATA_LABEL_FINDER_RE = new RegExp(`(?:\\*\\*)?(?:${MARKDOWN_METADATA_LABELS})(?:\\*\\*)?\\s*[:：]`);
const MARKDOWN_METADATA_LINE_START_RE = new RegExp(`^\\s*(?:[-*]\\s*)?(?:\\*\\*)?(?:${MARKDOWN_METADATA_LABELS})(?:\\*\\*)?\\s*[:：]`);
const MARKDOWN_METADATA_OCCURRENCE_RE = new RegExp(`(?:\\*\\*)?(?:${MARKDOWN_METADATA_LABELS})(?:\\*\\*)?\\s*[:：]`, 'g');
const MARKDOWN_NUMBERED_HEADING_WORD_RE = /(?:文档|目标|依据|范围|需求|差异|旧实现|职责|观察|实现|对策|总体|架构|接口|方向|消息|数据结构|字段|说明|异常|时序|任务|拆分|风险|验证|结论|模块|线程|持久|测试|设计|决策|输入|输出|发布|存储|复位|兼容|主控|平台|遥控器|云端)/;
const MARKDOWN_CHINESE_SECTION_RE = /[一二三四五六七八九十]{1,3}[、.．]\s*/;

export function normalizeProviderMarkdownDocumentText(text: string): string {
  let normalized = String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(PROVIDER_COPY_CONTROL_RE, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  normalized = promoteInlineMetadataTitle(normalized);
  normalized = insertMarkdownDocumentBreaks(normalized);
  normalized = normalizeMarkdownMetadataLines(normalized);
  normalized = normalizeChineseSectionHeadingLines(normalized);
  normalized = normalizeNumberedHeadingLines(normalized);
  normalized = removeEmptyHeadingLines(normalized);
  normalized = wrapOverlongMarkdownLines(normalized);
  return squeezeMarkdownBlankLines(normalized).trim();
}

export function assessMarkdownDocumentQuality(
  text: string,
  policy: MarkdownDocumentQualityPolicy = {},
): MarkdownDocumentQuality {
  const lines = String(text || '').split(/\r?\n/);
  const nonEmpty = lines.map(line => line.trim()).filter(Boolean);
  const firstLineLength = nonEmpty.length ? nonEmpty[0].length : 0;
  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const headingCount = lines.filter(line => /^#{1,6}\s+\S/.test(line.trim())).length;
  const emptyHeadingCount = lines.filter(line => /^#{1,6}\s*$/.test(line.trim())).length;
  const hasCopyControls = hasProviderCopyControlArtifact(text);
  const gluedMetadataLineCount = lines.filter(line => {
    const trimmed = line.trim();
    if (!MARKDOWN_METADATA_LINE_START_RE.test(trimmed)) return false;
    const matches = trimmed.match(MARKDOWN_METADATA_OCCURRENCE_RE);
    return matches && matches.length >= 2;
  }).length;
  const rawChineseSectionCount = lines.filter(line => /^[一二三四五六七八九十]{1,3}[、.．]\s*\S/.test(line.trim())).length;
  const reasons: string[] = [];

  if (!nonEmpty.length) reasons.push('empty-document');
  if (nonEmpty.length > 0 && !/^#{1,6}\s+\S/.test(nonEmpty[0])) reasons.push('missing-title-heading');
  const minHeadingCount = Math.max(1, policy.minHeadingCount ?? 2);
  if (headingCount < minHeadingCount) reasons.push('insufficient-heading-count');
  if (emptyHeadingCount > 0) reasons.push('empty-heading');
  if (firstLineLength > MAX_MARKDOWN_FIRST_LINE_CHARS) reasons.push('first-line-too-long');
  if (maxLineLength > MAX_MARKDOWN_LINE_CHARS) reasons.push('line-too-long');
  if (gluedMetadataLineCount > 0) reasons.push('glued-metadata-lines');
  if (rawChineseSectionCount > 0) reasons.push('raw-chinese-section-headings');
  if (hasCopyControls) reasons.push('provider-copy-controls');

  return {
    ok: reasons.length === 0,
    firstLineLength,
    maxLineLength,
    headingCount,
    emptyHeadingCount,
    hasCopyControls,
    gluedMetadataLineCount,
    rawChineseSectionCount,
    reasons,
  };
}

export function hasAcceptableMarkdownDocumentShape(
  text: string,
  policy: MarkdownDocumentQualityPolicy = {},
): boolean {
  return assessMarkdownDocumentQuality(text, policy).ok;
}

export function hasProviderCopyControlArtifact(text: string): boolean {
  PROVIDER_COPY_CONTROL_RE.lastIndex = 0;
  return PROVIDER_COPY_CONTROL_RE.test(text) || /复制下载/.test(text);
}

function promoteInlineMetadataTitle(text: string): string {
  if (/^#{1,6}\s+\S/.test(text)) return text;
  const match = MARKDOWN_METADATA_LABEL_FINDER_RE.exec(text);
  if (!match || match.index <= 3 || match.index > 160) return text;
  const title = text.slice(0, match.index).trim();
  const rest = text.slice(match.index).trim();
  if (!title || !rest) return text;
  return `# ${title}\n\n${rest}`;
}

function insertMarkdownDocumentBreaks(text: string): string {
  let normalized = insertMarkdownMetadataBreaks(text);

  normalized = normalized.replace(
    /(\.(?:md|markdown))(\d{1,2}(?:\.\d{1,2}){0,4}\.?)\s*(?=\S)/gi,
    (match, ext: string, number: string, offset: number, source: string) => {
      const after = source.slice(offset + match.length, offset + match.length + 16);
      if (!MARKDOWN_NUMBERED_HEADING_WORD_RE.test(after)) return match;
      return `${ext}\n\n${number} `;
    },
  );

  normalized = normalized.replace(
    /([^\nA-Za-z0-9_])(\d{1,2}(?:\.\d{1,2}){0,4}\.?)(?!\d)\s*(?=\S)/g,
    (match, before: string, number: string, offset: number, source: string) => {
      if (isMarkdownHeadingPrefixBeforeNumber(source, offset, before)) return match;
      if (/[(（[【]/.test(before)) return match;
      if (before === '-' && /\d/.test(source[offset - 1] || '')) return match;
      if (before === '.' && /\d/.test(source[offset - 1] || '')) return match;
      const after = source.slice(offset + match.length, offset + match.length + 16);
      if (/^[^。\n]{0,12}[)）\]】]/.test(after)) return match;
      if (!MARKDOWN_NUMBERED_HEADING_WORD_RE.test(after)) return match;
      return `${before}\n\n${number} `;
    },
  );

  normalized = normalized.replace(
    new RegExp(`([^\\n])(${MARKDOWN_CHINESE_SECTION_RE.source}(?=${MARKDOWN_NUMBERED_HEADING_WORD_RE.source}))`, 'g'),
    (_match, before: string, heading: string) => `${before}\n\n${heading}`,
  );

  normalized = normalized.replace(
    /(\.(?:md|markdown))(#{2,6}\s+\d{1,2}(?:\.\d{1,2}){0,4}\.?\s+\S)/gi,
    (_match, ext: string, heading: string) => `${ext}\n\n${heading}`,
  );

  return normalized;
}

function insertMarkdownMetadataBreaks(text: string): string {
  const titleMatch = text.match(/^#{1,6}\s+\S[^\n]*(?:\n{1,2}|$)/);
  const searchStart = titleMatch ? titleMatch[0].length : 0;
  const searchText = text.slice(searchStart);
  const firstLabel = MARKDOWN_METADATA_LABEL_FINDER_RE.exec(searchText);
  if (!firstLabel || firstLabel.index > 240) return text;
  const blockStart = searchStart;
  const blockEnd = findMarkdownMetadataBlockEnd(text, searchStart + firstLabel.index);
  const block = text.slice(blockStart, blockEnd).replace(MARKDOWN_METADATA_LABEL_RE, (_match, label: string, offset: number, source: string) => {
    const prefix = offset > 0 && source[offset - 1] !== '\n' ? '\n' : '';
    return `${prefix}${label}：`;
  });
  return `${text.slice(0, blockStart)}${block}${text.slice(blockEnd)}`;
}

function findMarkdownMetadataBlockEnd(text: string, from: number): number {
  const tail = text.slice(from);
  const candidates = [
    tail.search(/\n\s*---\s*(?:\n|$)/),
    tail.search(/\n#{2,6}\s+\S/),
    tail.search(/#{2,6}\s+\d{1,2}(?:\.\d{1,2}){0,4}\.?\s+\S/),
    findFlattenedNumericHeadingStart(tail),
    tail.search(new RegExp(`${MARKDOWN_CHINESE_SECTION_RE.source}(?=(?:文档|目标|需求|差异|旧实现|职责|观察|实现|对策|总体|架构|接口|风险|验证|后续|任务|主控|平台|遥控器|云端))`)),
    tail.search(/(?:^|\n)##\s*[一二三四五六七八九十]+[、.．]/),
  ].filter(index => index >= 0);
  if (candidates.length === 0) return Math.min(text.length, from + 1_200);
  return from + Math.min(...candidates);
}

function findFlattenedNumericHeadingStart(text: string): number {
  const re = /\d{1,2}(?:\.\d{1,2}){0,4}\.?\s*(?=(?:文档|目标|需求|差异|旧实现|职责|观察|实现|对策|接口|风险|验证|后续|任务))/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const index = match.index;
    const before = index > 0 ? text[index - 1] : '';
    const after = text.slice(index + match[0].length, index + match[0].length + 12);
    if (before === '-' || /\d/.test(before) || MARKDOWN_METADATA_LABEL_FINDER_RE.test(after)) continue;
    return index;
  }
  return -1;
}

function isMarkdownHeadingPrefixBeforeNumber(source: string, offset: number, before: string): boolean {
  if (!/\s/.test(before)) return false;
  const lineStart = source.lastIndexOf('\n', offset) + 1;
  const prefix = source.slice(lineStart, offset + before.length);
  return /^#{1,6}\s*$/.test(prefix);
}

function normalizeMarkdownMetadataLines(text: string): string {
  return text.split('\n').map(line => {
    const match = line.trim().match(new RegExp(`^(?:[-*]\\s*)?(?:\\*\\*)?(${MARKDOWN_METADATA_LABELS})(?:\\*\\*)?\\s*[:：]\\s*(.+)$`));
    if (!match) return line;
    return `- **${match[1]}**：${match[2].trim()}`;
  }).join('\n');
}

function normalizeChineseSectionHeadingLines(text: string): string {
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    const match = trimmed.match(new RegExp(`^(${MARKDOWN_CHINESE_SECTION_RE.source})(.+)$`));
    if (!match || !MARKDOWN_NUMBERED_HEADING_WORD_RE.test(match[2])) return line;
    return `## ${match[1].trim()}${match[2].trim()}`;
  }).join('\n');
}

function normalizeNumberedHeadingLines(text: string): string {
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(\d{1,2}(?:\.\d{1,2}){0,4}\.?)\s+(.+)$/);
    if (!match || !MARKDOWN_NUMBERED_HEADING_WORD_RE.test(match[2])) return line;
    if (/^-\s+\S/.test(match[2].trim())) {
      return `${match[1]} ${match[2].trim().replace(/^-\s+/, '')}`;
    }
    const depth = match[1].replace(/\.$/, '').split('.').filter(Boolean).length;
    const level = Math.min(6, Math.max(2, depth + 1));
    return `${'#'.repeat(level)} ${match[1]} ${match[2].trim()}`;
  }).join('\n');
}

function removeEmptyHeadingLines(text: string): string {
  return text.split('\n').filter(line => !/^#{1,6}\s*$/.test(line.trim())).join('\n');
}

function wrapOverlongMarkdownLines(text: string): string {
  const output: string[] = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }
    if (inFence || line.length <= 900) {
      output.push(line);
      continue;
    }
    output.push(...wrapLongMarkdownLine(line, 860));
  }
  return output.join('\n');
}

function wrapLongMarkdownLine(line: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let rest = line.trim();
  while (rest.length > maxLength) {
    const head = rest.slice(0, maxLength);
    const splitAt = bestMarkdownLineSplitIndex(head, maxLength);
    chunks.push(rest.slice(0, splitAt).trim());
    rest = rest.slice(splitAt).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.length > 0 ? chunks : [line];
}

function bestMarkdownLineSplitIndex(text: string, maxLength: number): number {
  const minUsefulSplit = Math.floor(maxLength * 0.55);
  for (const marker of ['。', '；', ';', '，', ',', '、', ' ']) {
    const index = text.lastIndexOf(marker);
    if (index >= minUsefulSplit) return index + marker.length;
  }
  return maxLength;
}

function squeezeMarkdownBlankLines(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
}
