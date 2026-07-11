import { createHash } from 'crypto';
import * as fs from 'fs';
import * as nodePath from 'path';
import { evaluateCppIntegerConstant } from './cpp-integer-constant';

export type EvidenceKind =
  | 'read'
  | 'edit'
  | 'search'
  | 'terminal'
  | 'network'
  | 'diagnostics'
  | 'memory'
  | 'vscode'
  | 'vscode-command'
  | 'mcp'
  | 'plan'
  | 'tool-call'
  | 'workspace'
  | 'artifact-readback';

export interface EvidenceRef {
  kind: EvidenceKind;
  label: string;
  ref?: string;
  evidenceId?: string;
  operationId?: string;
  workspaceRoot?: string;
  sourcePath?: string;
  lineStart?: number;
  lineEnd?: number;
  contentHash?: string;
  capturedAt?: string;
  captureSequence?: number;
  content?: string;
}

export type ArtifactClaimValidator = 'exact' | 'numeric';

export interface ArtifactClaimSpec {
  claimId: string;
  symbol: string;
  expectedValue: string;
  normalizedExpectedValue: string | number;
  validator: ArtifactClaimValidator;
  evidenceId: string;
  evidenceSequence: number;
  sourcePath: string;
  sourceLine: number;
  sourceHash: string;
}

export interface ArtifactClaim extends ArtifactClaimSpec {
  artifactPath: string;
  artifactLine?: number;
  actualValue?: string;
  normalizedActualValue?: string | number;
  status: 'verified' | 'missing' | 'mismatch' | 'ambiguous' | 'source-drift' | 'missing-source-readback';
  difference?: string;
}

export interface VerificationResult {
  verificationId: string;
  artifactEvidenceId: string;
  artifactPath: string;
  artifactHash: string;
  checkedAt: string;
  ok: boolean;
  claims: ArtifactClaim[];
  differences: string[];
  contractDifferences: string[];
  sourceReadbackEvidenceIds: string[];
}

export interface ArtifactVerificationContract {
  requireTitle?: boolean;
  requiredSourcePaths?: string[];
  exactClaimTable?: {
    symbols: string[];
    rowCount: number;
    forbidAdditionalRows: boolean;
  };
  exactCodeBlocks?: Array<{
    language?: string;
    content: string;
  }>;
  requireArtifactReadback?: boolean;
}

export class EvidenceStore {
  private readonly refs = new Map<string, EvidenceRef>();
  private sequence = 0;

  constructor(
    private readonly workspaceRoot: string,
    private readonly runId = 'local',
    private readonly clock: () => Date = () => new Date(),
  ) {}

  recordFileRead(input: {
    path: string;
    content: string;
    kind?: 'read' | 'artifact-readback';
    operationId?: string;
    lineStart?: number;
    lineEnd?: number;
  }): EvidenceRef {
    const content = String(input.content);
    const contentHash = sha256(content);
    const captureSequence = ++this.sequence;
    const operationId = input.operationId || `${input.kind || 'read'}-${captureSequence}`;
    const evidenceId = `ev-${sha256(`${this.runId}\0${operationId}\0${input.path}\0${contentHash}`).slice(0, 24)}`;
    const ref = Object.freeze({
      kind: input.kind || 'read',
      label: input.path,
      ref: evidenceId,
      evidenceId,
      operationId,
      workspaceRoot: this.workspaceRoot,
      sourcePath: input.path,
      lineStart: input.lineStart ?? 1,
      lineEnd: input.lineEnd ?? (input.lineStart !== undefined
        ? input.lineStart + Math.max(0, countLines(content) - 1)
        : countLines(content)),
      contentHash,
      capturedAt: this.clock().toISOString(),
      captureSequence,
      content,
    }) satisfies EvidenceRef;
    this.refs.set(evidenceId, ref);
    return ref;
  }

  readFile(path: string, kind: 'read' | 'artifact-readback' = 'read'): EvidenceRef {
    return this.recordFileRead({ path, kind, content: fs.readFileSync(path, 'utf8') });
  }

  get(evidenceId: string): EvidenceRef | undefined {
    return this.refs.get(evidenceId);
  }

  all(): EvidenceRef[] {
    return [...this.refs.values()];
  }
}

export interface SourceClaimRequirement {
  symbol: string;
  sourcePath?: string;
}

