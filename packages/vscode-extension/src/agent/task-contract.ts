import * as nodePath from 'path';

export type TaskShape =
  | 'existing-project'
  | 'standalone'
  | 'inspection'
  | 'documentation'
  | 'verification'
  | 'repair'
  | 'resume'
  | 'destructive';

export type QualityObligation =
  | 'source-evidence'
  | 'protocol-facts'
  | 'interface-contract'
  | 'modification-plan'
  | 'project-communication-chain'
  | 'validation';

export interface TaskContract {
  taskShapes: TaskShape[];
  objectives: string[];
  inputs: string[];
  deliverableTargets: string[];
  deliverables: Array<'report' | 'source-change' | 'verification-result'>;
  constraints: string[];
  qualityObligations: QualityObligation[];
  evidenceRequirements: Array<{
    kind: 'source-claim';
    symbol: string;
    validator: 'exact-or-numeric';
    sourcePath?: string;
  }>;
  verificationContract: {
    requireSourceClaimGrounding: boolean;
    requireTitle: boolean;
    requiredSourcePaths: string[];
    exactClaimTable?: {
      symbols: string[];
      rowCount: number;
      forbidAdditionalRows: boolean;
    };
    exactCodeBlocks: Array<{
      language?: string;
      content: string;
    }>;
    requireArtifactReadback: boolean;
    maxWrittenFiles?: number;
  };
}

