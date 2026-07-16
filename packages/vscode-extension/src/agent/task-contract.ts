import * as nodePath from 'path';
import type { ExactGroundedArtifactContract } from './evidence-grounding';

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
    exactArtifactRequested: boolean;
    exactArtifact?: ExactGroundedArtifactContract;
    requireArtifactReadback: boolean;
    maxWrittenFiles?: number;
  };
}

const CONTRACT_FILE_EXTENSION_PATTERN = '(?:cxx|cpp|cc|c|hxx|hpp|hh|h|tsx|ts|jsx|js|mjs|cjs|py|json|ya?ml|toml|xml|txt|log|csv|ini|conf|cfg|proto|graphql|sh|bash|zsh|ps1|sql|cmake|gradle|markdown|md)';
const PATH_RE = new RegExp(`(?:^|[^A-Za-z0-9_.@+~/-])((?:(?:/|\\./|\\.\\./)[\\w.@+~/-]+(?:\\.[\\w-]+)?)|(?:[\\w.@+~-]+(?:/[\\w.@+~-]+)*\\.${CONTRACT_FILE_EXTENSION_PATTERN}))`, 'gi');
const DOCUMENT_RE = /(?:文档|报告|说明|设计|方案|markdown|\.md\b|document|report)/i;
const INSPECTION_RE = /(?:读取|提取|检查|审计|分析|列出|查看|总结|摘要|概括|翻译|只读|read|extract|inspect|audit|analy[sz]e|summari[sz]e|translate)/i;
const CHANGE_RE = /(?:修复|修正|修改|实现|新增|添加|重构|集成|落地|替换|重命名|移动|复制|追加|插入|删除|移除|fix|repair|modify|implement|add|refactor|replace|rename|move|copy|append|insert|delete|remove)/i;
const CODE_GENERATION_RE = /(?:(?:编写|写一个|写个|创建|新建|生成|实现|新增|添加|制作)[^，,。；;\n]{0,36}(?:C\+\+|C#|C\s*语言|JavaScript|TypeScript|Python|Java|Go|Rust|程序|脚本|源码|代码|函数|类|模块)|\b(?:create|write|generate|implement|add|build)\b[^,.;\n]{0,36}\b(?:C\+\+|C#|JavaScript|TypeScript|Python|Java|Go|Rust|program|script|code|function|class|module)\b)/i;
const CODE_GENERATION_REPORT_RE = /(?:原有代码修改清单|代码修改清单|修改点清单|代码审计|代码分析|代码说明|代码文档|code\s+(?:review|analysis|audit|report|document|documentation|change\s+list))/i;
const EXPLICIT_SOURCE_IMPLEMENTATION_DELIVERY_RE = /(?:(?:代码实现|实现代码|落地实现)|(?:创建|新建|生成|编写|写入|输出|保存|新增|添加|修改|改动|重构|修复|替换|重命名|移动|复制|追加|插入)[^，,。；;\n]{0,40}(?:源代码文件|源码文件|代码文件|源文件|\bsrc\b|source\s+files?|code\s+files?|\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|ts|tsx|js|jsx|py|java|go|rs)\b))/i;
const STANDALONE_RE = /(?:独立(?:项目|工具|程序|脚本)|standalone|从零|new\s+(?:project|tool))/i;
const EXISTING_PROJECT_SCOPE_RE = /(?:既有|现有|原来|原项目|大项目|正式项目|生产项目|代码库|工程|\/src\/|src\/|CMakeLists\.txt|Makefile|参考.{0,80}模块)/i;
const BROAD_PROJECT_CODE_SCOPE_RE = /(?:整个|全部|全局|项目|仓库|系统|架构|多入口|跨平台|跨模块|模块化|runtime|workflow|provider|权限|状态机)[^，,。；;\n]{0,40}(?:代码|模块|逻辑|runtime|workflow|provider|权限|状态机|code|logic)|(?:代码|模块|逻辑|code|logic)[^，,。；;\n]{0,40}(?:整个|全部|全局|项目|仓库|系统|架构|多入口|跨平台|跨模块|模块化|runtime|workflow|provider|权限|状态机)/i;
const PROTOCOL_RE = /(?:协议|schema|request|response|消息字段|命令号|topic|MAVLink|tunnel|串口|通讯方式|通信方式|protocol)/i;
const INTERFACE_RE = /(?:接口文档|接口设计|交互接口|API\b|request.{0,40}response|schema)/i;
const COMMUNICATION_CHAIN_RE = /(?:通信链路|通讯链路|收发链路|端到端链路|主控.{0,100}(?:平台|遥控器)|(?:平台|遥控器).{0,100}主控|(?:参考|复用|对齐).{0,80}(?:通讯|通信|通道|传输|tunnel|MAVLink)|project.?wide communication)/i;
const VALIDATION_RE = /(?:测试|验证|编译|运行|回归|test|verify|validation|compile|build)/i;
const CONDITIONAL_REPAIR_RE = /(?:(?:运行|执行|测试|验证|编译|构建|run|execute|test|verify|compile|build)[^，,。；;\n]{0,80}(?:如果|若|如有|有|when|if)[^，,。；;\n]{0,40}(?:失败|错误|报错|error|fail)[^，,。；;\n]{0,40}(?:修复|修正|fix|repair)|(?:如果|若|如有|when|if)[^，,。；;\n]{0,40}(?:失败|错误|报错|error|fail)[^，,。；;\n]{0,40}(?:修复|修正|fix|repair))/i;
const DESTRUCTIVE_RE = /(?:删除|清空|覆盖|重置|drop|delete|remove|reset)/i;
const NON_DESTRUCTIVE_CONTENT_DELETE_RE = /(?:删除|移除|删掉|delete|remove)[^，,。；;\n]{0,64}(?:里|中|内|里的|中的|行|内容|注释|字段|配置项|段落|语句|line|lines?|content|comment|field|statement)/i;
const NO_SOURCE_CHANGE_RE = /(?:不要|禁止|无需|不允许|不得).{0,24}(?:修改|改动|修复|重命名|移动|复制|追加|插入).{0,12}(?:源码|代码|文件)|(?:do not|don't|must not).{0,24}(?:modify|change|fix|repair|rename|move|copy|append|insert).{0,12}(?:source|code|files?)/i;
const ARTIFACT_WRITE_ACTION_PATTERN = '(?:(?:通过|以|用|使用)[^，,。；;\\n]{0,12}(?:md|markdown|\\.md)(?:文档|文件|报告)?[^，,。；;\\n]{0,16}(?:提供|输出|给出|返回|保存|生成|产出)|创建|新建|生成|编写|制作|做成|形成|整理成|记录|汇总(?:成|为|到|至|入)|翻译(?=[^，,。；;\\n]{0,24}(?:成|为|到|至|入|保存|输出|写入|文档|文件|报告|markdown|md))|(?:总结|摘要|概括|提取)(?=[^，,。；;\\n]{0,24}(?:成|为|到|至|入|保存|输出|写入|文档|文件|报告|markdown|md))|写入|写出|写到|保存|产出|落盘|更新|修改|改写|改动|编辑|覆盖|删除|删|移除|重命名|移动|复制|追加|插入|写(?!法)|改(?!进)|输出(?=[^，,。；;\\n]{0,16}(?:到|至|为|成|入|markdown|文档|报告))|(?:提供|给出|交付)(?=[^，,。；;\\n]{0,16}(?:markdown|文档|报告))|\\b(?:create|write|compose|draft|render|record|save|generate|produce|update|modify|revise|replace|overwrite|edit|change|delete|remove|touch|rename|move|copy|append|insert|translate)\\b|\\bmake\\s+(?:a\\s+)?changes?\\b|\\boutput(?=[^,.;\\n]{0,20}\\b(?:to|into|as|markdown|report|document)\\b)|\\b(?:provide|deliver)(?=[^,.;\\n]{0,20}\\b(?:markdown|report|document)\\b|[^,.;\\n]{0,36}\\b(?:through|via|as)\\s+(?:an?\\s+)?(?:markdown\\s+)?(?:document|report)\\b)|\\bsummari[sz]e(?:\\s+(?:it|them|the\\s+(?:facts?|results?)))?\\s+(?:into|to|as)\\b)';
const FILE_READ_ACTION_PATTERN = '(?:只读|读取|读出|查看|检查|审计|分析|解释|核对|参考|总结|摘要|概括|翻译|\\b(?:read|inspect|view|check|audit|analy[sz]e|explain|reference|translate)\\b|\\bsummari[sz]e\\b)';
const ARTIFACT_TARGET_HINT_RE = /(?:\.md\b|markdown|文档|报告|文件|artifact|document|report|file)/i;
const MARKDOWN_ARTIFACT_TARGET_HINT_RE = /(?:\.(?:md|markdown)\b|markdown|md\s*(?:文档|文件|报告)|文档|报告|文件|document|report|files?)/i;
const STRONG_NEGATED_WRITE_PREFIX_RE = /(?:不要|不得|禁止|严禁|不可|无需|不用|不需要|不允许|勿|do\s+not|don't|should\s+not|must\s+not|may\s+not|shall\s+not|never)[^，,。；;\n]{0,20}$/i;
const NON_WRITE_NEGATION_THEN_ACTION_RE = /(?:无需|不用|不需要)[^，,。；;\n]{0,16}(?:并|但|然后|而|同时|直接)\s*$/i;
const WEAK_NEGATED_WRITE_SUFFIX_RE = /(?:别(?:再)?|不(?:(?:再)?(?:应(?:该|当)?|可(?:以)?|能|准|许|允许|需要)?(?:再)?))\s*$/i;
const LEXICAL_BIE_PREFIX_RE = /[分个性级类区识特差判辨告离永派]$/;
const SOURCE_OBJECT_PREFIX_RE = /^\s*(?:任何)?(?:(?:(?:正式|生产|原有|原|现有|已有|既有|主项目|原项目)(?:关联)?)?\s*(?:源码|源代码|代码)(?=$|[\s，。；;、目录文件]|并)|(?:(?:formal|production|existing|current|project)\s+)*(?:source(?:\s+code|\s+files?)?|code)\b)/i;
const ARTIFACT_CLAUSE_DELIMITERS = ['\n', '。', '；', ';', '，', ','] as const;
const ARTIFACT_TARGET_LABEL_RE = /(?:(?:目标|输出)?(?:文件|文档|路径)|文件名|目标|target(?:\s+file)?|file(?:name)?)\s*(?:是|为|\bis\b|:|：|=)?\s*$/i;

/**
 * Keep historical/session context available to the model, but never let it
 * reactivate or revoke filesystem authority for the current user turn.
 */
export function extractCurrentUserRequest(promptText: string | undefined): string {
  const raw = String(promptText || '');
  const realtimeUpdates: string[] = [];
  const realtimeBlock = /【用户实时补充\/纠偏】\s*([\s\S]*?)\n\s*请将以上内容作为当前任务的最新约束继续执行；[^\n]*(?=\n|$)/g;
  const authoritySource = raw.replace(realtimeBlock, (_block, update: string) => {
    const normalized = String(update || '').trim();
    if (normalized) realtimeUpdates.push(normalized);
    return '';
  });
  const currentTurn = authoritySource.split('【同一会话续作上下文】')[0].trim();
  const originalMatch = currentTurn.match(/【原始用户需求】\s*([\s\S]*?)(?:\n【本次子任务】|$)/);
  let currentRequest = originalMatch?.[1]?.trim() || '';
  const currentMessageMatch = currentTurn.match(/当前用户消息[:：]\s*([\s\S]*?)(?:\n(?:上一轮 Agent 状态|上一轮|本 session|最近对话摘要)[:：]|$)/);
  if (!currentRequest && currentMessageMatch?.[1]?.trim()) currentRequest = currentMessageMatch[1].trim();
  if (!currentRequest) currentRequest = currentTurn;
  return [currentRequest, ...realtimeUpdates].filter(Boolean).join('\n\n');
}

function hasNegatedWritePrefix(beforeAction: string): boolean {
  if (STRONG_NEGATED_WRITE_PREFIX_RE.test(beforeAction)) {
    return !NON_WRITE_NEGATION_THEN_ACTION_RE.test(beforeAction);
  }
  const weakMatch = beforeAction.match(WEAK_NEGATED_WRITE_SUFFIX_RE);
  if (!weakMatch || weakMatch.index === undefined) return false;
  const marker = weakMatch[0].trimStart();
  const preceding = beforeAction.slice(0, weakMatch.index);
  if (marker.startsWith('别') && LEXICAL_BIE_PREFIX_RE.test(preceding)) return false;
  // “无不” is affirmative; a standalone/imperative “不” remains a prohibition.
  if (marker.startsWith('不') && /无$/.test(preceding)) return false;
  return true;
}

function findClauseBounds(text: string, index: number): { start: number; end: number } {
  const sentenceDelimiters = [...text.matchAll(/[.!?！？](?=\s|$)/g)].map(match => match.index ?? -1);
  const start = Math.max(
    ...ARTIFACT_CLAUSE_DELIMITERS.map(delimiter => text.lastIndexOf(delimiter, index)),
    ...sentenceDelimiters.filter(candidate => candidate < index),
  ) + 1;
  const following = ARTIFACT_CLAUSE_DELIMITERS
    .map(delimiter => text.indexOf(delimiter, index))
    .filter(candidate => candidate >= 0)
    .concat(sentenceDelimiters.filter(candidate => candidate >= index));
  return { start, end: following.length > 0 ? Math.min(...following) : text.length };
}

interface PathOccurrence {
  path: string;
  index: number;
}

interface MutationActionSpan {
  index: number;
  end: number;
  clauseStart: number;
  clauseEnd: number;
  prohibited: boolean;
}

interface TargetMutationDecision extends ArtifactWriteIntentClassification {
  actionIndex?: number;
  mentioned?: boolean;
  readOnly?: boolean;
}

function collectMutationActionSpans(
  prompt: string,
  maskedOccurrences: PathOccurrence[],
  includeSourceDirectedActions: boolean,
): { searchablePrompt: string; actions: MutationActionSpan[] } {
  const searchablePrompt = maskPathOccurrences(prompt, maskedOccurrences);
  const actionRe = new RegExp(ARTIFACT_WRITE_ACTION_PATTERN, 'gi');
  const actions = [...searchablePrompt.matchAll(actionRe)].flatMap(match => {
    const index = match.index ?? 0;
    const { start, end } = findClauseBounds(searchablePrompt, index);
    const after = searchablePrompt.slice(index + match[0].length, end);
    if (!includeSourceDirectedActions && SOURCE_OBJECT_PREFIX_RE.test(after)) return [];
    return [{
      index,
      end: index + match[0].length,
      clauseStart: start,
      clauseEnd: end,
      prohibited: hasNegatedWritePrefix(searchablePrompt.slice(start, index)),
    }];
  });
  return { searchablePrompt, actions };
}

function classifyPathOccurrenceMutation(
  prompt: string,
  occurrence: PathOccurrence,
  allOccurrences: PathOccurrence[],
  includeSourceDirectedActions = false,
): TargetMutationDecision {
  const { searchablePrompt, actions } = collectMutationActionSpans(
    prompt,
    allOccurrences,
    includeSourceDirectedActions,
  );
  const { start, end } = findClauseBounds(searchablePrompt, occurrence.index);
  const explicitRole = classifyExplicitPathRole(
    prompt,
    occurrence,
    start,
    end,
    allOccurrences.some(item => item.index > occurrence.index && item.index < end),
  );
  const passive = classifyPassivePathMutation(prompt, occurrence, start, end);
  if (passive && explicitRole?.kind !== 'read') return { ...passive, mentioned: true };
  let localActions = actions.filter(action => action.clauseStart === start && action.clauseEnd === end);
  let localReads = collectReadActionSpans(searchablePrompt)
    .filter(action => action.clauseStart === start && action.clauseEnd === end);
  const prefix = prompt.slice(start, occurrence.index);
  const targetFirst = ARTIFACT_TARGET_LABEL_RE.test(prefix)
    || /(?:(?:目标|输出)?(?:文件|文档|路径)|文件名|target(?:\s+file)?|file(?:name)?)[^，,。；;\n]{0,100}$/i.test(prefix)
    || hasStandaloneTargetFirstMarker(prefix)
    || /\bfor\s*$/i.test(prefix);
  if (localActions.length === 0 && targetFirst && end < prompt.length) {
    const nextClause = findClauseBounds(searchablePrompt, end + 1);
    localActions = actions.filter(action => (
      action.clauseStart === nextClause.start && action.clauseEnd === nextClause.end
    ));
    localReads = collectReadActionSpans(searchablePrompt).filter(action => (
      action.clauseStart === nextClause.start && action.clauseEnd === nextClause.end
    ));
  }
  if (explicitRole?.kind === 'prohibited') {
    return { requested: false, prohibited: true, mentioned: true, actionIndex: occurrence.index };
  }
  if (localActions.length === 0) {
    return {
      requested: false,
      prohibited: false,
      mentioned: true,
      readOnly: explicitRole?.kind === 'read' || localReads.length > 0,
    };
  }
  const distance = (action: MutationActionSpan): number => (
    action.end <= occurrence.index
      ? occurrence.index - action.end
      : action.index - (occurrence.index + occurrence.path.length)
  );
  const nearest = localActions.reduce((selected, candidate) => (
    Math.abs(distance(candidate)) < Math.abs(distance(selected)) ? candidate : selected
  ));
  const nearestRead = localReads.reduce<MutationActionSpan | undefined>((selected, candidate) => (
    !selected || Math.abs(distance(candidate)) < Math.abs(distance(selected)) ? candidate : selected
  ), undefined);
  if ((explicitRole?.kind === 'read'
      && (nearest.index > occurrence.index || explicitRole.index >= nearest.index))
    || (nearestRead && Math.abs(distance(nearestRead)) <= Math.abs(distance(nearest)))
    || isResponseDirectedMutationForOccurrence(prompt, nearest, occurrence)) {
    return {
      requested: false,
      prohibited: false,
      mentioned: true,
      readOnly: true,
      actionIndex: nearestRead?.index ?? nearest.index,
    };
  }
  return nearest.prohibited
    ? { requested: false, prohibited: true, mentioned: true, actionIndex: nearest.index }
    : { requested: true, prohibited: false, mentioned: true, actionIndex: nearest.index };
}

function collectReadActionSpans(searchablePrompt: string): MutationActionSpan[] {
  const readRe = new RegExp(FILE_READ_ACTION_PATTERN, 'gi');
  return [...searchablePrompt.matchAll(readRe)].map(match => {
    const index = match.index ?? 0;
    const { start, end } = findClauseBounds(searchablePrompt, index);
    return {
      index,
      end: index + match[0].length,
      clauseStart: start,
      clauseEnd: end,
      prohibited: false,
    };
  });
}

function classifyExplicitPathRole(
  prompt: string,
  occurrence: PathOccurrence,
  clauseStart: number,
  clauseEnd: number,
  hasFollowingPath: boolean,
): { kind: 'read' | 'prohibited'; index: number } | undefined {
  const before = prompt.slice(clauseStart, occurrence.index);
  const after = prompt.slice(occurrence.index + occurrence.path.length, clauseEnd);
  if (/(?:但|但是|而)?\s*(?:不要|不得|禁止|别|非|不是|而不是)\s*$/i.test(before)
    || /\b(?:but\s+not|not|instead\s+of|rather\s+than)\s*$/i.test(before)
    || /^\s*(?:为|是)?\s*只读\b/i.test(after)
    || /^\s*(?:is|must\s+remain)\s+read[- ]only\b/i.test(after)) {
    return { kind: 'prohibited', index: occurrence.index };
  }
  const beforeRead = before.match(/(?:读取|查看|检查|审计|分析|解释|参考|根据|基于|依据|利用|使用|模板|输入|从)\s*[^，,。；;\n]{0,24}$/i)
    || before.match(/(?:总结|摘要|概括|翻译|提取)(?![^，,。；;\n]{0,16}(?:成|为|到|至|入)\s*$)\s*[^，,。；;\n]{0,24}$/i)
    || before.match(/\b(?:read|inspect|view|check|audit|analy[sz]e|explain|extract|reference|using|use|from|based\s+on|according\s+to|template|input)\s+[^,.;\n]{0,28}$/i)
    || before.match(/\b(?:summari[sz]e|translate)(?![^,.;\n]{0,20}\b(?:to|into|as)\s*$)\s+[^,.;\n]{0,28}$/i)
    || before.match(/(?:内容|contents?)\s+(?:of|from|in)\s+(?:the\s+)?$/i)
    || before.match(/(?:而不是|而非)\s*$/i)
    || before.match(/\b(?:instead\s+of|rather\s+than)\s*$/i);
  const afterRead = after.match(/^\s*(?:作为|当作|用作|为)\s*(?:输入|模板|参考|来源)/i)
    || after.match(/^\s*(?:的)?\s*内容[^，,。；;\n]{0,16}(?:写|输出|汇总|保存|生成|渲染|总结|摘要|概括|翻译|提取)(?:(?:到|入|至|为|成)|\s)/i)
    || after.match(/^\s+as\s+(?:an?\s+)?(?:input|template|reference|source)\b/i)
    || after.match(/^\s+contents?\s+(?:as|in|into|to)\b/i)
    || (hasFollowingPath && (
      after.match(/^\s+(?:as|into|to)\b/i)
      || after.match(/^\s*(?:保存|生成|渲染|写入|写出|输出)(?:为|成|到|至|入)/i)
      || after.match(/^\s*(?:并|然后|再)?\s*(?:复制|翻译|总结|摘要|概括|提取)[^，,。；;\n]{0,24}(?:到|至|为|成|入)|^\s*(?:copy|translate|summari[sz]e)[^,.;\n]{0,24}\b(?:to|into|as)\b/i)
    ));
  if (beforeRead) {
    return { kind: 'read', index: clauseStart + (beforeRead.index ?? 0) };
  }
  if (afterRead) {
    return { kind: 'read', index: occurrence.index + occurrence.path.length + (afterRead.index ?? 0) };
  }
  return undefined;
}

function classifyPassivePathMutation(
  prompt: string,
  occurrence: PathOccurrence,
  clauseStart: number,
  clauseEnd: number,
): TargetMutationDecision | undefined {
  const before = prompt.slice(clauseStart, occurrence.index);
  const after = prompt.slice(occurrence.index + occurrence.path.length, clauseEnd);
  const passive = after.match(/^\s*["'\x60”’]?\s*(?:应当|应该|必须|可以|允许|may|must|shall|should|can)?\s*(?:被|be\s+)?(?:创建|新建|生成|写入|保存|更新|修改|编辑|删除|重命名|移动|复制|追加|插入|created\b|written\b|saved\b|updated\b|modified\b|edited\b|deleted\b|renamed\b|moved\b|copied\b|appended\b|inserted\b)/i);
  if (!passive) return undefined;
  const actionIndex = occurrence.index + occurrence.path.length + (passive.index ?? 0);
  return hasNegatedWritePrefix(before)
    ? { requested: false, prohibited: true, actionIndex }
    : { requested: true, prohibited: false, actionIndex };
}

function isResponseDirectedMutationForOccurrence(
  prompt: string,
  action: MutationActionSpan,
  occurrence: PathOccurrence,
): boolean {
  const clause = prompt.slice(action.clauseStart, action.clauseEnd);
  if (!hasResponseSink(clause)) return false;
  const actionText = prompt.slice(action.index, action.end);
  if (/(?:汇总|总结|写|输出|返回)|summari[sz]e|output|write|send|return/i.test(actionText)) return true;
  const beforePath = prompt.slice(action.end, occurrence.index);
  const beforeAction = prompt.slice(Math.max(action.clauseStart, action.index - 40), action.index);
  if (/(?:内容|contents?)(?:\s+of)?[^，,。；;\n]{0,24}$/i.test(beforePath)
    || /(?:内容|contents?)[^，,。；;\n]{0,24}$/i.test(beforeAction)) return true;
  return occurrence.index < action.index;
}

function hasStandaloneTargetFirstMarker(prefix: string): boolean {
  const match = prefix.match(/(把|将|在|向|往|于)\s*$/u);
  if (!match || match.index === undefined) return false;
  const before = prefix.slice(0, match.index);
  const previous = before.at(-1) || '';
  const lexicalPrefixes: Record<string, RegExp> = {
    '把': /拖/u,
    '将': /[即必]/u,
    '在': /[现存所正]/u,
    '向': /[面方倾导趋]/u,
    '往': /[以过来前]/u,
    '于': /[基关由用对源鉴限处位属善]/u,
  };
  return !lexicalPrefixes[match[1]].test(previous);
}

function classifyTargetFileMutation(
  prompt: string,
  targetPath: string,
  workspaceRoot?: string,
): TargetMutationDecision {
  const target = nodePath.normalize(nodePath.resolve(targetPath));
  const extracted = extractPathOccurrences(prompt);
  const mentions = extracted.filter(occurrence => (
    resolveRequestedFileTarget(occurrence.path, workspaceRoot) === target
  ));
  for (const literal of buildTargetMentionLiterals(target, workspaceRoot)) {
    let fromIndex = 0;
    while (fromIndex < prompt.length) {
      const index = prompt.toLocaleLowerCase().indexOf(literal.toLocaleLowerCase(), fromIndex);
      if (index < 0) break;
      const before = prompt[index - 1] || '';
      const after = prompt[index + literal.length] || '';
      if ((!before || !/[\p{L}\p{N}_.@+~/-]/u.test(before))
        && (!after || !/[\p{L}\p{N}_.@+~/-]/u.test(after))) {
        mentions.push({ path: prompt.slice(index, index + literal.length), index });
      }
      fromIndex = index + Math.max(1, literal.length);
    }
  }
  const uniqueMentions = mentions
    .sort((a, b) => a.index - b.index || b.path.length - a.path.length)
    .filter((item, index, all) => !all.slice(0, index).some(existing => (
      item.index >= existing.index && item.index + item.path.length <= existing.index + existing.path.length
    )));
  const allOccurrences = [...extractPathOccurrences(prompt), ...uniqueMentions]
    .sort((a, b) => a.index - b.index || b.path.length - a.path.length)
    .filter((item, index, all) => !all.slice(0, index).some(existing => (
      item.index === existing.index && item.path.length === existing.path.length
    )));
  let decision: TargetMutationDecision = { requested: false, prohibited: false };
  for (const mention of uniqueMentions) {
    const classification = classifyPathOccurrenceMutation(prompt, mention, allOccurrences, true);
    if (classification.actionIndex !== undefined
      && (decision.actionIndex === undefined || classification.actionIndex >= decision.actionIndex)) {
      decision = classification;
    }
  }
  const pronounProhibition = findTargetPronounProhibition(prompt, target, extracted, workspaceRoot);
  if (pronounProhibition !== undefined
    && (decision.actionIndex === undefined || pronounProhibition >= decision.actionIndex)) {
    decision = {
      requested: false,
      prohibited: true,
      mentioned: uniqueMentions.length > 0,
      actionIndex: pronounProhibition,
    };
  }
  return decision;
}

function findTargetPronounProhibition(
  prompt: string,
  target: string,
  occurrences: PathOccurrence[],
  workspaceRoot?: string,
): number | undefined {
  const patterns = [
    /(?:不要|不得|禁止|严禁|不可|不允许|别)(?:再)?\s*(?:创建|写入|更新|修改|改写|改动|编辑|覆盖|删除|删|移除|重命名|移动|复制|追加|插入)\s*(?:它|该文件|这个文件|上述文件|该文档|这个文档)/gi,
    /\b(?:do\s+not|don't|must\s+not|should\s+not|never)\s+(?:create|write|update|modify|revise|edit|overwrite|delete|remove|rename|move|copy|append|insert)\s+(?:it|that\s+file|this\s+file|that\s+document|this\s+document)\b/gi,
  ];
  let latest: number | undefined;
  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      const index = match.index ?? 0;
      const previous = occurrences.filter(occurrence => occurrence.index < index).at(-1);
      if (previous && resolveRequestedFileTarget(previous.path, workspaceRoot) === target) {
        latest = Math.max(latest ?? -1, index);
      }
    }
  }
  return latest;
}

function buildTargetMentionLiterals(targetPath: string, workspaceRoot?: string): string[] {
  const normalizedTarget = targetPath.replace(/\\/g, '/');
  const literals = new Set([normalizedTarget]);
  if (workspaceRoot) {
    const root = nodePath.resolve(workspaceRoot);
    const relative = nodePath.relative(root, targetPath).replace(/\\/g, '/');
    if (relative && !relative.startsWith('../')) {
      literals.add(relative);
      literals.add(`./${relative}`);
      literals.add(`${nodePath.basename(root)}/${relative}`);
      if (relative === nodePath.basename(relative)) literals.add(relative);
    }
  } else {
    literals.add(nodePath.basename(normalizedTarget));
  }
  return [...literals].filter(Boolean).sort((a, b) => b.length - a.length);
}

export interface ArtifactWriteIntentClassification {
  requested: boolean;
  prohibited: boolean;
}

export interface MarkdownArtifactWriteAuthorization {
  allowed: boolean;
  reason?: 'markdown-artifact-write-prohibited' | 'markdown-artifact-target-not-requested';
  requestedTargets: string[];
}

export interface AgentFileWriteContractAuthorization {
  allowed: boolean;
  reason?:
    | MarkdownArtifactWriteAuthorization['reason']
    | 'all-file-writes-prohibited'
    | 'artifact-other-file-write-prohibited'
    | 'target-file-write-prohibited'
    | 'source-file-write-prohibited';
  requestedTargets: string[];
}

/** Shared, negation-aware artifact mutation intent used by routing and target extraction. */
export function classifyArtifactWriteIntent(promptText: string): ArtifactWriteIntentClassification {
  return classifyArtifactWriteIntentWithTarget(extractCurrentUserRequest(promptText), ARTIFACT_TARGET_HINT_RE);
}

function classifyArtifactWriteIntentWithTarget(
  promptText: string,
  targetHint: RegExp,
): ArtifactWriteIntentClassification {
  const prompt = String(promptText || '');
  const searchablePrompt = maskPathOccurrences(prompt, extractPathOccurrences(prompt));
  const actionRe = new RegExp(ARTIFACT_WRITE_ACTION_PATTERN, 'gi');
  let requested = false;
  let prohibited = false;
  for (const match of searchablePrompt.matchAll(actionRe)) {
    const actionIndex = match.index ?? 0;
    const { start: clauseStart, end: clauseEnd } = findClauseBounds(searchablePrompt, actionIndex);
    const before = searchablePrompt.slice(clauseStart, actionIndex);
    const after = searchablePrompt.slice(actionIndex + match[0].length, clauseEnd);
    if (SOURCE_OBJECT_PREFIX_RE.test(after)) continue;
    if (isResponseDirectedArtifactAction(prompt.slice(clauseStart, clauseEnd), match[0])) continue;
    if (!targetHint.test(prompt.slice(clauseStart, clauseEnd))) continue;
    if (hasNegatedWritePrefix(before)) prohibited = true;
    else requested = true;
  }
  return { requested, prohibited };
}

function isResponseDirectedArtifactAction(clause: string, actionText: string): boolean {
  if (!hasResponseSink(clause)) return false;
  return /(?:汇总|总结|写到|输出)|summari[sz]e|output/i.test(actionText)
    || /(?:内容|contents?)/i.test(clause);
}

function hasResponseSink(clause: string): boolean {
  const searchableClause = maskPathOccurrences(clause, extractPathOccurrences(clause));
  return /(?:作为|到|至|进|入|在|为|给)\s*(?:回复|回答|答复|聊天|对话|消息|用户|我)(?:里|中)?|\b(?:in|into|to|as)\s+(?:(?:the|your|my|our|this)\s+)?(?:(?:chat|user)\s+)?(?:response|answer|message|chat|user)\b|\b(?:to|for)\s+me\b/i.test(searchableClause);
}

export function hasArtifactWriteIntent(promptText: string): boolean {
  return classifyArtifactWriteIntent(promptText).requested;
}

export function hasStandaloneCodeGenerationIntent(promptText: string): boolean {
  return CODE_GENERATION_RE.test(promptText) && !CODE_GENERATION_REPORT_RE.test(promptText);
}

/** Final write-boundary authorization for Markdown artifacts named by the user. */
export function authorizeMarkdownArtifactWrite(input: {
  promptText: string;
  targetPath: string;
  workspaceRoot?: string;
  allowImplicitPrimaryArtifact?: boolean;
}): MarkdownArtifactWriteAuthorization {
  if (!/\.(?:md|markdown)$/i.test(nodePath.basename(input.targetPath))) {
    return { allowed: true, requestedTargets: [] };
  }
  const promptText = extractCurrentUserRequest(input.promptText);
  const intent = classifyArtifactWriteIntentWithTarget(promptText, MARKDOWN_ARTIFACT_TARGET_HINT_RE);
  const requestedTargets = buildTaskContract(promptText).deliverableTargets;
  const targetMutation = classifyTargetFileMutation(promptText, input.targetPath, input.workspaceRoot);
  const targetExcepted = isTargetExceptedFromFileProhibition(
    promptText,
    input.targetPath,
    input.workspaceRoot,
  );
  if (intent.prohibited && !intent.requested && !targetExcepted) {
    return {
      allowed: false,
      reason: 'markdown-artifact-write-prohibited',
      requestedTargets,
    };
  }
  const target = nodePath.normalize(nodePath.resolve(input.targetPath));
  if ((targetMutation.prohibited || targetMutation.readOnly) && !targetExcepted) {
    return {
      allowed: false,
      reason: 'markdown-artifact-write-prohibited',
      requestedTargets,
    };
  }
  const genericProhibitionIndex = lastGenericArtifactWriteProhibitionIndex(promptText);
  if (genericProhibitionIndex !== undefined
    && !targetExcepted
    && !(targetMutation.requested && (targetMutation.actionIndex ?? -1) > genericProhibitionIndex)) {
    return {
      allowed: false,
      reason: 'markdown-artifact-write-prohibited',
      requestedTargets,
    };
  }
  const allowedTargets = new Set(requestedTargets.flatMap(requested => (
    [resolveRequestedFileTarget(requested, input.workspaceRoot)]
  )));
  if (allowedTargets.size > 0 && !allowedTargets.has(target)) {
    return {
      allowed: false,
      reason: 'markdown-artifact-target-not-requested',
      requestedTargets,
    };
  }
  if (allowedTargets.size === 0
    && !targetMutation.requested
    && !input.allowImplicitPrimaryArtifact
    && !targetExcepted
    && promptText.trim()) {
    return {
      allowed: false,
      reason: 'markdown-artifact-target-not-requested',
      requestedTargets,
    };
  }
  if (!intent.requested && !targetMutation.requested && !targetExcepted && promptText.trim()) {
    return {
      allowed: false,
      reason: 'markdown-artifact-target-not-requested',
      requestedTargets,
    };
  }
  return { allowed: true, requestedTargets };
}

/**
 * Final, provider-independent request contract for every structured file write.
 * This closes sibling tool/planner paths that do not use the Markdown executor.
 */
export function authorizeAgentFileWriteContract(input: {
  promptText: string;
  targetPath: string;
  workspaceRoot?: string;
  allowImplicitPrimaryArtifact?: boolean;
  allowScopedSourceArtifact?: boolean;
  allowExactScopedArtifact?: boolean;
  targetKind?: 'file' | 'directory';
}): AgentFileWriteContractAuthorization {
  const promptText = extractCurrentUserRequest(input.promptText);
  const markdownAuthorization = authorizeMarkdownArtifactWrite({
    promptText,
    targetPath: input.targetPath,
    workspaceRoot: input.workspaceRoot,
    allowImplicitPrimaryArtifact: input.allowImplicitPrimaryArtifact,
  });
  if (!markdownAuthorization.allowed) return markdownAuthorization;

  const contract = buildTaskContract(promptText);
  const requestedTargets = contract.deliverableTargets;
  const target = nodePath.normalize(nodePath.resolve(input.targetPath));
  const targetMutation = classifyTargetFileMutation(promptText, target, input.workspaceRoot);
  const targetExcepted = isTargetExceptedFromFileProhibition(promptText, target, input.workspaceRoot);
  const sourceProhibition = getSourceFileWriteProhibition(promptText);
  if (sourceProhibition
    && (sourceProhibition.scope === 'all'
      ? isLikelySourceWriteTarget(target, promptText)
      : isLikelyFormalSourceWriteTarget(target, promptText, input.workspaceRoot))
    && !(targetMutation.requested
      && isExplicitAuthorizationCorrection(
        promptText,
        sourceProhibition.index,
        targetMutation.actionIndex ?? -1,
      ))
    && !(sourceProhibition.scope === 'scoped' && input.allowScopedSourceArtifact)) {
    return { allowed: false, reason: 'source-file-write-prohibited', requestedTargets };
  }
  if ((targetMutation.prohibited || targetMutation.readOnly) && !targetExcepted) {
    return { allowed: false, reason: 'target-file-write-prohibited', requestedTargets };
  }
  const allFileProhibitionIndex = lastAllFileWriteProhibitionIndex(promptText, input.targetKind || 'file');
  if (allFileProhibitionIndex !== undefined
    && !targetExcepted
    && !(targetMutation.requested && (targetMutation.actionIndex ?? -1) > allFileProhibitionIndex)) {
    return { allowed: false, reason: 'all-file-writes-prohibited', requestedTargets };
  }
  const scopeRestriction = getLatestFileScopeRestriction(promptText, input.workspaceRoot);
  if (scopeRestriction && !targetExcepted) {
    const namedByRestriction = scopeRestriction.allowedTargets.has(target);
    if (!namedByRestriction
      && (scopeRestriction.allowedTargets.size > 0 || (!input.allowExactScopedArtifact && !targetMutation.requested))) {
      return { allowed: false, reason: 'artifact-other-file-write-prohibited', requestedTargets };
    }
  }
  const typeProhibitionIndex = lastTargetTypeWriteProhibitionIndex(promptText, target);
  if (typeProhibitionIndex !== undefined
    && !targetExcepted
    && !(targetMutation.requested && (targetMutation.actionIndex ?? -1) > typeProhibitionIndex)) {
    return { allowed: false, reason: 'target-file-write-prohibited', requestedTargets };
  }
  const requestedFileTargets = collectRequestedFileMutationTargets(promptText, input.workspaceRoot);
  if (requestedFileTargets.size > 0
    && !requestedFileTargets.has(target)
    && !targetExcepted
    && !input.allowScopedSourceArtifact
    && !input.allowImplicitPrimaryArtifact) {
    return { allowed: false, reason: 'target-file-write-prohibited', requestedTargets };
  }
  const standaloneCodeArtifactAuthority = hasStandaloneCodeGenerationIntent(promptText)
    && requestedFileTargets.size === 0
    && !targetMutation.requested;
  const sourceChangeAuthority = contract.deliverables.includes('source-change')
    && (!standaloneCodeArtifactAuthority
      || isLikelyStandaloneCodeArtifactTarget(
        target,
        promptText,
        input.workspaceRoot,
        input.targetKind || 'file',
      ));
  const hasBroadMutationAuthority = targetMutation.requested
    || classifyArtifactWriteIntent(promptText).requested
    || sourceChangeAuthority
    || contract.taskShapes.includes('destructive')
    || input.allowScopedSourceArtifact === true;
  if (promptText.trim()
    && !hasBroadMutationAuthority
    && !targetExcepted
    && !input.allowImplicitPrimaryArtifact) {
    return { allowed: false, reason: 'target-file-write-prohibited', requestedTargets };
  }
  return { allowed: true, requestedTargets };
}

function lastAllFileWriteProhibitionIndex(
  prompt: string,
  targetKind: 'file' | 'directory' = 'file',
): number | undefined {
  const chineseObject = targetKind === 'directory'
    ? '(?:目录|文件夹|路径)'
    : '(?:文件|文档|报告)';
  const englishObject = targetKind === 'directory'
    ? '(?:directories|directory|folders?|paths?)'
    : '(?:files?|documents?|reports?)';
  const chineseAction = '(?:创建|新建|生成|编写|写入|写出|写到|写|保存|输出|更新|修改|改写|改动|改|变更|编辑|覆盖|删除|删|移除|触碰|动)';
  const englishAction = '(?:create|write|save|generate|update|modify|change|edit|overwrite|delete|remove|touch)';
  const patterns = [
    /(?:^|[\n。；;！？!?])\s*(?:停止(?:写入|修改|改动|编辑|执行)?|取消(?:本次)?任务|不要继续(?:执行|写入|修改|改动|编辑)?|算了|不用了)(?=\s*(?:$|[\n。；;！？!?]))/gi,
    /(?:^|[\n.;!?])\s*(?:stop(?:\s+(?:writing|editing|modifying|the\s+task))?|cancel(?:\s+(?:this|the))?\s+task|do\s+not\s+continue|never\s+mind)(?=\s*(?:$|[\n.;!?]))/gi,
    new RegExp(`(?:不(?:要|得|允许|可)?|禁止|严禁|不可|勿|别)[^，,。；;\\n]{0,32}${chineseAction}[^，,。；;\\n]{0,28}(?:(?:任何|所有|全部)(?:的)?)?${chineseObject}`, 'gi'),
    new RegExp(`(?:不(?:要|得|允许|可)?|禁止|严禁|不可|勿|别)[^，,。；;\\n]{0,24}(?:对\\s*)?(?:(?:任何|所有|全部)(?:的)?)?${chineseObject}[^，,。；;\\n]{0,20}(?:做|进行|产生)?\\s*(?:任何)?(?:修改|改动|变更|写入|删除|操作)`, 'gi'),
    new RegExp(`\\b(?:do\\s+not|don't|must\\s+not|should\\s+not|may\\s+not|shall\\s+not|never)\\b[^,.;\\n]{0,36}\\b${englishAction}\\b[^,.;\\n]{0,32}\\b(?:(?:any|all)\\s+)?${englishObject}\\b`, 'gi'),
    new RegExp(`\\b(?:make|allow)\\s+no\\s+(?:changes?|modifications?)\\s+(?:to|in)\\s+(?:(?:any|all)\\s+)?${englishObject}\\b`, 'gi'),
    new RegExp(`\\bno\\s+(?:changes?|modifications?)\\s+(?:to|in)\\s+(?:(?:any|all)\\s+)?${englishObject}\\b`, 'gi'),
    new RegExp(`\\bno\\s+${englishObject}\\s+(?:should|may|must|shall|can)\\s+(?:be\\s+)?(?:created|written|modified|changed|edited|deleted|removed)\\b`, 'gi'),
  ];
  let latest: number | undefined;
  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      if (isScopedOrExceptedWriteProhibition(match[0])) continue;
      if (targetKind === 'file' && /(?:源码|源代码|代码目录)|\bsource(?:\s+code|\s+files?)?\b|\bcode\s+files?\b/i.test(match[0])) continue;
      latest = Math.max(latest ?? -1, match.index ?? 0);
    }
  }
  return latest;
}

interface FileScopeRestriction {
  index: number;
  allowedTargets: Set<string>;
}

function getLatestFileScopeRestriction(prompt: string, workspaceRoot?: string): FileScopeRestriction | undefined {
  const patterns = [
    /(?:只|仅)(?:允许)?[^，,。；;\n]{0,24}(?:创建|新建|生成|编写|写入|保存|输出|更新|修改|改写|改动|编辑|删除|重命名|移动|复制|追加|插入)|(?:创建|新建|生成|编写|写入|保存|输出|更新|修改|改写|改动|编辑|删除|重命名|移动|复制|追加|插入)[^，,。；;\n]{0,12}(?:只|仅)/gi,
    /(?:不要|不得|禁止|严禁|不允许|不可|勿|别)[^，,。；;\n]{0,36}(?:其他|其它|其余|额外)(?:的)?(?:文件|改动|修改|变更)|(?:不做|不要有|不得有)\s*(?:任何)?(?:其他|其它|其余|额外)(?:改动|修改|变更)/gi,
    /\b(?:only|solely)\b[^,.;\n]{0,36}\b(?:create|write|save|generate|update|modify|change|edit|delete|rename|move|copy|append|insert)|\b(?:create|write|save|generate|update|modify|change|edit|delete|rename|move|copy|append|insert)\b[^,.;\n]{0,16}\bonly\b/gi,
    /\b(?:do\s+not|don't|must\s+not|should\s+not|never)\b[^,.;\n]{0,48}\b(?:anything\s+else|(?:any\s+)?(?:other|additional)\s+(?:files?|changes?|modifications?))\b/gi,
    /\b(?:make|allow)\s+no\s+other\s+(?:changes?|modifications?)\b|\bleave\s+(?:all\s+)?other\s+files?\s+unchanged\b/gi,
  ];
  let latestMatch: RegExpExecArray | undefined;
  for (const pattern of patterns) {
    for (const match of prompt.matchAll(pattern)) {
      if (!latestMatch || (match.index ?? 0) >= (latestMatch.index ?? 0)) latestMatch = match;
    }
  }
  if (!latestMatch) return undefined;
  const index = latestMatch.index ?? 0;
  const bounds = findClauseBounds(prompt, index);
  const occurrences = extractPathOccurrences(prompt);
  const allowedTargets = new Set<string>();
  for (const occurrence of occurrences.filter(item => item.index >= bounds.start && item.index < bounds.end)) {
    const decision = classifyPathOccurrenceMutation(prompt, occurrence, occurrences, true);
    if (decision.requested) allowedTargets.add(resolveRequestedFileTarget(occurrence.path, workspaceRoot));
  }
  return { index, allowedTargets };
}

function collectRequestedFileMutationTargets(prompt: string, workspaceRoot?: string): Set<string> {
  const occurrences = extractPathOccurrences(prompt);
  const targets = new Set<string>();
  for (const occurrence of occurrences) {
    if (classifyPathOccurrenceMutation(prompt, occurrence, occurrences, true).requested) {
      targets.add(resolveRequestedFileTarget(occurrence.path, workspaceRoot));
    }
  }
  return targets;
}

function lastGenericArtifactWriteProhibitionIndex(prompt: string): number | undefined {
  const occurrences = extractPathOccurrences(prompt);
  const { searchablePrompt, actions } = collectMutationActionSpans(prompt, occurrences, false);
  let latest: number | undefined;
  for (const action of actions.filter(item => item.prohibited)) {
    const clause = prompt.slice(action.clauseStart, action.clauseEnd);
    if (isScopedOrExceptedWriteProhibition(clause)) continue;
    const clauseHasPath = occurrences.some(occurrence => (
      occurrence.index >= action.clauseStart && occurrence.index < action.clauseEnd
    ));
    if (clauseHasPath) continue;
    if (!MARKDOWN_ARTIFACT_TARGET_HINT_RE.test(searchablePrompt.slice(action.clauseStart, action.clauseEnd))) continue;
    latest = Math.max(latest ?? -1, action.index);
  }
  return latest;
}

function isScopedOrExceptedWriteProhibition(text: string): boolean {
  return /(?:其他|其它|其余|额外)|(?:除|除了)[^，,。；;\n]*(?:以外|之外)|\b(?:other|additional|except|other\s+than)\b/i.test(text);
}

function isExplicitAuthorizationCorrection(prompt: string, deniedIndex: number, allowedIndex: number): boolean {
  if (allowedIndex <= deniedIndex) return false;
  return /(?:更正|纠正|改为|改成|撤回|算了|实际上|重新允许|correction|correct(?:ion)?|actually|instead|I\s+take\s+that\s+back)/i.test(
    prompt.slice(deniedIndex, allowedIndex),
  );
}

function lastTargetTypeWriteProhibitionIndex(prompt: string, targetPath: string): number | undefined {
  const basename = nodePath.basename(targetPath);
  const kinds: Array<{ matches: boolean; chinese: string; english: string }> = [
    {
      matches: /\.(?:json|ya?ml|toml|ini|conf|cfg|xml|properties)$/i.test(basename),
      chinese: '(?:配置|设定)(?:文件)?',
      english: '(?:configuration|config)(?:\\s+files?)?',
    },
    {
      matches: /(?:^|[._-])(?:test|tests|spec)(?:[._-]|$)/i.test(basename),
      chinese: '(?:测试|用例)(?:文件|代码)?',
      english: '(?:test|spec)(?:\\s+files?|\\s+code)?',
    },
    {
      matches: /\.(?:md|markdown|txt)$/i.test(basename),
      chinese: '(?:文档|报告)(?:文件)?',
      english: '(?:documentation|document|report)(?:\\s+files?)?',
    },
  ];
  let latest: number | undefined;
  for (const kind of kinds.filter(item => item.matches)) {
    const patterns = [
      new RegExp(`(?:不(?:要|得|允许|可)?|禁止|严禁|不可|勿|别)[^，,。；;\\n]{0,32}(?:修改|改动|编辑|写入|覆盖|删除|创建|重命名|移动|复制|追加|插入)[^，,。；;\\n]{0,24}${kind.chinese}`, 'gi'),
      new RegExp(`\\b(?:do\\s+not|don't|must\\s+not|should\\s+not|never)\\b[^,.;\\n]{0,40}\\b(?:modify|change|edit|write|overwrite|delete|create|rename|move|copy|append|insert)\\b[^,.;\\n]{0,28}\\b${kind.english}\\b`, 'gi'),
    ];
    for (const pattern of patterns) {
      for (const match of prompt.matchAll(pattern)) {
        if (isScopedOrExceptedWriteProhibition(match[0])) continue;
        latest = Math.max(latest ?? -1, match.index ?? 0);
      }
    }
  }
  return latest;
}

function getSourceFileWriteProhibition(
  prompt: string,
): { scope: 'all' | 'scoped'; index: number } | undefined {
  let latest: { scope: 'all' | 'scoped'; index: number } | undefined;
  const chinese = /(?:不要|不得|禁止|严禁|不允许|不可|勿|别)[^，,。；;\n]{0,16}(?:修改|改动|编辑|写入|覆盖|删除|移除|更新|创建|重命名|移动|复制|追加|插入)[^，,。；;\n]{0,24}(?:任何|所有|全部)?(?:正式|生产|原有|原|现有|已有|既有|主项目|原项目)?(?:关联)?(?:源码|源代码|代码)(?:目录|文件)?/gi;
  for (const match of prompt.matchAll(chinese)) {
    const next = {
      scope: /(?:正式|生产|原有|原代码|现有|已有|既有|主项目|原项目)/.test(match[0])
        ? 'scoped' as const
        : 'all' as const,
      index: match.index ?? 0,
    };
    if (!latest || next.index >= latest.index) latest = next;
  }
  const english = /\b(?:do\s+not|don't|must\s+not|should\s+not|may\s+not|shall\s+not|never)\b[^,.;\n]{0,28}\b(?:modify|change|edit|write|overwrite|delete|remove|update|create|rename|move|copy|append|insert)\b[^,.;\n]{0,24}\b(?:(?:any|all|formal|production|existing|current|main-project)\s+)*(?:source(?:\s+code|\s+files?)?|code\s+files?)\b/gi;
  for (const match of prompt.matchAll(english)) {
    const next = {
      scope: /\b(?:formal|production|existing|current|main-project)\b/i.test(match[0])
        ? 'scoped' as const
        : 'all' as const,
      index: match.index ?? 0,
    };
    if (!latest || next.index >= latest.index) latest = next;
  }
  return latest;
}

function isLikelySourceWriteTarget(targetPath: string, prompt: string): boolean {
  const basename = nodePath.basename(targetPath);
  if (/\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|swift|go|rs|java|kt|kts|scala|ts|tsx|js|jsx|mjs|cjs|py|rb|php|cs|fs|fsx|sh|bash|zsh|fish|ps1|sql|proto|graphql|vue|svelte|json|ya?ml|toml|xml|gradle|cmake)$/i.test(basename)) return true;
  return extractPathOccurrences(prompt)
    .filter(input => !/\.(?:md|markdown)$/i.test(input.path))
    .some(input => nodePath.basename(input.path) === basename);
}

function isLikelyStandaloneCodeArtifactTarget(
  targetPath: string,
  prompt: string,
  workspaceRoot: string | undefined,
  targetKind: 'file' | 'directory',
): boolean {
  if (targetKind === 'file') return isLikelySourceWriteTarget(targetPath, prompt);
  const normalized = nodePath.resolve(targetPath);
  const relative = workspaceRoot
    ? nodePath.relative(nodePath.resolve(workspaceRoot), normalized).replace(/\\/g, '/')
    : normalized.replace(/\\/g, '/').replace(/^\/+/, '');
  return /(?:^|\/)(?:src|source|sources|code|scripts?|lib|app|include|test|tests)(?:\/|$)/i.test(relative);
}

function isLikelyFormalSourceWriteTarget(
  targetPath: string,
  prompt: string,
  workspaceRoot?: string,
): boolean {
  const normalized = nodePath.resolve(targetPath);
  const relative = workspaceRoot
    ? nodePath.relative(nodePath.resolve(workspaceRoot), normalized).replace(/\\/g, '/')
    : normalized.replace(/\\/g, '/').replace(/^\/+/, '');
  if (/(?:^|\/)(?:src|source|sources|lib|app)(?:\/|$)/i.test(relative)
    || /(?:^|\/)packages\/[^/]+\/src(?:\/|$)/i.test(relative)) return true;
  return extractPathOccurrences(prompt).some(input => {
    const clause = findClauseBounds(prompt, input.index);
    if (!/(?:正式|生产|原有|现有|已有|既有|主项目|原项目|formal|production|existing|current|main-project)/i.test(
      prompt.slice(clause.start, clause.end),
    )) return false;
    return resolveRequestedFileTarget(input.path, workspaceRoot) === normalized;
  });
}

function isTargetExceptedFromFileProhibition(
  prompt: string,
  targetPath: string,
  workspaceRoot?: string,
): boolean {
  const target = nodePath.normalize(nodePath.resolve(targetPath));
  return extractPathOccurrences(prompt).some(occurrence => {
    if (resolveRequestedFileTarget(occurrence.path, workspaceRoot) !== target) return false;
    const before = prompt.slice(Math.max(0, occurrence.index - 24), occurrence.index);
    const after = prompt.slice(occurrence.index + occurrence.path.length, occurrence.index + occurrence.path.length + 16);
    const exceptionSyntax = /(?:除|除了)\s*$/i.test(before) && /^\s*(?:以外|之外|外)/i.test(after)
      || /^\s*(?:以外|之外)(?:的)?/i.test(after)
      || /\b(?:except|other\s+than)\s*$/i.test(before);
    if (!exceptionSyntax) return false;
    const context = prompt.slice(Math.max(0, occurrence.index - 120), occurrence.index + occurrence.path.length + 80);
    return /(?:不要|不得|禁止|严禁|不可|不允许|勿|别)[^，。；;\n]{0,60}(?:创建|新建|生成|写|改|修改|变更|编辑|覆盖|删除|删|移除)[^，。；;\n]{0,60}(?:文件|文档|报告)/i.test(context)
      || /\b(?:do\s+not|don't|must\s+not|should\s+not|may\s+not|shall\s+not|never)\b[^,.;\n]{0,80}\b(?:create|write|save|generate|update|modify|change|edit|overwrite|delete|remove|touch|rename|move|copy|append|insert)\b[^,.;\n]{0,80}\bfiles?\b/i.test(context);
  });
}

function resolveRequestedFileTarget(requested: string, workspaceRoot?: string): string {
  if (nodePath.isAbsolute(requested)) return nodePath.normalize(nodePath.resolve(requested));
  const normalized = requested.replace(/\\/g, '/').replace(/^\.\//, '');
  const root = nodePath.resolve(workspaceRoot || '.');
  const rootBasename = nodePath.basename(root);
  if (normalized === rootBasename || normalized.startsWith(`${rootBasename}/`)) {
    return nodePath.normalize(nodePath.resolve(nodePath.dirname(root), normalized));
  }
  return nodePath.normalize(nodePath.resolve(root, normalized));
}

/** Provider-independent interpretation of what this task actually requires. */
export function buildTaskContract(promptText: string): TaskContract {
  const prompt = extractCurrentUserRequest(promptText);
  const documentation = DOCUMENT_RE.test(prompt);
  const artifactWriteIntent = classifyArtifactWriteIntentWithTarget(prompt, ARTIFACT_TARGET_HINT_RE);
  const inspection = INSPECTION_RE.test(prompt);
  const hasSourceInput = /(?:\/src\/|\.(?:c|cc|cpp|h|hpp|ts|tsx|js|py|json|ya?ml|toml)\b)/i.test(prompt);
  const extractsSourceFacts = /(?:提取|列出|核对|读取)[\s\S]{0,240}(?:常量|数值|配置|字段|版本|真实(?:定义|值)|(?:定义|值))|(?:extract|list|verify|read)[\s\S]{0,240}(?:constant|value|config|field|version)/i.test(prompt);
  // A source-fact request with a report destination is security-sensitive even
  // when its mutation verb is outside our allow-listed vocabulary (for example
  // “登记于 Markdown 报告”). Mark the obligation so the grounded router can
  // reject an unresolved target before the generic provider/tool path runs.
  const ambiguousSourceReportDestination = extractsSourceFacts && (
    /(?:到|至|入|于|为)\s*(?:(?:markdown|md)\s*)?(?:文档|报告|文件)?[^，,。；;\n]{0,80}\.(?:md|markdown)\b/i.test(prompt)
    || /\b(?:into|to|as)\s+(?:(?:a|the)\s+)?(?:markdown\s+)?(?:document|report|file)[^,.;\n]{0,80}\.(?:md|markdown)\b/i.test(prompt)
  );
  const reportDelivery = documentation
    && (artifactWriteIntent.requested || ambiguousSourceReportDestination);
  const standaloneCodeGeneration = hasStandaloneCodeGenerationIntent(prompt);
  const changeAction = CHANGE_RE.test(prompt);
  const existingProjectScope = EXISTING_PROJECT_SCOPE_RE.test(prompt);
  const explicitSourceMutation = changeAction && (
    hasSourceInput
    || existingProjectScope
    || BROAD_PROJECT_CODE_SCOPE_RE.test(prompt)
    || CONDITIONAL_REPAIR_RE.test(prompt)
    || EXPLICIT_SOURCE_IMPLEMENTATION_DELIVERY_RE.test(prompt)
  );
  const sourceChange = (explicitSourceMutation || standaloneCodeGeneration)
    && !NO_SOURCE_CHANGE_RE.test(prompt)
    && (!documentation
      || (standaloneCodeGeneration && !reportDelivery)
      || EXPLICIT_SOURCE_IMPLEMENTATION_DELIVERY_RE.test(prompt)
      || /(?:(?:修改|改动|新增|重构|修复).{0,20}(?:源码|代码|文件)|代码实现|实现代码|落地实现|fix|modify|implement|refactor)/i.test(prompt));
  const standalone = (STANDALONE_RE.test(prompt) || standaloneCodeGeneration) && !existingProjectScope;
  const protocol = PROTOCOL_RE.test(prompt);
  const interfaceContract = INTERFACE_RE.test(prompt);
  const communicationChain = COMMUNICATION_CHAIN_RE.test(prompt);
  const explicitModificationPlan = /(?:原有代码修改清单|代码修改清单|修改点清单|existing.?code modification plan)/i.test(prompt);
  const shapes = new Set<TaskShape>();
  if (existingProjectScope || (sourceChange && !standalone)) shapes.add('existing-project');
  if (standalone) shapes.add('standalone');
  if (inspection) shapes.add('inspection');
  if (documentation) shapes.add('documentation');
  if (sourceChange && !standalone) shapes.add('repair');
  const destructive = DESTRUCTIVE_RE.test(prompt) && !NON_DESTRUCTIVE_CONTENT_DELETE_RE.test(prompt);
  if (destructive) shapes.add('destructive');

  const obligations = new Set<QualityObligation>();
  if (sourceChange || extractsSourceFacts || (inspection && hasSourceInput && protocol)) obligations.add('source-evidence');
  if (protocol) obligations.add('protocol-facts');
  if (interfaceContract) obligations.add('interface-contract');
  if ((sourceChange && !standalone) || explicitModificationPlan) obligations.add('modification-plan');
  if (communicationChain) obligations.add('project-communication-chain');
  if (VALIDATION_RE.test(prompt) && sourceChange) obligations.add('validation');

  const inputOccurrences = extractPathOccurrences(prompt);
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
  const sourceInputs = [...new Set(inputs.filter(input => !/\.(?:md|markdown)$/i.test(input)))];
  const exactClaimTable = evidenceRequirements.length > 0 && requestedTableRows !== undefined
    ? {
      symbols: evidenceRequirements.map(requirement => requirement.symbol),
      rowCount: requestedTableRows,
      forbidAdditionalRows: true,
    }
    : undefined;
  const exactCodeBlocks = extractExactCodeBlocks(prompt);
  const exactArtifactRequested = isExactGroundedArtifactRequested(prompt, extractsSourceFacts, reportDelivery);
  const exactTitle = extractExactMarkdownTitle(prompt);
  const exactSourcePathLines = extractExactSourcePathLines(prompt, sourceInputs);
  const exactTableHeader = extractExactClaimTableHeader(prompt);
  const exactArtifact = exactArtifactRequested
    && exactTitle
    && exactClaimTable
    && exactTableHeader
    && exactSourcePathLines.length === sourceInputs.length
    && exactClaimTable.rowCount === exactClaimTable.symbols.length
    && (!requestsExactCodeBlock(prompt) || exactCodeBlocks.length > 0)
    ? {
      kind: 'source-fact-markdown' as const,
      title: exactTitle,
      sourcePathLines: exactSourcePathLines,
      tableHeader: exactTableHeader,
      symbols: exactClaimTable.symbols,
      valuePresentation: 'source-initializer' as const,
      codeBlocks: exactCodeBlocks,
      forbidAdditionalContent: true as const,
    }
    : undefined;
  return {
    taskShapes: [...shapes],
    objectives: [prompt.trim()].filter(Boolean),
    inputs: [...new Set(inputs)],
    deliverableTargets,
    deliverables: [
      ...(reportDelivery ? ['report' as const] : []),
      ...(sourceChange ? ['source-change' as const] : []),
      ...(VALIDATION_RE.test(prompt) ? ['verification-result' as const] : []),
    ],
    constraints: NO_SOURCE_CHANGE_RE.test(prompt) ? ['no-source-change'] : [],
    qualityObligations: [...obligations],
    evidenceRequirements,
    verificationContract: {
      requireSourceClaimGrounding: extractsSourceFacts && reportDelivery,
      requireTitle: reportDelivery && /(?:标题|title)/i.test(prompt),
      requiredSourcePaths: /(?:源码路径|源文件路径|source\s+(?:file\s+)?path)/i.test(prompt)
        ? [...new Set(sourceInputs)]
        : [],
      exactClaimTable,
      exactCodeBlocks,
      exactArtifactRequested,
      exactArtifact,
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

function extractActionBoundFilenameOccurrences(prompt: string): PathOccurrence[] {
  const occurrences: PathOccurrence[] = [];
  const add = (rawValue: string, index: number, explicitlyNamed: boolean): void => {
    const value = rawValue.trim().replace(/[.,;!?，。；]+$/u, '');
    const basename = nodePath.posix.basename(value);
    const filenameShaped = explicitlyNamed
      || value.includes('/')
      || /^\.[A-Za-z0-9]/.test(basename)
      || basename.includes('.')
      || /^[A-Z][A-Za-z0-9@+~_-]*(?:file|lock)$/.test(basename)
      || /^[A-Z][A-Z0-9@+~_-]{4,}$/.test(basename);
    if (filenameShaped && value && !/^(?:a|an|the|file|document)$/i.test(value)) {
      occurrences.push({ path: value, index });
    }
  };
  const valuePattern = '(["\'\\x60])([^"\'\\x60\\r\\n]+?)\\1|([A-Za-z0-9_.@+~/-]+)';
  const targetLabelRe = new RegExp(
    `(?:目标文件|目标路径|文件名|target\\s+file|filename)\\s*(?:是|为|is|:|：)?\\s*(?:${valuePattern})`,
    'gi',
  );
  for (const match of prompt.matchAll(targetLabelRe)) {
    const value = match[2] || match[3];
    add(value, (match.index ?? 0) + match[0].indexOf(value), true);
  }
  const actionRe = new RegExp(ARTIFACT_WRITE_ACTION_PATTERN, 'gi');
  for (const action of prompt.matchAll(actionRe)) {
    const actionEnd = (action.index ?? 0) + action[0].length;
    const tail = prompt.slice(actionEnd);
    const candidate = tail.match(new RegExp(
      `^\\s*(?:(?:the|a|an|target)\\s+)?(?:(?:file|document|文件|文档)\\s+)?(?:${valuePattern})`,
      'i',
    ));
    if (!candidate) continue;
    const value = candidate[2] || candidate[3];
    const valueOffset = candidate[0].indexOf(value);
    const valueIndex = actionEnd + valueOffset;
    const candidatePrefix = candidate[0].slice(0, valueOffset);
    const remainder = prompt.slice(valueIndex + value.replace(/[.,;!?，。；]+$/u, '').length);
    if (!/^\s*(?:$|[.,;!?，。；]|(?:using|with|from|based\s+on|according\s+to|for|to|and|but|only)\b|(?:使用|根据|基于|依据|以便|并|且|但|仅|只))/iu.test(remainder)) continue;
    add(value, valueIndex, Boolean(candidate[1]) || /(?:file|document|文件|文档)\s*$/i.test(candidatePrefix));
  }
  return occurrences;
}

function extractPathOccurrences(prompt: string): PathOccurrence[] {
  const occurrences: PathOccurrence[] = [];
  const add = (pathValue: string, index: number): void => {
    const value = pathValue.trim().replace(/[.,;!?，。；]+$/u, '');
    if (!value || index < 0) return;
    occurrences.push({ path: value, index });
  };
  for (const match of prompt.matchAll(PATH_RE)) {
    const matchStart = match.index ?? 0;
    add(match[1], matchStart + match[0].lastIndexOf(match[1]));
  }
  const quotedPatterns = [
    new RegExp(`(["'\\x60])([^"'\\x60\\r\\n]+?\\.${CONTRACT_FILE_EXTENSION_PATTERN})\\1`, 'gi'),
    new RegExp(`“([^”\\r\\n]+?\\.${CONTRACT_FILE_EXTENSION_PATTERN})”`, 'gi'),
    new RegExp(`‘([^’\\r\\n]+?\\.${CONTRACT_FILE_EXTENSION_PATTERN})’`, 'gi'),
  ];
  for (const regexp of quotedPatterns) {
    for (const match of prompt.matchAll(regexp)) {
      const value = match[2] || match[1];
      add(value, (match.index ?? 0) + match[0].indexOf(value));
    }
  }
  for (const occurrence of extractActionBoundFilenameOccurrences(prompt)) add(occurrence.path, occurrence.index);
  const spacedBarePath = new RegExp(
    `(?:^|[\\s（(【\\[<《：:,，；;、])((?:(?:\\.\\.?/)?[\\w.@+~-]+/)+(?:[\\w.@+~-]+[ \\t]+)+[\\w.@+~-]+\\.${CONTRACT_FILE_EXTENSION_PATTERN})(?=$|[\\s）)】\\]>》,，。；;、：:])`,
    'giu',
  );
  for (const match of prompt.matchAll(spacedBarePath)) {
    add(match[1], (match.index ?? 0) + match[0].lastIndexOf(match[1]));
  }
  const unicodeBarePath = new RegExp(
    `(?:^|[\\s（(【\\[<《：:,，；;、])([^\\s"'\\x60“”‘’<>{}\\[\\]()（）【】《》，,。；;、：:]+\\.${CONTRACT_FILE_EXTENSION_PATTERN})(?=$|[\\s）)】\\]>》,，。；;、：:])`,
    'giu',
  );
  for (const match of prompt.matchAll(unicodeBarePath)) {
    add(match[1], (match.index ?? 0) + match[0].lastIndexOf(match[1]));
  }
  return occurrences
    .sort((a, b) => a.index - b.index || b.path.length - a.path.length)
    .filter((item, index, all) => !all.slice(0, index).some(existing => (
      item.index >= existing.index && item.index + item.path.length <= existing.index + existing.path.length
    )));
}

function extractEvidenceRequirementSymbols(prompt: string): string[] {
  const segments: string[] = [];
  const extractionClauses = [
    /(?:提取|列出|核对|读取)([\s\S]{0,320}?)(?=(?:并|然后|并且)?(?:创建|新建|生成|写入|写出|保存|输出|提供|产出|落盘|更新|修改|改写|覆盖)|[。；;\n]|$)/gi,
    /\b(?:extract|list|verify|read)\b([\s\S]{0,320}?)(?=\b(?:create|write|save|output|generate|produce|provide|update|modify|revise|replace)\b|[.;\n]|$)/gi,
  ];
  for (const regexp of extractionClauses) {
    for (const match of prompt.matchAll(regexp)) {
      if (hasClaimSemantics(match[1])) segments.push(match[1]);
    }
  }
  const stopWords = new Set([
    'after', 'and', 'back', 'code', 'config', 'configuration', 'constant', 'constants',
    'definition', 'definitions', 'extract', 'field', 'fields', 'file', 'from', 'it', 'list',
    'markdown', 'of', 'read', 'real', 'report', 'source', 'the', 'true', 'value', 'values',
    'verify', 'version', 'versions', 'writing',
  ]);
  const explicit = segments.flatMap(segment => segment.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [])
    .filter(symbol => !stopWords.has(symbol.toLowerCase()));
  if (explicit.length > 0) return [...new Set(explicit)];
  return [...new Set(prompt.match(/\b[A-Za-z_][A-Za-z0-9_]{2,}\b/g) || [])]
    .filter(symbol => /^(?:k[A-Z]|[A-Z][A-Z0-9_]+$)/.test(symbol));
}

function hasClaimSemantics(segment: string): boolean {
  return /(?:常量|数值|配置|字段|版本|真实(?:定义|值)|定义|值)|\b(?:constants?|values?|config(?:uration)?|fields?|versions?|definitions?)\b/i.test(segment);
}

export function hasQualityObligation(contract: TaskContract, obligation: QualityObligation): boolean {
  return contract.qualityObligations.includes(obligation);
}

/** Exact source facts are an artifact obligation only when the request also asks for a report. */
export function hasSourceClaimArtifactContract(contract: TaskContract): boolean {
  return contract.verificationContract.requireSourceClaimGrounding
    && contract.deliverables.includes('report');
}

/** A source-backed artifact must have machine-executable, path-bound claims. */
export function getSourceClaimArtifactContractIssue(contract: TaskContract): string | undefined {
  if (!hasSourceClaimArtifactContract(contract)) return undefined;
  if (contract.evidenceRequirements.length === 0) {
    return '源码事实报告契约未能解析出明确的 claim symbol，已安全阻止未验证交付。';
  }
  if (contract.evidenceRequirements.some(requirement => !requirement.sourcePath)) {
    return '源码事实 claim 无法唯一绑定到源文件，已安全阻止猜测性写入。';
  }
  if (contract.verificationContract.exactArtifactRequested && !contract.verificationContract.exactArtifact) {
    return '逐字源码事实报告契约不完整或存在歧义，已在写盘前安全阻止 Provider 猜测。';
  }
  return undefined;
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
      exactArtifact: contract.verificationContract.exactArtifact
        ? {
          ...contract.verificationContract.exactArtifact,
          sourcePathLines: contract.verificationContract.exactArtifact.sourcePathLines.map(line => {
            const source = contract.verificationContract.requiredSourcePaths.find(pathValue => line.endsWith(pathValue));
            const resolved = resolveOne(source);
            return source && resolved ? `${line.slice(0, -source.length)}${resolved}` : line;
          }),
        }
        : undefined,
    },
  };
}

function isExactGroundedArtifactRequested(
  prompt: string,
  extractsSourceFacts: boolean,
  reportDelivery: boolean,
): boolean {
  if (!extractsSourceFacts || !reportDelivery) return false;
  const exactCount = (prompt.match(/逐字|\bexactly\b/gi) || []).length;
  const structureMatches = [...prompt.matchAll(/严格满足(?:以下|下列)?结构|strictly\s+(?:match|follow)[^\n.]{0,32}structure/gi)];
  const latestStructure = structureMatches.at(-1);
  const affirmativeStructure = latestStructure
    ? !isNegatedExactStructureDirective(prompt, latestStructure.index || 0)
    : exactCount >= 2;
  if (!affirmativeStructure) return false;

  const noExtraMatches = [...prompt.matchAll(/不得增加其他|禁止增加其他|不得添加额外|禁止添加额外|no\s+(?:additional|extra)\s+(?:content|headings?|rows?|blocks?)/gi)]
    .filter(match => !isNegatedNoExtraDirective(prompt, match.index || 0))
    .filter(match => !isScopedNoExtraDirective(prompt, match.index || 0, match[0].length));
  const latestNoExtra = noExtraMatches.at(-1);
  if (!latestNoExtra) return false;
  return !hasLaterAdditionalContentDirective(prompt, (latestNoExtra.index || 0) + latestNoExtra[0].length);
}

function isNegatedExactStructureDirective(prompt: string, structureIndex: number): boolean {
  const prefix = prompt.slice(Math.max(0, structureIndex - 64), structureIndex);
  return /(?:无需|无须|不必|不要|不需要|不要求|无需再|并非|不是)\s*(?:必须)?\s*$/i.test(prefix)
    || /(?:need\s+not|do(?:es)?\s+not\s+(?:need|have)\s+to|must\s+not|should\s+not|is\s+not\s+required\s+to)\s*$/i.test(prefix);
}

function isNegatedNoExtraDirective(prompt: string, directiveIndex: number): boolean {
  const prefix = prompt.slice(Math.max(0, directiveIndex - 64), directiveIndex);
  return /(?:不要求|不需要|无需|无须|不必|取消|忽略|不适用|并非要求)\s*["'“”]?\s*$/i.test(prefix)
    || /(?:do(?:es)?\s+not\s+require|need\s+not|ignore|cancel)\s*["']?\s*$/i.test(prefix)
    || /["'“]\s*$/.test(prefix);
}

function isScopedNoExtraDirective(prompt: string, directiveIndex: number, directiveLength: number): boolean {
  const clauseStart = Math.max(
    prompt.lastIndexOf('\n', directiveIndex - 1),
    prompt.lastIndexOf('；', directiveIndex - 1),
    prompt.lastIndexOf(';', directiveIndex - 1),
    prompt.lastIndexOf('。', directiveIndex - 1),
  );
  const prefix = prompt.slice(clauseStart + 1, directiveIndex).trim();
  const clauseEndCandidates = [
    prompt.indexOf('\n', directiveIndex + directiveLength),
    prompt.indexOf('；', directiveIndex + directiveLength),
    prompt.indexOf(';', directiveIndex + directiveLength),
    prompt.indexOf('。', directiveIndex + directiveLength),
    prompt.indexOf('.', directiveIndex + directiveLength),
  ].filter(index => index >= 0);
  const clauseEnd = clauseEndCandidates.length > 0 ? Math.min(...clauseEndCandidates) : prompt.length;
  const suffix = prompt.slice(directiveIndex + directiveLength, clauseEnd).trim();
  return /(?:对于|针对)?\s*(?:代码块|表格|标题|附录|其他文件|其它文件|源码|源代码)(?:之?内|中|里|方面)?\s*[,，:：]?\s*$/i.test(prefix)
    || /(?:for|within|inside)\s+(?:the\s+)?(?:code\s+block|table|title|appendix|other\s+files?|source\s+code)\s*[,，:：]?\s*$/i.test(prefix)
    || /^(?:仅限|只限|只针对|在)\s*(?:代码块|表格|标题|附录|其他文件|其它文件|源码|源代码)(?:之?内|中|里|方面)?/i.test(suffix)
    || /^(?:inside|within|for)\s+(?:the\s+)?(?:python\s+)?(?:code\s+block|table|title|appendix|other\s+files?|source\s+code)\b/i.test(suffix);
}

function hasLaterAdditionalContentDirective(prompt: string, afterIndex: number): boolean {
  const suffix = prompt.slice(afterIndex);
  return /(?:(?:更正|改为|但是|但)?\s*(?:允许|可以|可|需要|必须)\s*|(?:再|还(?:要|需)?|另外|同时)\s*)(?:增加|添加|加入|补充)\s*(?:一段|额外)?\s*(?:风险|说明|解释|段落|内容|附录)/i.test(suffix)
    || /\b(?:then|also|additionally)\s+(?:add|include)\b[^\n.]{0,60}\b(?:explanation|paragraph|content|appendix|notes?)\b/i.test(suffix);
}

function extractExactMarkdownTitle(prompt: string): string | undefined {
  const match = prompt.match(/(?:标题|title)[^\n。]{0,48}?(?:必须逐字为|must\s+exactly\s+be)\s*[:：]?\s*(#{1,6}\s+[^\r\n。]+)/i);
  const title = match?.[1]?.trim();
  return title && !/[|\x00-\x1f]/.test(title) ? title : undefined;
}

function extractExactSourcePathLines(prompt: string, sourceInputs: string[]): string[] {
  const lines: string[] = [];
  const regexp = /(?:必须逐字为|must\s+exactly\s+be)\s*[:：]?\s*((?:源码路径\s*[：:]|source\s+path\s*:)\s*[^\r\n。]+)/gi;
  for (const match of prompt.matchAll(regexp)) {
    const line = match[1].trim();
    if (sourceInputs.some(source => line.endsWith(source)) && !/[|\x00-\x1f]/.test(line)) lines.push(line);
  }
  return [...new Set(lines)];
}

function extractExactClaimTableHeader(prompt: string): [string, string] | undefined {
  if (/(?:表头|header)[^\n。]{0,40}?Symbol\s*(?:和|与|及|、|\/|and)\s*Value/i.test(prompt)) {
    return ['Symbol', 'Value'];
  }
  if (/(?:表头|header)[^\n。]{0,40}?常量名\s*(?:和|与|及|、|\/)\s*值/i.test(prompt)) {
    return ['常量名', '值'];
  }
  return undefined;
}

function requestsExactCodeBlock(prompt: string): boolean {
  return /(?:仅包含(?:一个|1\s*个)?|包含(?:一个|1\s*个)|加入|添加)[^\n。]{0,40}(?:代码块|code\s+blocks?)/i.test(prompt)
    || /\b(?:must\s+(?:include|contain)|include|add)\b[^\n.]{0,40}\bcode\s+blocks?\b/i.test(prompt);
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
  const decisions = new Map<string, TargetMutationDecision>();
  for (const input of inputs.filter(item => /\.(?:md|markdown)$/i.test(item.path))) {
    const decision = classifyPathOccurrenceMutation(prompt, input, inputs);
    const previous = decisions.get(input.path);
    if (decision.actionIndex !== undefined
      && (previous?.actionIndex === undefined || decision.actionIndex >= previous.actionIndex)) {
      decisions.set(input.path, decision);
    }
  }
  return [...decisions.entries()]
    .filter(([, decision]) => decision.requested && !decision.prohibited)
    .map(([pathValue]) => pathValue);
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