export function deriveArtifactClaimSpecs(
  requirements: SourceClaimRequirement[],
  evidenceRefs: EvidenceRef[],
): ArtifactClaimSpec[] {
  const specs: ArtifactClaimSpec[] = [];
  for (const requirement of requirements) {
    const matches: ArtifactClaimSpec[] = [];
    for (const evidence of evidenceRefs) {
      if (!evidence.evidenceId
          || !evidence.sourcePath
          || !evidence.content
          || !evidence.contentHash
          || evidence.captureSequence === undefined) continue;
      if (requirement.sourcePath && !samePath(requirement.sourcePath, evidence.sourcePath, evidence.workspaceRoot)) continue;
      for (const definition of parseConstantDefinitions(evidence.content)) {
        if (definition.symbol !== requirement.symbol) continue;
        const normalized = normalizeSourceClaimValue(
          definition.value,
          definition.declarationType,
          definition.symbol,
        );
        matches.push({
          claimId: `claim-${sha256(`${evidence.evidenceId}\0${definition.symbol}`).slice(0, 20)}`,
          symbol: definition.symbol,
          expectedValue: definition.value,
          normalizedExpectedValue: normalized.value,
          validator: normalized.validator,
          evidenceId: evidence.evidenceId,
          evidenceSequence: evidence.captureSequence,
          sourcePath: evidence.sourcePath,
          sourceLine: definition.line,
          sourceHash: evidence.contentHash,
        });
      }
    }
    if (matches.length === 0) {
      throw new Error(`missing-source-evidence: ${requirement.symbol}${requirement.sourcePath ? ` @ ${requirement.sourcePath}` : ''}`);
    }
    const uniqueValues = new Set(matches.map(match => `${match.validator}:${String(match.normalizedExpectedValue)}`));
    if (matches.length > 1 || uniqueValues.size > 1) {
      throw new Error(`ambiguous-source-evidence: ${requirement.symbol} matched ${matches.length} definitions`);
    }
    specs.push(matches[0]);
  }
  return specs;
}

export function verifyArtifactClaims(
  specs: ArtifactClaimSpec[],
  artifactEvidence: EvidenceRef,
  sourceReadbacks: EvidenceRef[],
  contract: ArtifactVerificationContract = {},
): VerificationResult {
  if (specs.length === 0) {
    throw new Error('Artifact verification requires at least one claim spec');
  }
  if (!artifactEvidence.evidenceId
      || !artifactEvidence.sourcePath
      || !artifactEvidence.contentHash
      || artifactEvidence.captureSequence === undefined) {
    throw new Error('Artifact verification requires a persisted read-back EvidenceRef');
  }
  if (contract.requireArtifactReadback && artifactEvidence.kind !== 'artifact-readback') {
    throw new Error('Artifact verification requires an artifact-readback EvidenceRef');
  }
  const content = artifactEvidence.content || '';
  const claims = specs.map(spec => {
    const sourceReadback = sourceReadbacks.find(ref => (
      ref.sourcePath && samePath(spec.sourcePath, ref.sourcePath, ref.workspaceRoot)
    ));
    if (!sourceReadback?.evidenceId
        || sourceReadback.kind !== 'read'
        || !sourceReadback.operationId
        || !sourceReadback.contentHash
        || sourceReadback.captureSequence === undefined
        || sourceReadback.evidenceId === spec.evidenceId
        || artifactEvidence.captureSequence! <= spec.evidenceSequence
        || sourceReadback.captureSequence <= artifactEvidence.captureSequence!) {
      return {
        ...spec,
        artifactPath: artifactEvidence.sourcePath!,
        status: 'missing-source-readback' as const,
        difference: `${spec.symbol}: 缺少生成后的独立源码读回证据（${spec.sourcePath}）`,
      };
    }
    if (sourceReadback.contentHash !== spec.sourceHash) {
      return {
        ...spec,
        artifactPath: artifactEvidence.sourcePath!,
        status: 'source-drift' as const,
        difference: `${spec.symbol}: 源码在生成后发生变化，必须重新收集证据（${spec.sourcePath}）`,
      };
    }
    return verifyClaim(spec, content, artifactEvidence.sourcePath!);
  });
  const contractDifferences = verifyArtifactContract(content, contract);
  const differences = [
    ...claims.flatMap(claim => claim.difference ? [claim.difference] : []),
    ...contractDifferences,
  ];
  const sourceReadbackIdentity = sourceReadbacks
    .map(ref => `${ref.evidenceId || 'missing-id'}:${ref.contentHash || 'missing-hash'}:${ref.captureSequence ?? 'missing-sequence'}`)
    .sort()
    .join(',');
  const verdictIdentity = claims.map(claim => `${claim.claimId}:${claim.status}`).join(',');
  return {
    verificationId: `vr-${sha256(`${artifactEvidence.evidenceId}\0${sourceReadbackIdentity}\0${verdictIdentity}\0${contractDifferences.join('|')}`).slice(0, 24)}`,
    artifactEvidenceId: artifactEvidence.evidenceId,
    artifactPath: artifactEvidence.sourcePath,
    artifactHash: artifactEvidence.contentHash,
    checkedAt: new Date().toISOString(),
    ok: claims.every(claim => claim.status === 'verified') && contractDifferences.length === 0,
    claims,
    differences,
    contractDifferences,
    sourceReadbackEvidenceIds: sourceReadbacks.flatMap(ref => ref.evidenceId ? [ref.evidenceId] : []),
  };
}

