import {
  projectArtifactClaimValue,
  type ArtifactClaimSpec,
  type ArtifactVerificationContract,
  type ExactGroundedArtifactContract,
} from './evidence-grounding';

export interface ExactGroundedMarkdownResult {
  markdown?: string;
  reason?: string;
}

/**
 * Render a fully executable source-fact contract without provider authorship.
 * Any ambiguity fails closed before a filesystem mutation is attempted.
 */
export function materializeExactGroundedMarkdown(
  verification: ArtifactVerificationContract,
  specs: readonly ArtifactClaimSpec[],
): ExactGroundedMarkdownResult | undefined {
  const contract = verification.exactArtifact;
  if (!contract) return undefined;

  const issue = validateExecutableContract(contract, verification, specs);
  if (issue) return { reason: issue };

  const specsBySymbol = new Map(specs.map(spec => [spec.symbol, spec]));
  const lines = [
    contract.title,
    ...contract.sourcePathLines,
    `| ${contract.tableHeader[0]} | ${contract.tableHeader[1]} |`,
    '| --- | --- |',
    ...contract.symbols.map(symbol => {
      const spec = specsBySymbol.get(symbol)!;
      return `| ${symbol} | ${projectArtifactClaimValue(spec)} |`;
    }),
  ];
  for (const block of contract.codeBlocks) {
    lines.push(`\`\`\`${block.language || ''}`, block.content, '```');
  }
  return { markdown: `${lines.join('\n')}\n` };
}

function validateExecutableContract(
  contract: ExactGroundedArtifactContract,
  verification: ArtifactVerificationContract,
  specs: readonly ArtifactClaimSpec[],
): string | undefined {
  const table = verification.exactClaimTable;
  if (!table || !table.forbidAdditionalRows) {
    return 'exact-artifact: 缺少禁止额外行的 claim 表格契约';
  }
  if (!contract.forbidAdditionalContent) {
    return 'exact-artifact: 缺少禁止额外内容的范围契约';
  }
  if (!isSafeLine(contract.title) || !/^#{1,6}\s+\S/.test(contract.title)) {
    return 'exact-artifact: 标题不是安全的单行 Markdown 标题';
  }
  if (contract.sourcePathLines.length === 0
      || contract.sourcePathLines.length !== (verification.requiredSourcePaths || []).length
      || contract.sourcePathLines.some(line => !isSafeCellOrLine(line))) {
    return 'exact-artifact: 源码路径行不完整或无法安全渲染';
  }
  const requiredPaths = verification.requiredSourcePaths || [];
  if (requiredPaths.some(path => !contract.sourcePathLines.some(line => line.endsWith(path)))) {
    return 'exact-artifact: 源码路径行与已解析来源不一致';
  }
  if (contract.tableHeader.some(cell => !isSafeCell(cell))) {
    return 'exact-artifact: 表头包含无法安全渲染的字符';
  }
  const symbols = contract.symbols;
  if (symbols.length === 0
      || new Set(symbols).size !== symbols.length
      || symbols.length !== table.rowCount
      || symbols.join('\0') !== table.symbols.join('\0')) {
    return 'exact-artifact: claim symbol、顺序或行数不一致';
  }
  const specsBySymbol = new Map<string, ArtifactClaimSpec>();
  for (const spec of specs) {
    if (specsBySymbol.has(spec.symbol)) return `exact-artifact: ${spec.symbol} 存在重复证据`;
    specsBySymbol.set(spec.symbol, spec);
  }
  if (specs.length !== symbols.length || symbols.some(symbol => !specsBySymbol.has(symbol))) {
    return 'exact-artifact: claim 证据与逐字表格契约不一一对应';
  }
  for (const symbol of symbols) {
    const spec = specsBySymbol.get(symbol)!;
    if (!isSafeCell(symbol) || !isSafeCell(projectArtifactClaimValue(spec))) {
      return `exact-artifact: ${symbol} 的源码值无法安全放入 Markdown 表格`;
    }
  }
  if (contract.codeBlocks.length !== (verification.exactCodeBlocks || []).length) {
    return 'exact-artifact: 代码块数量与验证契约不一致';
  }
  for (let index = 0; index < contract.codeBlocks.length; index += 1) {
    const block = contract.codeBlocks[index];
    const expected = verification.exactCodeBlocks?.[index];
    if (!expected
        || block.language !== expected.language
        || block.content !== expected.content
        || !/^[A-Za-z0-9_+-]*$/.test(block.language || '')
        || block.content.includes('```')
        || /\r/.test(block.content)) {
      return `exact-artifact: 第 ${index + 1} 个代码块不完整或无法安全渲染`;
    }
  }
  return undefined;
}

function isSafeLine(value: string): boolean {
  return Boolean(value) && !/[\r\n\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
}

function isSafeCellOrLine(value: string): boolean {
  return isSafeLine(value) && !value.includes('|');
}

function isSafeCell(value: string): boolean {
  return isSafeCellOrLine(value) && value.trim() === value && value.length > 0;
}