const PATH_RE = /(?:^|[^A-Za-z0-9_.@+~/-])((?:(?:\/|\.\/|\.\.\/)[\w.@+~/-]+(?:\.[\w-]+)?)|(?:[\w.@+~-]+(?:\/[\w.@+~-]+)*\.(?:cxx|cpp|cc|c|hxx|hpp|hh|h|tsx|ts|jsx|js|py|json|ya?ml|toml|markdown|md)))/gi;
const DOCUMENT_RE = /(?:文档|报告|说明|设计|方案|markdown|\.md\b|document|report)/i;
const INSPECTION_RE = /(?:读取|提取|检查|审计|分析|列出|查看|只读|read|extract|inspect|audit|analy[sz]e)/i;
const CHANGE_RE = /(?:修复|修改|实现|新增|添加|重构|集成|落地|fix|modify|implement|add|refactor)/i;
const STANDALONE_RE = /(?:独立(?:项目|工具|程序|脚本)|standalone|从零|new\s+(?:project|tool))/i;
const PROTOCOL_RE = /(?:协议|schema|request|response|消息字段|命令号|topic|MAVLink|tunnel|串口|通讯方式|通信方式|protocol)/i;
const INTERFACE_RE = /(?:接口文档|接口设计|交互接口|API\b|request.{0,40}response|schema)/i;
const COMMUNICATION_CHAIN_RE = /(?:通信链路|通讯链路|收发链路|端到端链路|主控.{0,100}(?:平台|遥控器)|(?:平台|遥控器).{0,100}主控|(?:参考|复用|对齐).{0,80}(?:通讯|通信|通道|传输|tunnel|MAVLink)|project.?wide communication)/i;
const VALIDATION_RE = /(?:测试|验证|编译|运行|回归|test|verify|validation|compile|build)/i;
const DESTRUCTIVE_RE = /(?:删除|清空|覆盖|重置|drop|delete|remove|reset)/i;
const NO_SOURCE_CHANGE_RE = /(?:不要|禁止|无需|不允许|不得).{0,24}(?:修改|改动).{0,12}(?:源码|代码|文件)|(?:do not|don't|must not).{0,24}(?:modify|change).{0,12}(?:source|code|files?)/i;

/** Provider-independent interpretation of what this task actually requires. */
export function buildTaskContract(promptText: string): TaskContract {
  const prompt = String(promptText || '');
  const documentation = DOCUMENT_RE.test(prompt);
  const inspection = INSPECTION_RE.test(prompt);
  const sourceChange = CHANGE_RE.test(prompt)
    && !NO_SOURCE_CHANGE_RE.test(prompt)
    && (!documentation || /(?:(?:修改|改动|新增|重构|修复).{0,20}(?:源码|代码|文件)|代码实现|实现代码|落地实现|fix|modify|implement|refactor)/i.test(prompt));
  const standalone = STANDALONE_RE.test(prompt);
  const protocol = PROTOCOL_RE.test(prompt);
  const interfaceContract = INTERFACE_RE.test(prompt);
  const communicationChain = COMMUNICATION_CHAIN_RE.test(prompt);
  const explicitModificationPlan = /(?:原有代码修改清单|代码修改清单|修改点清单|existing.?code modification plan)/i.test(prompt);
  const hasSourceInput = /(?:\/src\/|\.(?:c|cc|cpp|h|hpp|ts|tsx|js|py|json|ya?ml|toml)\b)/i.test(prompt);
  const extractsSourceFacts = /(?:提取|列出|核对|读取)[\s\S]{0,240}(?:常量|数值|配置|字段|版本|真实(?:定义|值)|(?:定义|值))|(?:extract|list|verify|read)[\s\S]{0,240}(?:constant|value|config|field|version)/i.test(prompt);
  const shapes = new Set<TaskShape>();
  if (standalone) shapes.add('standalone');
  else if (sourceChange || /(?:既有|现有|原项目|代码库|工程|\/src\/)/i.test(prompt)) shapes.add('existing-project');
  if (inspection) shapes.add('inspection');
  if (documentation) shapes.add('documentation');
  if (sourceChange) shapes.add('repair');
  if (DESTRUCTIVE_RE.test(prompt)) shapes.add('destructive');

  const obligations = new Set<QualityObligation>();
  if (sourceChange || extractsSourceFacts || (inspection && hasSourceInput && protocol)) obligations.add('source-evidence');
  if (protocol) obligations.add('protocol-facts');
  if (interfaceContract) obligations.add('interface-contract');
  if ((sourceChange && !standalone) || explicitModificationPlan) obligations.add('modification-plan');
  if (communicationChain) obligations.add('project-communication-chain');
  if (VALIDATION_RE.test(prompt) && sourceChange) obligations.add('validation');

  const inputOccurrences: Array<{ path: string; index: number }> = [];
  for (const match of prompt.matchAll(PATH_RE)) {
    const matchStart = match.index ?? 0;
    inputOccurrences.push({
      path: match[1],
      index: matchStart + match[0].lastIndexOf(match[1]),
    });
  }
  const inputs = inputOccurrences.map(item => item.path);
  const deliverableTargets = extractDeliverableTargets(prompt, inputOccurrences);
  const evidenceRequirements = extractsSourceFacts
    ? extractEvidenceRequirementSymbols(maskPathOccurrences(prompt, inputOccurrences))
      .map(symbol => ({
        kind: 'source-claim' as const,
        symbol,
        validator: 'exact-or-numeric' as const,
        sourcePath: bindSymbolToSourcePath(prompt, symbol, inputOccurrences),
      }))
    : [];
  const requestedTableRows = extractRequestedTableRowCount(prompt)
    ?? (evidenceRequirements.length > 0 && /(?:表格|table)/i.test(prompt) ? evidenceRequirements.length : undefined);
  const sourceInputs = inputs.filter(input => !/\.(?:md|markdown)$/i.test(input));
  return {
    taskShapes: [...shapes],
    objectives: [prompt.trim()].filter(Boolean),
    inputs: [...new Set(inputs)],
    deliverableTargets,
    deliverables: [
      ...(documentation ? ['report' as const] : []),
      ...(sourceChange ? ['source-change' as const] : []),
      ...(VALIDATION_RE.test(prompt) ? ['verification-result' as const] : []),
    ],
    constraints: NO_SOURCE_CHANGE_RE.test(prompt) ? ['no-source-change'] : [],
    qualityObligations: [...obligations],
    evidenceRequirements,
    verificationContract: {
      requireSourceClaimGrounding: extractsSourceFacts && documentation,
      requireTitle: documentation && /(?:标题|title)/i.test(prompt),
      requiredSourcePaths: /(?:源码路径|源文件路径|source\s+(?:file\s+)?path)/i.test(prompt)
        ? [...new Set(sourceInputs)]
        : [],
      exactClaimTable: evidenceRequirements.length > 0 && requestedTableRows !== undefined
        ? {
          symbols: evidenceRequirements.map(requirement => requirement.symbol),
          rowCount: requestedTableRows,
          forbidAdditionalRows: true,
        }
        : undefined,
      exactCodeBlocks: extractExactCodeBlocks(prompt),
      requireArtifactReadback: /(?:重新读取|再次读取|读回|read\s*(?:it\s*)?back|re-?read)/i.test(prompt),
      maxWrittenFiles: /(?:只|仅)(?:创建|生成|写入)(?:一个|1\s*个)|(?:不要|不得|禁止)[^，。；;\n]{0,16}(?:创建|生成|写入)[^，。；;\n]{0,6}(?:其他|其它|其余)(?:的)?文件|(?:create|write)\s+only\s+one/i.test(prompt)
        ? 1
        : undefined,
    },
  };
}

function maskPathOccurrences(prompt: string, inputs: Array<{ path: string; index: number }>): string {
  const chars = prompt.split('');
  for (const input of inputs) {
    for (let index = input.index; index < input.index + input.path.length; index += 1) {
      chars[index] = ' ';
    }
  }
  return chars.join('');
}

function extractEvidenceRequirementSymbols(prompt: string): string[] {
  const segments: string[] = [];
  const extractionClauses = [
    /(?:提取|列出|核对|读取)([\s\S]{0,320}?)(?=(?:并|然后|并且)?(?:创建|新建|生成|写入|写出|保存|输出|提供|产出|落盘)|[，。；;\n]|$)/gi,
    /\b(?:extract|list|verify|read)\b([\s\S]{0,320}?)(?=\b(?:create|write|save|output|generate|produce)\b|[,.;\n]|$)/gi,
  ];
  for (const regexp of extractionClauses) {
    for (const match of prompt.matchAll(regexp)) segments.push(match[1]);
  }
  const stopWords = new Set([
    'and', 'code', 'config', 'configuration', 'constant', 'constants', 'definition', 'definitions',
    'field', 'fields', 'file', 'from', 'markdown', 'of', 'real', 'report', 'source', 'the', 'true',
    'value', 'values', 'version', 'versions',
  ]);
  const explicit = segments.flatMap(segment => segment.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [])
    .filter(symbol => !stopWords.has(symbol.toLowerCase()));
  if (explicit.length > 0) return [...new Set(explicit)];
  return [...new Set(prompt.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [])]
    .filter(symbol => /^(?:k[A-Z]|[A-Z][A-Z0-9_]+$)/.test(symbol));
}

export function hasQualityObligation(contract: TaskContract, obligation: QualityObligation): boolean {
  return contract.qualityObligations.includes(obligation);
}

/** Exact source facts are an artifact obligation only when the request also asks for a report. */
export function hasSourceClaimArtifactContract(contract: TaskContract): boolean {
  return contract.verificationContract.requireSourceClaimGrounding
    && contract.deliverables.includes('report');
}

export function resolveTaskContractSourcePaths(
  contract: TaskContract,
  availableSourcePaths: readonly string[],
  workspaceRoot?: string,
): TaskContract {
  const uniqueAvailable = [...new Set(availableSourcePaths.filter(Boolean).map(value => nodePath.resolve(value)))];
  const resolveOne = (requested: string | undefined): string | undefined => {
    if (!requested) return undefined;
    const normalizedRequested = requested.replace(/\\/g, '/').replace(/^\.\//, '');
    const direct = nodePath.isAbsolute(requested)
      ? nodePath.resolve(requested)
      : workspaceRoot
        ? nodePath.resolve(workspaceRoot, normalizedRequested)
        : undefined;
    const matches = uniqueAvailable.filter(candidate => {
      if (direct && candidate === direct) return true;
      if (nodePath.isAbsolute(requested)) return false;
      const normalizedCandidate = candidate.replace(/\\/g, '/');
      return normalizedCandidate.endsWith(`/${normalizedRequested}`);
    });
    return matches.length === 1 ? matches[0] : requested;
  };
  return {
    ...contract,
    evidenceRequirements: contract.evidenceRequirements.map(requirement => ({
      ...requirement,
      sourcePath: resolveOne(requirement.sourcePath),
    })),
    verificationContract: {
      ...contract.verificationContract,
      requiredSourcePaths: contract.verificationContract.requiredSourcePaths.map(pathValue => (
        resolveOne(pathValue) || pathValue
      )),
    },
  };
}

function extractRequestedTableRowCount(prompt: string): number | undefined {
  const match = prompt.match(/(?:一个|a)\s*(\d{1,3})\s*(?:行|row)\s*(?:的)?\s*(?:Markdown\s*)?表格|(?:table)[^\n。]{0,30}(\d{1,3})\s*rows?/i)
    || prompt.match(/(\d{1,3})\s*(?:行|row)\s*表格/i);
  const parsed = Number(match?.[1] || match?.[2]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function extractDeliverableTargets(
  prompt: string,
  inputs: Array<{ path: string; index: number }>,
): string[] {
  const targets = inputs.filter(input => {
    if (!/\.(?:md|markdown)$/i.test(input.path)) return false;
    const clauseStart = Math.max(
      prompt.lastIndexOf('\n', input.index),
      prompt.lastIndexOf('。', input.index),
      prompt.lastIndexOf('；', input.index),
      prompt.lastIndexOf(';', input.index),
    ) + 1;
    const prefix = prompt.slice(clauseStart, input.index);
    const followingDelimiters = ['\n', '。', '；', ';']
      .map(delimiter => prompt.indexOf(delimiter, input.index))
      .filter(index => index >= 0);
    const clauseEnd = followingDelimiters.length > 0 ? Math.min(...followingDelimiters) : prompt.length;
    const suffix = prompt.slice(input.index + input.path.length, clauseEnd);
    return /(?:创建|新建|生成|写入|写出|保存|输出|提供|产出|落盘|create|write|save|output|generate)[^\n。；;]{0,100}$/i.test(prefix)
      || (/(?:目标|文件名|路径|target|filename)\s*(?:是|为|:|：|=)?\s*$/i.test(prefix)
        && /^[^\n。；;]{0,100}(?:创建|新建|生成|写入|保存|create|write|save|generate)/i.test(suffix));
  }).map(input => input.path);
  return [...new Set(targets)];
}

function bindSymbolToSourcePath(
  prompt: string,
  symbol: string,
  inputs: Array<{ path: string; index: number }>,
): string | undefined {
  const sources = inputs.filter(input => !/\.(?:md|markdown)$/i.test(input.path));
  if (sources.length === 1) return sources[0].path;
  const symbolIndex = prompt.indexOf(symbol);
  if (symbolIndex < 0 || sources.length === 0) return undefined;
  const clauseStart = Math.max(
    prompt.lastIndexOf('\n', symbolIndex),
    prompt.lastIndexOf('。', symbolIndex),
    prompt.lastIndexOf('；', symbolIndex),
    prompt.lastIndexOf(';', symbolIndex),
  ) + 1;
  const followingDelimiters = ['\n', '。', '；', ';']
    .map(delimiter => prompt.indexOf(delimiter, symbolIndex))
    .filter(index => index >= 0);
  const clauseEnd = followingDelimiters.length > 0 ? Math.min(...followingDelimiters) : prompt.length;
  const localSources = sources.filter(source => source.index >= clauseStart && source.index < clauseEnd);
  return localSources.length === 1 ? localSources[0].path : undefined;
}

function extractExactCodeBlocks(prompt: string): Array<{ language?: string; content: string }> {
  const blocks: Array<{ language?: string; content: string }> = [];
  const seen = new Set<string>();
  const re = /(?:代码内容|代码块内容|块内内容|code\s+content|code\s+block\s+content|content\s+(?:inside|of)\s+(?:the\s+)?code\s+block)[^\n。]{0,32}?(?:必须(?:逐字|严格)?(?:是|为)?|must\s+(?:exactly\s+)?be)\s*[:：]?\s*(?:`([^`\n]+)`|([A-Za-z_]\w*\([^。\n]+?\))(?=[\n。；;]|$))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) {
    const context = prompt.slice(Math.max(0, match.index - 100), match.index + match[0].length);
    const block = {
      language: /\bpython\b[^\n。]{0,32}?(?:代码块|code\s+block)|语言标记[^\n。]{0,24}?\bpython\b/i.test(context)
        ? 'python'
        : undefined,
      content: match[1] || match[2],
    };
    const identity = `${block.language || ''}\0${block.content}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      blocks.push(block);
    }
  }
  return blocks;
}