function verifyArtifactContract(content: string, contract: ArtifactVerificationContract): string[] {
  const differences: string[] = [];
  const normalized = String(content || '').replace(/\r\n?/g, '\n');
  const firstNonEmpty = normalized.split('\n').find(line => line.trim())?.trim() || '';
  if (contract.requireTitle && !/^#{1,6}\s+\S/.test(firstNonEmpty)) {
    differences.push('structure: 缺少 Markdown 标题');
  }
  for (const sourcePath of contract.requiredSourcePaths || []) {
    if (!normalized.includes(sourcePath)) {
      differences.push(`structure: 缺少源码路径 ${sourcePath}`);
    }
  }
  if (contract.exactClaimTable) {
    differences.push(...verifyExactClaimTable(stripFencedCodeBlocks(normalized), contract.exactClaimTable));
    differences.push(...verifyStrictFactReport(normalized, contract));
  }
  const codeBlocks = parseFencedCodeBlocks(normalized);
  const unmatchedCodeBlockIndexes = new Set(codeBlocks.map((_block, index) => index));
  for (const expected of contract.exactCodeBlocks || []) {
    const matchIndex = codeBlocks.findIndex((block, index) => (
      unmatchedCodeBlockIndexes.has(index)
      && (expected.language
        ? block.language.toLowerCase() === expected.language.toLowerCase()
        : block.language === '')
      && block.content === expected.content
    ));
    if (matchIndex >= 0) {
      unmatchedCodeBlockIndexes.delete(matchIndex);
    } else {
      differences.push(`structure: 缺少精确${expected.language ? ` ${expected.language}` : ''} 代码块 ${expected.content}`);
    }
  }
  if (contract.exactClaimTable && codeBlocks.length !== (contract.exactCodeBlocks || []).length) {
    differences.push(`structure: 代码块数量为 ${codeBlocks.length}，期望 ${(contract.exactCodeBlocks || []).length}`);
  }
  return differences;
}

function verifyExactClaimTable(
  content: string,
  contract: NonNullable<ArtifactVerificationContract['exactClaimTable']>,
): string[] {
  const expected = new Set(contract.symbols);
  const groups: string[][] = [];
  let current: string[] = [];
  for (const line of content.split('\n')) {
    if (line.includes('|')) {
      current.push(line);
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  const candidates = groups.filter(group => group.some(line => contract.symbols.some(symbol => line.includes(symbol))));
  if (candidates.length !== 1) {
    return [`structure: 期望唯一的 ${contract.rowCount} 行 claim 表格，实际找到 ${candidates.length} 个`];
  }
  const rows = candidates[0].map(line => line.split('|').map(cell => stripMarkdown(cell)).filter(Boolean));
  const separatorIndex = rows.findIndex(cells => cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell)));
  const headerRows = separatorIndex === 1 ? rows.slice(0, 1) : [];
  const dataRows = separatorIndex === 1 ? rows.slice(2).filter(cells => cells.length > 0) : [];
  const symbols = dataRows.flatMap(cells => cells.filter(cell => expected.has(cell)));
  const differences: string[] = [];
  if (groups.length !== 1) {
    differences.push(`structure: 检测到 ${groups.length} 个 Markdown 表格，精确事实报告只允许唯一 claim 表格`);
  }
  if (rows.length !== contract.rowCount + 2) {
    differences.push(`structure: claim 表格总行数为 ${rows.length}，期望表头、分隔行和 ${contract.rowCount} 行数据`);
  }
  if (separatorIndex !== 1) {
    differences.push('structure: claim 表格必须在唯一表头后紧跟 Markdown 分隔行');
  }
  if (dataRows.length !== contract.rowCount) {
    differences.push(`structure: claim 表格数据行数为 ${dataRows.length}，期望 ${contract.rowCount}`);
  }
  const nonSeparatorRows = rows.filter(cells => !(cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell))));
  if (nonSeparatorRows.some(cells => cells.length !== 2)) {
    differences.push('scope: 精确事实表格只允许 symbol/value 两列，禁止携带未经证据验证的说明列');
  }
  if (headerRows.length !== 1 || !isAllowedExactClaimHeader(headerRows[0])) {
    differences.push('scope: 精确事实表格表头必须严格为 Symbol/Value 或 常量名/值，禁止写入未经证据验证的事实');
  }
  const uniqueSymbols = new Set(symbols);
  const missing = contract.symbols.filter(symbol => !uniqueSymbols.has(symbol));
  if (missing.length > 0) differences.push(`structure: claim 表格缺少 symbol ${missing.join(', ')}`);
  if (symbols.length !== uniqueSymbols.size) differences.push('structure: claim 表格存在重复 symbol');
  if (contract.forbidAdditionalRows && dataRows.some(cells => !cells.some(cell => expected.has(cell)))) {
    differences.push('structure: claim 表格包含任务范围外的数据行');
  }
  return differences;
}

function verifyStrictFactReport(content: string, contract: ArtifactVerificationContract): string[] {
  const outsideCode = stripFencedCodeBlocks(content);
  const lines = outsideCode.split('\n');
  const headings = lines.filter(line => /^#{1,6}\s+\S/.test(line.trim()));
  const unexpectedLines = lines.filter(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('|') || /^#{1,6}\s+\S/.test(trimmed)) return false;
    return !isExactSourcePathLine(trimmed, contract.requiredSourcePaths || []);
  });
  const differences: string[] = [];
  if (headings.length !== 1) {
    differences.push(`structure: 精确事实报告标题数量为 ${headings.length}，期望 1`);
  } else if (!isAllowedStrictFactTitle(headings[0])) {
    differences.push('scope: 精确事实报告标题必须使用固定无事实模板“源码事实报告”或“Source Facts Report”');
  }
  if (unexpectedLines.length > 0) {
    differences.push(`scope: 精确事实报告包含任务范围外内容：${unexpectedLines[0].trim().slice(0, 120)}`);
  }
  return differences;
}

