import * as fs from 'fs';
import * as nodePath from 'path';
import type { WrittenFileEvidence } from './completion-evidence';
import {
  getMissingRequiredDeliverables,
  type RequiredDeliverable,
} from './required-deliverable-contract';
import { isInsideWorkspacePath } from './write-guard';

export type ArtifactQualityIssueCode =
  | 'missing-literal-anchor'
  | 'stale-domain-anchor'
  | 'required-deliverable-mismatch'
  | 'generic-warranty-false-positive'
  | 'artifact-language-mismatch';

export interface WrittenMarkdownQualityInput {
  paths: string[];
  content: string;
  artifacts: Array<{ path: string; content: string }>;
}

export interface ArtifactQualityIssue {
  code: ArtifactQualityIssueCode;
  summary: string;
  risks: string[];
  evidenceRefs: string[];
  requiredActions: string[];
  details?: string[];
}

export interface ArtifactQualityOracleResult {
  feedbackForAI?: string;
  qualityGate?: {
    status: 'pass' | 'fail' | 'blocked';
    summary: string;
    risks?: string[];
    evidenceRefs?: string[];
    alternativeChecks?: string[];
    requiredActions?: string[];
  };
}

const STALE_DOMAIN_ANCHORS = Object.freeze([
  'UAV 吊运维保',
  '维保提醒',
  'maintenance_threshold_engine',
  'uav-warranty-reminder',
  'uav_warranty_reminder',
  'warranty reminder',
  'warranty_types',
  'test_warranty',
]);

const GENERIC_WARRANTY_PHRASES = Object.freeze([
  '定期检查',
  '及时维护',
  '保养记录',
  '维保策略',
  '保修建议',
  'maintenance plan',
  'regular inspection',
  'warranty recommendation',
  'preventive maintenance',
]);

const PROCESS_DOMAIN_RE = /(?:DevSeek|DeepSeek|VSIX|Provider|plugin|R[34](?:[-_\s]|$)|convergence|收敛|权限|编程智能体|质量门禁|agent)/i;
const WARRANTY_DOMAIN_RE = /(?:UAV|吊运|维保|保修|warranty|zc_maintenance|maintenance)/i;
const SOURCE_BACKED_RE = /(?:基于|根据|依据|参考|读取|审计|分析|旧实现|新需求|\b(?:based on|from|according to|read|inspect|audit|source)\b|\/|\\|\.(?:md|ts|js|cpp|hpp|h|py)\b)/i;
const FILE_TOKEN_RE = /(?:\/[^\s，。；;：:"'`<>|]+|(?:\.{0,2}\/)?[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)*)\.(?:cpp|cxx|cc|c|hpp|hxx|hh|h|tsx|jsx|mjs|cjs|ts|js|py|java|go|rs|cs|php|rb|swift|kts|kt|scala|html|scss|sass|css|svelte|vue|bash|zsh|sh|json|ya?ml|md|markdown|txt|cmake)\b/gi;

export function readWrittenMarkdownFilesForQuality(
  writtenFiles: WrittenFileEvidence[],
  workspaceRootFsPath: string,
): WrittenMarkdownQualityInput {
  const root = nodePath.resolve(workspaceRootFsPath || process.cwd());
  const seen = new Set<string>();
  const paths: string[] = [];
  const artifacts: Array<{ path: string; content: string }> = [];
  for (const file of writtenFiles) {
    if (!/\.md$/i.test(file.path) && !/\.md$/i.test(file.basename)) continue;
    const absPath = nodePath.resolve(nodePath.isAbsolute(file.path) ? file.path : nodePath.join(root, file.path));
    if (!isInsideWorkspacePath(absPath, root)) continue;
    try {
      if (!fs.existsSync(absPath) || fs.statSync(absPath).isDirectory()) continue;
      const content = fs.readFileSync(absPath, 'utf8');
      const relPath = nodePath.relative(root, absPath).replace(/\\/g, '/');
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      paths.push(relPath);
      artifacts.push({ path: relPath, content });
    } catch {
      // Lower-level file validation records transient read failures; the
      // quality oracle only acts on artifacts it can inspect deterministically.
    }
  }
  return {
    paths,
    artifacts,
    content: artifacts.map(artifact => artifact.content).join('\n\n'),
  };
}

export function evaluateArtifactQualityOracle(
  writtenFiles: WrittenFileEvidence[],
  workspaceRootFsPath: string,
  userPrompt: string,
): ArtifactQualityOracleResult | undefined {
  const markdown = readWrittenMarkdownFilesForQuality(writtenFiles, workspaceRootFsPath);
  const issues: ArtifactQualityIssue[] = [];

  const missingDeliverables = markdown.paths.length > 0
    ? getMissingRequiredDeliverables(userPrompt, writtenFiles, workspaceRootFsPath)
      .filter(deliverable => isMarkdownDeliverablePath(deliverable.path))
    : [];
  if (missingDeliverables.length > 0) {
    issues.push(requiredDeliverableMismatchIssue(missingDeliverables));
  }

  if (markdown.paths.length > 0) {
    const missingLiteralIssue = evaluateMissingLiteralAnchorIssue(markdown, userPrompt);
    if (missingLiteralIssue) issues.push(missingLiteralIssue);

    const staleDomainIssue = evaluateStaleDomainAnchorIssue(markdown, userPrompt);
    if (staleDomainIssue) issues.push(staleDomainIssue);

    const genericWarrantyIssue = evaluateGenericWarrantyFalsePositiveIssue(markdown, userPrompt);
    if (genericWarrantyIssue) issues.push(genericWarrantyIssue);

    const languageIssue = evaluateArtifactLanguageIssue(markdown, userPrompt);
    if (languageIssue) issues.push(languageIssue);
  }

  if (issues.length === 0) return undefined;
  const summary = `生成文件质量门禁未通过：${issues.map(issue => issue.summary).join('；')}。`;
  return {
    feedbackForAI: formatArtifactQualityFeedback(markdown, issues),
    qualityGate: {
      status: 'fail',
      summary,
      risks: issues.flatMap(issue => issue.risks),
      evidenceRefs: unique(issues.flatMap(issue => issue.evidenceRefs)),
      requiredActions: unique(issues.flatMap(issue => issue.requiredActions)),
    },
  };
}

export function extractRequiredLiteralAnchors(userPrompt: string): string[] {
  const lines = (userPrompt || '').split(/\r?\n/);
  const anchors: string[] = [];
  let collecting = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting && beginsRequiredLiteralAnchorList(trimmed)) {
      collecting = true;
      continue;
    }
    if (!collecting) continue;
    const bullet = /^(?:[-*+]|\d+[.)、])\s+(.+?)\s*$/.exec(trimmed);
    if (!bullet) {
      if (trimmed && anchors.length > 0) break;
      continue;
    }
    const value = cleanRequiredLiteralAnchor(bullet[1]);
    if (value && value.length <= 220 && !anchors.includes(value)) anchors.push(value);
  }
  return anchors;
}

