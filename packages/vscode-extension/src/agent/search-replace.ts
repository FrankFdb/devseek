export interface SearchReplaceBlock {
  readonly search: string;
  readonly replace: string;
}

export interface ApplySearchReplaceResult {
  readonly result: string;
  readonly applied: number;
  readonly failed: number;
  readonly errors: readonly string[];
}

/** Parses Aider/Cursor-style targeted edit blocks from one model response. */
export function parseSearchReplaceBlocks(raw: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];
  const pattern = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    blocks.push({ search: match[1], replace: match[2] });
  }
  return blocks;
}

/** Applies exact blocks first, then retries against normalized line endings. */
export function applySearchReplaceBlocks(
  content: string,
  blocks: readonly SearchReplaceBlock[],
): ApplySearchReplaceResult {
  let result = content;
  let applied = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const block of blocks) {
    if (result.includes(block.search)) {
      const index = result.indexOf(block.search);
      result = result.slice(0, index) + block.replace + result.slice(index + block.search.length);
      applied += 1;
      continue;
    }
    const normalizedContent = result.replace(/\r\n/g, '\n');
    const normalizedSearch = block.search.replace(/\r\n/g, '\n');
    if (normalizedContent.includes(normalizedSearch)) {
      const index = normalizedContent.indexOf(normalizedSearch);
      result = normalizedContent.slice(0, index) + block.replace + normalizedContent.slice(index + normalizedSearch.length);
      applied += 1;
      continue;
    }
    failed += 1;
    errors.push(`未找到匹配文本: "${block.search.slice(0, 80).trim()}"`);
  }
  return { result, applied, failed, errors };
}