function stripFencedCodeBlocks(content: string): string {
  return content.replace(/```[^\n`]*\n[\s\S]*?\n```/g, '');
}

function isAllowedExactClaimHeader(cells: string[]): boolean {
  if (cells.length !== 2) return false;
  const first = cells[0].trim().toLowerCase();
  const second = cells[1].trim().toLowerCase();
  return (first === 'symbol' && second === 'value')
    || (first === '常量名' && second === '值');
}

function isAllowedStrictFactTitle(line: string): boolean {
  const title = line.trim();
  return title === '# 源码事实报告' || title === '# Source Facts Report';
}

function isExactSourcePathLine(line: string, sourcePaths: string[]): boolean {
  const plain = line.replace(/\*\*/g, '').replace(/`/g, '').trim();
  return sourcePaths.some(sourcePath => (
    plain === sourcePath
    || new RegExp(`^(?:源码路径|源文件路径|source(?: file)? path)\\s*[:：]\\s*${escapeRegExp(sourcePath)}$`, 'i').test(plain)
  ));
}

function parseFencedCodeBlocks(content: string): Array<{ language: string; content: string }> {
  const blocks: Array<{ language: string; content: string }> = [];
  const re = /```([^\n`]*)\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    blocks.push({ language: match[1].trim(), content: match[2].replace(/\r\n?/g, '\n') });
  }
  return blocks;
}

export function formatClaimVerificationFeedback(result: VerificationResult): string {
  if (result.ok) return '所有源码事实 claim 已逐项验证。';
  return [
    '宿主读回验证发现以下源码事实不一致。只能依据所附源码 EvidenceRef 修复，不得猜测：',
    ...result.differences.map(item => `- ${item}`),
  ].join('\n');
}

function verifyClaim(spec: ArtifactClaimSpec, content: string, artifactPath: string): ArtifactClaim {
  const located = locateArtifactValues(content, spec.symbol);
  if (located.length === 0) {
    return {
      ...spec,
      artifactPath,
      status: 'missing',
      difference: `${spec.symbol}: 缺失；期望 ${spec.expectedValue}（${spec.sourcePath}:${spec.sourceLine}）`,
    };
  }
  if (located.length > 1) {
    return {
      ...spec,
      artifactPath,
      status: 'ambiguous',
      difference: `${spec.symbol}: 交付物表格中出现 ${located.length} 次，无法确定唯一 claim`,
    };
  }
  const actual = located[0];
  const normalized = normalizeClaimValue(actual.value, spec.validator);
  const matches = normalized.value === spec.normalizedExpectedValue;
  return {
    ...spec,
    artifactPath,
    artifactLine: actual.line,
    actualValue: actual.value,
    normalizedActualValue: normalized.value,
    status: matches ? 'verified' : 'mismatch',
    difference: matches
      ? undefined
      : `${spec.symbol}: 实际 ${actual.value}，期望 ${spec.expectedValue}（${spec.sourcePath}:${spec.sourceLine}）`,
  };
}

function locateArtifactValues(content: string, symbol: string): Array<{ value: string; line: number }> {
  const lines = String(content || '').split(/\r?\n/);
  const escaped = escapeRegExp(symbol);
  const candidates = lines
    .map((line, index) => ({ line, index }))
    .filter(item => new RegExp(`\\b${escaped}\\b`).test(item.line));
  const values: Array<{ value: string; line: number }> = [];
  for (const item of candidates.filter(candidate => candidate.line.includes('|'))) {
    const cells = item.line.split('|').map(cell => stripMarkdown(cell));
    const symbolIndex = cells.findIndex(cell => cell === symbol);
    if (symbolIndex >= 0 && cells[symbolIndex + 1]) values.push({ value: cells[symbolIndex + 1], line: item.index + 1 });
  }
  return values;
}