function evaluateMissingLiteralAnchorIssue(
  markdown: WrittenMarkdownQualityInput,
  userPrompt: string,
): ArtifactQualityIssue | undefined {
  const anchors = extractRequiredLiteralAnchors(userPrompt);
  if (anchors.length === 0) return undefined;
  const missing = anchors.filter(anchor => !markdown.content.includes(anchor));
  if (missing.length === 0) return undefined;
  return {
    code: 'missing-literal-anchor',
    summary: `缺少逐字验收锚点 ${missing.join('、')}`,
    risks: missing.map(anchor => `缺少逐字锚点: ${anchor}`),
    evidenceRefs: markdown.paths.map(path => `file:${path}`),
    requiredActions: ['补齐缺失的逐字验收锚点后重新运行自动验证。'],
    details: [`missing_required_anchors=${missing.join(' | ')}`],
  };
}

function evaluateStaleDomainAnchorIssue(
  markdown: WrittenMarkdownQualityInput,
  userPrompt: string,
): ArtifactQualityIssue | undefined {
  if (!PROCESS_DOMAIN_RE.test(promptWithoutFileTokens(userPrompt))) return undefined;
  const staleMatches = [];
  for (const artifact of markdown.artifacts) {
    for (const anchor of STALE_DOMAIN_ANCHORS) {
      for (const context of contextsContaining(artifact.content, anchor)) {
        if (isHistoricalMetaContext(context)) continue;
        staleMatches.push({ path: artifact.path, anchor, context });
      }
    }
  }
  if (staleMatches.length === 0) return undefined;
  const anchors = unique(staleMatches.map(match => match.anchor));
  return {
    code: 'stale-domain-anchor',
    summary: `包含旧维保域锚点 ${anchors.join('、')}`,
    risks: anchors.map(anchor => `旧 case 锚点泄漏到当前 DevSeek/R3/R4 交付物: ${anchor}`),
    evidenceRefs: unique(staleMatches.map(match => `file:${match.path}`)),
    requiredActions: ['删除旧维保域内容，改用当前任务的真实主题、源码路径和验收锚点重新生成交付物。'],
    details: staleMatches.map(match => `${match.path}: ${match.anchor}`),
  };
}