function parseConstantDefinitions(content: string): Array<{
  declarationType: string;
  symbol: string;
  value: string;
  line: number;
}> {
  const source = String(content || '');
  if (/\\\r?\n/.test(source)) {
    throw new Error('unsupported-source-lexing: backslash-newline splicing');
  }
  if (/\?\?[=\/'()!<>-]/.test(source)) {
    throw new Error('unsupported-source-lexing: preprocessing trigraph');
  }
  const lexicalActivity = buildCppLexicalActivity(source);
  assertNoActiveCppPreprocessingDigraph(source, lexicalActivity);
  const preprocessing = evaluateCppPreprocessorActivity(source, lexicalActivity);
  assertNoActiveSourceMacroExpansion(preprocessing);
  assertNoFixedWidthTypeShadowing(preprocessing.activeSource);
  const result: Array<{ declarationType: string; symbol: string; value: string; line: number }> = [];
  splitSourceLines(source).forEach((entry, index) => {
    if (!preprocessing.activeLines[index]) return;
    const line = entry.text;
    const match = line.match(/^\s*(?:(?:inline|static)\s+)*(?:constexpr|const)\s+(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+);/);
    if (!match || !isDefinitionPrefixLexicallyActive(line, entry.start, match[0], lexicalActivity)) return;
    result.push({
      declarationType: match[1].trim(),
      symbol: match[2],
      value: match[3].trim(),
      line: index + 1,
    });
  });
  return result;
}

const FIXED_WIDTH_INTEGER_TYPE = String.raw`u?int(?:8|16|32|64)_t`;

interface SourceLine {
  text: string;
  start: number;
}

interface PreprocessorActivity {
  activeLines: boolean[];
  activeSource: string;
  definedMacrosByLine: Array<ReadonlySet<string>>;
}

interface ConditionalFrame {
  parentActive: boolean;
  branchTaken: boolean;
  currentActive: boolean;
  sawElse: boolean;
}

function splitSourceLines(source: string): SourceLine[] {
  const lines = source.split('\n');
  let start = 0;
  return lines.map(rawLine => {
    const text = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const entry = { text, start };
    start += rawLine.length + 1;
    return entry;
  });
}

function buildCppLexicalActivity(source: string): boolean[] {
  const active = new Array<boolean>(source.length).fill(true);
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const end = source.indexOf('\n', index + 2);
      const stop = end < 0 ? source.length : end;
      markInactive(active, index, stop);
      index = stop;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      if (close < 0) {
        throw new Error('unsupported-source-lexing: unterminated block comment');
      }
      markInactive(active, index, close + 2);
      index = close + 2;
      continue;
    }
    const raw = matchCppRawStringOpening(source, index);
    if (raw) {
      const terminator = `)${raw.delimiter}\"`;
      const close = source.indexOf(terminator, index + raw.openLength);
      if (close < 0) {
        throw new Error('unsupported-source-lexing: unterminated raw string literal');
      }
      const stop = close + terminator.length;
      markInactive(active, index, stop);
      index = stop;
      continue;
    }
    const quote = source[index];
    if (quote === "'"
        && /[0-9A-Fa-f]/.test(source[index - 1] || '')
        && /[0-9A-Fa-f]/.test(source[index + 1] || '')) {
      index++;
      continue;
    }
    if (quote === '"' || quote === "'") {
      let cursor = index + 1;
      let closed = false;
      while (cursor < source.length) {
        if (source[cursor] === '\n' || source[cursor] === '\r') break;
        if (source[cursor] === '\\') {
          cursor += 2;
          continue;
        }
        if (source[cursor] === quote) {
          cursor++;
          closed = true;
          break;
        }
        cursor++;
      }
      if (!closed) {
        throw new Error('unsupported-source-lexing: unterminated string or character literal');
      }
      markInactive(active, index, cursor);
      index = cursor;
      continue;
    }
    index++;
  }
  return active;
}

function matchCppRawStringOpening(
  source: string,
  index: number,
): { delimiter: string; openLength: number } | undefined {
  if (index > 0 && /[A-Za-z0-9_]/.test(source[index - 1])) return undefined;
  const match = source.slice(index).match(/^(?:u8|u|U|L)?R\"([^\s()\\]{0,16})\(/);
  if (!match) return undefined;
  return { delimiter: match[1], openLength: match[0].length };
}

function markInactive(active: boolean[], start: number, end: number): void {
  for (let index = start; index < end; index++) active[index] = false;
}

function assertNoActiveCppPreprocessingDigraph(source: string, lexicalActivity: boolean[]): void {
  const digraph = /%:%:|%:/g;
  let match: RegExpExecArray | null;
  while ((match = digraph.exec(source)) !== null) {
    const matchIndex = match.index;
    if ([...match[0]].every((_character, offset) => lexicalActivity[matchIndex + offset])) {
      throw new Error(`unsupported-source-preprocessing-digraph: ${match[0]}`);
    }
  }
}

function evaluateCppPreprocessorActivity(source: string, lexicalActivity: boolean[]): PreprocessorActivity {
  const lines = splitSourceLines(source);
  const visibleLines = lines.map(line => line.text.split('').map((character, index) => (
    lexicalActivity[line.start + index] ? character : ' '
  )).join(''));
  const includeGuard = detectCanonicalIncludeGuard(visibleLines);
  const activeLines = new Array<boolean>(lines.length).fill(false);
  const definedMacrosByLine: Array<ReadonlySet<string>> = Array.from(
    { length: lines.length },
    () => new Set<string>(),
  );
  const conditionalStack: ConditionalFrame[] = [];
  const definedMacros = new Set<string>();
  let currentActive = true;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let directiveText = visibleLines[lineIndex];
    const directiveStart = directiveText.match(/^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)([\s\S]*)$/);
    if (!directiveStart) {
      if (currentActive && /\b_Pragma\s*\(/.test(directiveText)) {
        throw new Error(`unsupported-source-pragma-operator at line ${lineIndex + 1}`);
      }
      activeLines[lineIndex] = currentActive;
      if (currentActive) definedMacrosByLine[lineIndex] = new Set(definedMacros);
      continue;
    }

    while (/\\\s*$/.test(directiveText) && lineIndex + 1 < lines.length) {
      directiveText = `${directiveText.replace(/\\\s*$/, '')} ${visibleLines[++lineIndex].trim()}`;
      activeLines[lineIndex] = false;
    }
    const directive = directiveText.match(/^\s*#\s*([A-Za-z_][A-Za-z0-9_]*)([\s\S]*)$/)!;
    const name = directive[1];
    const body = directive[2].trim();

    if (name === 'if' || name === 'ifdef' || name === 'ifndef') {
      const parentActive: boolean = currentActive;
      let condition = false;
      if (parentActive) {
        if (name === 'if') {
          condition = evaluateDeterministicPreprocessorCondition(body, lineIndex + 1);
        } else {
          const macro = body.match(/^([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
          if (!macro) {
            throw new Error(`unsupported-source-preprocessing: malformed #${name} at line ${lineIndex + 1}`);
          }
          if (name === 'ifndef' && includeGuard?.ifLine === lineIndex && includeGuard.macro === macro) {
            condition = true;
          } else if (definedMacros.has(macro)) {
            condition = name === 'ifdef';
          } else {
            throw new Error(`unsupported-source-preprocessing: unresolved #${name} ${macro} at line ${lineIndex + 1}`);
          }
        }
      }
      const frame: ConditionalFrame = {
        parentActive,
        branchTaken: parentActive && condition,
        currentActive: parentActive && condition,
        sawElse: false,
      };
      conditionalStack.push(frame);
      currentActive = frame.currentActive;
      continue;
    }

    if (name === 'elif') {
      const frame = conditionalStack.at(-1);
      if (!frame || frame.sawElse) {
        throw new Error(`unsupported-source-preprocessing: unmatched #elif at line ${lineIndex + 1}`);
      }
      const condition = frame.parentActive && !frame.branchTaken
        ? evaluateDeterministicPreprocessorCondition(body, lineIndex + 1)
        : false;
      frame.currentActive = frame.parentActive && !frame.branchTaken && condition;
      frame.branchTaken ||= frame.currentActive;
      currentActive = frame.currentActive;
      continue;
    }

    if (name === 'else') {
      const frame = conditionalStack.at(-1);
      if (!frame || frame.sawElse) {
        throw new Error(`unsupported-source-preprocessing: unmatched #else at line ${lineIndex + 1}`);
      }
      frame.sawElse = true;
      frame.currentActive = frame.parentActive && !frame.branchTaken;
      frame.branchTaken ||= frame.currentActive;
      currentActive = frame.currentActive;
      continue;
    }

    if (name === 'endif') {
      const frame = conditionalStack.pop();
      if (!frame) {
        throw new Error(`unsupported-source-preprocessing: unmatched #endif at line ${lineIndex + 1}`);
      }
      currentActive = frame.parentActive;
      continue;
    }

    if (name === 'define' && currentActive) {
      if (/\b_Pragma\b/.test(body)) {
        throw new Error(`unsupported-source-pragma-operator at line ${lineIndex + 1}`);
      }
      const macro = body.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
      if (!macro) {
        throw new Error(`unsupported-source-preprocessing: malformed #define at line ${lineIndex + 1}`);
      }
      definedMacros.add(macro);
      continue;
    }
    if (name === 'include' && currentActive) {
      const rawIncludeBody = lines[lineIndex].text.match(/^\s*#\s*include\s+(.+?)\s*$/)?.[1] || body;
      assertSupportedSourceInclude(rawIncludeBody, lineIndex + 1);
      continue;
    }
    if ((name === 'include_next' || name === 'import') && currentActive) {
      throw new Error(`unsupported-source-include: #${name} ${body} at line ${lineIndex + 1}`);
    }
    if (name === 'undef' && currentActive) {
      const macro = body.match(/^([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
      if (!macro) {
        throw new Error(`unsupported-source-preprocessing: malformed #undef at line ${lineIndex + 1}`);
      }
      definedMacros.delete(macro);
      continue;
    }
    if (name === 'pragma' && currentActive) {
      if (/\b(?:push_macro|pop_macro)\s*\(/.test(body)) {
        throw new Error(`unsupported-source-pragma-macro-stack at line ${lineIndex + 1}`);
      }
      continue;
    }
    if (currentActive) {
      throw new Error(`unsupported-source-preprocessing-directive: #${name} at line ${lineIndex + 1}`);
    }
  }

  if (conditionalStack.length > 0) {
    throw new Error('unsupported-source-preprocessing: unterminated conditional block');
  }
  if (includeGuard && includeGuard.endLine !== lastMeaningfulLine(visibleLines)) {
    throw new Error('unsupported-source-preprocessing: include guard does not own the complete source');
  }

  const activeSource = lines.map((line, lineIndex) => {
    if (!activeLines[lineIndex]) return ' '.repeat(line.text.length);
    return line.text.split('').map((character, index) => (
      lexicalActivity[line.start + index] ? character : ' '
    )).join('');
  }).join('\n');
  return { activeLines, activeSource, definedMacrosByLine };
}

function detectCanonicalIncludeGuard(
  visibleLines: string[],
): { macro: string; ifLine: number; defineLine: number; endLine: number } | undefined {
  const meaningful = visibleLines
    .map((line, index) => ({ text: line.trim(), index }))
    .filter(entry => entry.text.length > 0);
  if (meaningful.length < 3) return undefined;
  const ifMatch = meaningful[0].text.match(/^#\s*ifndef\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  if (!ifMatch) return undefined;
  const defineMatch = meaningful[1].text.match(/^#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  if (!defineMatch || defineMatch[1] !== ifMatch[1]) return undefined;
  const last = meaningful.at(-1)!;
  if (!/^#\s*endif\b/.test(last.text)) return undefined;
  return { macro: ifMatch[1], ifLine: meaningful[0].index, defineLine: meaningful[1].index, endLine: last.index };
}

function lastMeaningfulLine(visibleLines: string[]): number {
  for (let index = visibleLines.length - 1; index >= 0; index--) {
    if (visibleLines[index].trim()) return index;
  }
  return -1;
}

function evaluateDeterministicPreprocessorCondition(body: string, line: number): boolean {
  const normalized = body.replace(/^\((.*)\)$/, '$1').trim();
  if (normalized === '0') return false;
  if (normalized === '1') return true;
  throw new Error(`unsupported-source-preprocessing: unresolved #if ${body} at line ${line}`);
}

function assertNoActiveSourceMacroExpansion(preprocessing: PreprocessorActivity): void {
  splitSourceLines(preprocessing.activeSource).forEach((line, lineIndex) => {
    const tokens = new Set(line.text.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || []);
    const macro = [...preprocessing.definedMacrosByLine[lineIndex]].find(name => tokens.has(name));
    if (!macro) return;
    if (new RegExp(`^${FIXED_WIDTH_INTEGER_TYPE}$`).test(macro)) {
      throw new Error(`shadowed-fixed-width-integer-type: ${macro}`);
    }
    throw new Error(`unsupported-source-macro-expansion: ${macro}`);
  });
}

function assertNoFixedWidthTypeShadowing(activeSource: string): void {
  for (const tagKeyword of activeSource.matchAll(/\b(?:class|struct|union|enum)\b/g)) {
    const headerEnd = findCppTagHeaderEnd(activeSource, tagKeyword.index + tagKeyword[0].length);
    const declaration = activeSource.slice(tagKeyword.index, headerEnd);
    const fixedWidthToken = declaration.match(new RegExp(`\\b(${FIXED_WIDTH_INTEGER_TYPE})\\b`))?.[1];
    if (!fixedWidthToken) continue;
    // A user-defined tag can legally reuse a stdint spelling. Treating that
    // spelling as a primitive would apply the wrong width/signedness rules.
    throw new Error(`shadowed-fixed-width-integer-type: ${fixedWidthToken}`);
  }
  for (const statement of activeSource.matchAll(/\b(?:typedef|using)\b[\s\S]*?;/g)) {
    const text = statement[0];
    const fixedWidthToken = text.match(new RegExp(`\\b(${FIXED_WIDTH_INTEGER_TYPE})\\b`))?.[1];
    if (fixedWidthToken) {
      // Declarator grammar (attributes, multiple declarators, pointers) is too
      // rich for safe regex inference. Reject this whole subset rather than
      // accidentally trusting a shadowed fixed-width spelling.
      throw new Error(`shadowed-fixed-width-integer-type: ${fixedWidthToken}`);
    }
  }
}

function findCppTagHeaderEnd(activeSource: string, start: number): number {
  let parentheses = 0;
  let brackets = 0;
  for (let index = start; index < activeSource.length; index++) {
    const character = activeSource[index];
    if (character === '(') parentheses++;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === '[') brackets++;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    if (parentheses > 0 || brackets > 0) continue;
    if (character === '{' || character === ';') return index;
    if (character === ':' && activeSource[index - 1] !== ':' && activeSource[index + 1] !== ':') {
      return index;
    }
  }
  return activeSource.length;
}

const SUPPORTED_SOURCE_SYSTEM_INCLUDES = new Set(['cstdint', 'stdint.h', 'string']);

function assertSupportedSourceInclude(body: string, line: number): void {
  const systemHeader = body.match(/^<([^>]+)>$/)?.[1];
  if (systemHeader && SUPPORTED_SOURCE_SYSTEM_INCLUDES.has(systemHeader)) return;
  throw new Error(`unsupported-source-include: ${body} at line ${line}`);
}

function isDefinitionPrefixLexicallyActive(
  line: string,
  lineStart: number,
  matchedDefinition: string,
  lexicalActivity: boolean[],
): boolean {
  const equals = matchedDefinition.indexOf('=');
  if (equals < 0) return false;
  for (let index = 0; index <= equals; index++) {
    if (!/\s/.test(line[index] || '') && !lexicalActivity[lineStart + index]) return false;
  }
  return true;
}

function normalizeSourceClaimValue(
  rawValue: string,
  declarationType: string,
  symbol: string,
): { validator: ArtifactClaimValidator; value: string | number } {
  const raw = String(rawValue || '').trim();
  const stringMatch = raw.match(/^"([^"\\]*)"$/);
  if (stringMatch) {
    if (!isSupportedPlainCStringType(declarationType)) {
      throw new Error(`unsupported-source-string-type: ${symbol} has ${declarationType}`);
    }
    return { validator: 'exact', value: stringMatch[1] };
  }
  if (raw.startsWith('"') || raw.endsWith('"') || /^(?:u8|u|U|L)"/.test(raw)) {
    const reason = raw.includes('\\') ? 'string-escape' : 'string-literal';
    throw new Error(`unsupported-source-${reason}: ${symbol} = ${raw}`);
  }

  const evaluated = evaluateCppIntegerConstant(raw);
  if (!evaluated.ok) {
    throw new Error(`unsupported-source-expression: ${symbol} = ${raw} (${evaluated.error.code})`);
  }
  const declaredType = parseDeclaredIntegerType(declarationType);
  if (!declaredType) {
    throw new Error(`unsupported-source-integer-type: ${symbol} has ${declarationType}`);
  }
  const converted = convertCppInitializerToDeclaredType(evaluated.value, declaredType, symbol);
  return { validator: 'numeric', value: serializeExactInteger(converted) };
}

function isSupportedPlainCStringType(declarationType: string): boolean {
  const normalized = declarationType
    .replace(/\s*\*\s*/g, '*')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === 'const char*' || normalized === 'char const*';
}

function parseDeclaredIntegerType(declarationType: string): { bits: number; signed: boolean } | undefined {
  const normalized = declarationType
    .replace(/\b(?:const|volatile)\b/g, ' ')
    .replace(/\bstd::/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const fixed = normalized.match(/^(u?)int(8|16|32|64)_t$/);
  if (fixed) return { bits: Number(fixed[2]), signed: fixed[1] !== 'u' };
  const builtins = new Map<string, { bits: number; signed: boolean }>([
    ['signed char', { bits: 8, signed: true }],
    ['unsigned char', { bits: 8, signed: false }],
    ['short', { bits: 16, signed: true }],
    ['short int', { bits: 16, signed: true }],
    ['signed short', { bits: 16, signed: true }],
    ['signed short int', { bits: 16, signed: true }],
    ['unsigned short', { bits: 16, signed: false }],
    ['unsigned short int', { bits: 16, signed: false }],
    ['int', { bits: 32, signed: true }],
    ['signed', { bits: 32, signed: true }],
    ['signed int', { bits: 32, signed: true }],
    ['unsigned', { bits: 32, signed: false }],
    ['unsigned int', { bits: 32, signed: false }],
    ['long long', { bits: 64, signed: true }],
    ['long long int', { bits: 64, signed: true }],
    ['signed long long', { bits: 64, signed: true }],
    ['signed long long int', { bits: 64, signed: true }],
    ['unsigned long long', { bits: 64, signed: false }],
    ['unsigned long long int', { bits: 64, signed: false }],
  ]);
  return builtins.get(normalized);
}

function convertCppInitializerToDeclaredType(
  value: bigint,
  type: { bits: number; signed: boolean },
  symbol: string,
): bigint {
  const modulus = 1n << BigInt(type.bits);
  if (!type.signed) return ((value % modulus) + modulus) % modulus;
  const minimum = -(1n << BigInt(type.bits - 1));
  const maximum = (1n << BigInt(type.bits - 1)) - 1n;
  if (value < minimum || value > maximum) {
    throw new Error(`unsupported-source-conversion: ${symbol} initializer is outside signed ${type.bits}-bit range`);
  }
  return value;
}

function serializeExactInteger(value: bigint): string | number {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  return value >= minSafe && value <= maxSafe ? Number(value) : value.toString(10);
}

function normalizeClaimValue(rawValue: string, forcedValidator?: ArtifactClaimValidator): {
  validator: ArtifactClaimValidator;
  value: string | number;
} {
  const raw = stripMarkdown(String(rawValue || '').trim());
  const stringMatch = raw.match(/^(['"])([\s\S]*)\1$/);
  if (forcedValidator === 'exact' || stringMatch) {
    return { validator: 'exact', value: stringMatch ? stringMatch[2] : raw };
  }
  if (forcedValidator === 'numeric') {
    const displayedInteger = normalizeDisplayedDecimalInteger(raw);
    if (displayedInteger !== undefined) return { validator: 'numeric', value: displayedInteger };
  }
  const numeric = evaluateIntegerExpression(raw);
  if (numeric !== undefined) return { validator: 'numeric', value: numeric };
  return { validator: forcedValidator || 'exact', value: raw };
}

function normalizeDisplayedDecimalInteger(value: string): string | number | undefined {
  const match = value.match(/^([+-]?[0-9](?:'?[0-9])*)$/);
  if (!match) return undefined;
  try {
    const parsed = BigInt(match[1].replace(/'/g, ''));
    return serializeExactInteger(parsed);
  } catch {
    return undefined;
  }
}

function evaluateIntegerExpression(value: string): string | number | undefined {
  const evaluated = evaluateCppIntegerConstant(value.trim());
  if (!evaluated.ok) return undefined;
  return serializeExactInteger(evaluated.value);
}

function stripMarkdown(value: string): string {
  const trimmed = String(value || '').trim();
  const opening = trimmed.match(/^`+/)?.[0];
  const closing = trimmed.match(/`+$/)?.[0];
  if (!opening || !closing || opening.length !== closing.length || trimmed.length < opening.length * 2) {
    return trimmed;
  }
  return trimmed.slice(opening.length, -closing.length).trim();
}

function countLines(content: string): number {
  return content ? content.split(/\r?\n/).length : 0;
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function samePath(expected: string, actual: string, workspaceRoot?: string): boolean {
  const expectedAbsolute = canonicalEvidencePath(expected, workspaceRoot);
  const actualAbsolute = canonicalEvidencePath(actual, workspaceRoot);
  if (expectedAbsolute && actualAbsolute) return expectedAbsolute === actualAbsolute;
  return nodePath.normalize(expected) === nodePath.normalize(actual);
}

function canonicalEvidencePath(value: string, workspaceRoot?: string): string | undefined {
  const absolute = nodePath.isAbsolute(value)
    ? nodePath.resolve(value)
    : workspaceRoot
      ? nodePath.resolve(workspaceRoot, value)
      : undefined;
  if (!absolute) return undefined;
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}