function evaluateGenericWarrantyFalsePositiveIssue(
  markdown: WrittenMarkdownQualityInput,
  userPrompt: string,
): ArtifactQualityIssue | undefined {
  if (!WARRANTY_DOMAIN_RE.test(userPrompt) || !SOURCE_BACKED_RE.test(userPrompt)) return undefined;
  const anchors = extractSourceBackedPromptAnchors(userPrompt);
  if (anchors.length === 0) return undefined;
  const content = markdown.content;
  if (anchors.some(anchor => content.includes(anchor))) return undefined;
  const genericMatches = GENERIC_WARRANTY_PHRASES.filter(phrase => new RegExp(escapeRegExp(phrase), 'i').test(content));
  if (genericMatches.length < 2) return undefined;
  return {
    code: 'generic-warranty-false-positive',
    summary: '维保交付物只有泛化建议，缺少源材料锚点',
    risks: [
      `源材料锚点未落盘: ${anchors.slice(0, 8).join('、')}`,
      `泛化维保措辞命中: ${genericMatches.join('、')}`,
    ],
    evidenceRefs: markdown.paths.map(path => `file:${path}`),
    requiredActions: ['重新读取需求/旧实现源材料，并在交付物中写入可核对的文件名、接口名、常量或路径锚点。'],
    details: [
      `expected_source_anchors=${anchors.join(' | ')}`,
      `generic_phrases=${genericMatches.join(' | ')}`,
    ],
  };
}

function evaluateArtifactLanguageIssue(
  markdown: WrittenMarkdownQualityInput,
  userPrompt: string,
): ArtifactQualityIssue | undefined {
  const expected = inferExpectedArtifactLanguage(userPrompt);
  if (!expected) return undefined;
  const stats = languageStats(stripMarkdownCode(markdown.content));
  const mismatch = expected === 'zh'
    ? stats.cjkChars < 24 && stats.latinWords >= 24
    : stats.cjkChars >= 40 && stats.cjkChars > stats.latinLetters * 0.2;
  if (!mismatch) return undefined;
  const expectedLabel = expected === 'zh' ? '中文' : '英文';
  return {
    code: 'artifact-language-mismatch',
    summary: `交付物语言不符合 ${expectedLabel} 要求`,
    risks: [
      `expected_language=${expected}`,
      `observed_cjk_chars=${stats.cjkChars}`,
      `observed_latin_words=${stats.latinWords}`,
    ],
    evidenceRefs: markdown.paths.map(path => `file:${path}`),
    requiredActions: [`按用户指定的${expectedLabel}重写交付物正文；技术标识符可以保留原文。`],
    details: [`language_stats=cjk:${stats.cjkChars},latinWords:${stats.latinWords},latinLetters:${stats.latinLetters}`],
  };
}

function requiredDeliverableMismatchIssue(missingDeliverables: RequiredDeliverable[]): ArtifactQualityIssue {
  return {
    code: 'required-deliverable-mismatch',
    summary: `缺少指定交付文件 ${missingDeliverables.map(item => item.path).join('、')}`,
    risks: missingDeliverables.map(item => `指定交付文件未由本轮写入满足: ${item.path}`),
    evidenceRefs: missingDeliverables.map(item => `required-deliverable:${item.path}`),
    requiredActions: ['按用户指定路径创建或修改交付文件；不能用输入源文件、相邻文件或摘要文字替代指定交付物。'],
    details: missingDeliverables.map(item => item.source),
  };
}

function beginsRequiredLiteralAnchorList(line: string): boolean {
  return /(?:必须|务必|must|required)[^\n]{0,24}(?:逐字|verbatim|exact)[^\n]{0,24}(?:包含|include|contain)/i.test(line)
    || /(?:以下|如下|下列|following|these)[^\n]{0,24}(?:验收锚点|required\s+(?:anchor|snippet))/i.test(line)
    || /(?:验收锚点|required\s+(?:anchor|snippet))[^\n]{0,16}[:：]\s*$/i.test(line);
}

function cleanRequiredLiteralAnchor(value: string): string {
  return value
    .trim()
    .replace(/^`([\s\S]*?)`$/, '$1')
    .replace(/^["“”']([\s\S]*?)["“”']$/, '$1')
    .trim();
}

function contextsContaining(content: string, anchor: string): string[] {
  const contexts: string[] = [];
  const lower = content.toLocaleLowerCase();
  const needle = anchor.toLocaleLowerCase();
  let index = lower.indexOf(needle);
  while (index >= 0) {
    contexts.push(content.slice(Math.max(0, index - 120), Math.min(content.length, index + anchor.length + 120)));
    index = lower.indexOf(needle, index + Math.max(1, needle.length));
  }
  return contexts;
}

function isHistoricalMetaContext(context: string): boolean {
  return /(?:historical|stale|forbidden|not accepted|cannot satisfy|cannot settle|old case|fixed old|历史|旧\s*case|旧用例|旧产物|禁止|不得|不能作为|不作为|不能结算|反例|只作为背景)/i.test(context);
}

function extractSourceBackedPromptAnchors(prompt: string): string[] {
  const anchors = new Set<string>();
  FILE_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_TOKEN_RE.exec(prompt)) !== null) {
    const normalized = match[0].replace(/\\/g, '/');
    const basename = nodePath.basename(normalized);
    if (basename && basename.length >= 4) anchors.add(basename);
    const stem = basename.replace(/\.(?:md|markdown|ts|js|cpp|hpp|h|py|json|ya?ml|txt)$/i, '');
    if (stem.length >= 8) anchors.add(stem);
  }
  for (const codeToken of prompt.match(/\b[A-Za-z][A-Za-z0-9_]*(?:Service|Policy|Contract|Planner|Engine|Controller|Transport|Bridge|Manager|Adapter|Check|Status|State|Hook|Profile)\b/g) || []) {
    if (codeToken.length >= 6) anchors.add(codeToken);
  }
  return [...anchors].slice(0, 24);
}

function promptWithoutFileTokens(prompt: string): string {
  FILE_TOKEN_RE.lastIndex = 0;
  return String(prompt || '').replace(FILE_TOKEN_RE, ' ');
}

function inferExpectedArtifactLanguage(prompt: string): 'zh' | 'en' | undefined {
  const text = String(prompt || '');
  if (/(?:用|使用|以|按|请|必须|需要|报告|文档|测试报告|测试\s*case|输出|撰写|写成)[^。；;\n]{0,32}(?:中文|简体中文|zh-CN|Chinese)|(?:中文|简体中文|zh-CN)[^。；;\n]{0,32}(?:报告|文档|测试报告|测试\s*case|输出|撰写|写成)/i.test(text)) {
    return 'zh';
  }
  if (/(?:in|write|written|use|must be|output)[^.\n]{0,32}(?:English|en-US)|(?:英文|英语|English|en-US)[^。；;\n.]{0,32}(?:报告|文档|输出|撰写|write|report|document)/i.test(text)) {
    return 'en';
  }
  return undefined;
}

function stripMarkdownCode(content: string): string {
  return String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');
}

function languageStats(content: string): { cjkChars: number; latinLetters: number; latinWords: number } {
  const cjkChars = (content.match(/[\u3400-\u9FFF]/g) || []).length;
  const latinWords = (content.match(/\b[A-Za-z][A-Za-z-]{2,}\b/g) || []).length;
  const latinLetters = (content.match(/[A-Za-z]/g) || []).length;
  return { cjkChars, latinLetters, latinWords };
}

function formatArtifactQualityFeedback(
  markdown: WrittenMarkdownQualityInput,
  issues: ArtifactQualityIssue[],
): string {
  return [
    '[artifact_quality_oracle]',
    markdown.paths.length ? `files=${markdown.paths.join(', ')}` : '',
    ...issues.flatMap(issue => [
      `[artifact_quality:${issue.code}]`,
      issue.summary,
      issue.risks.length ? `risks:\n${issue.risks.map(risk => `- ${risk}`).join('\n')}` : '',
      issue.details?.length ? issue.details.join('\n') : '',
    ]),
    '请读取目标产物和必要源材料，按用户指定路径、逐字锚点、主题域和语言要求修正；不能用 Markdown 自评、固定行数或泛化建议替代机器可核验内容。',
    '完成摘要只能引用修正后的真实文件内容，不能把不合格草稿标记完成。',
  ].filter(Boolean).join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isMarkdownDeliverablePath(filePath: string): boolean {
  return /\.(?:md|markdown)$/i.test(String(filePath || '').replace(/\?.*$/, ''));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
