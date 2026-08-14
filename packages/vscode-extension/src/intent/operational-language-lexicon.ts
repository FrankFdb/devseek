import * as fs from 'fs';

export interface OperationalPatternSpec {
  id: string;
  source: string;
  flags?: string;
}

export interface OperationalLanguageLexiconConfig {
  version: 'devseek.operational-language-lexicon/v1';
  externalEffect?: Partial<Record<ExternalEffectPatternGroup, readonly OperationalPatternSpec[]>>;
  runProhibition?: Partial<Record<RunProhibitionPatternGroup, readonly OperationalPatternSpec[]>>;
}

export type ExternalEffectPatternGroup =
  | 'unambiguous'
  | 'ambiguousRelease'
  | 'releaseTarget'
  | 'domainOperation'
  | 'domainInstallAction'
  | 'question'
  | 'negated'
  | 'bareReleaseImperative'
  | 'negatedPhrase';

export type RunProhibitionPatternGroup =
  | 'strong'
  | 'weak'
  | 'directWeak'
  | 'domainExecutionSubject'
  | 'operationalExecutionTarget'
  | 'phrase';

export interface CompiledOperationalLanguageLexicon {
  externalEffect: Record<ExternalEffectPatternGroup, RegExp[]>;
  runProhibition: Record<RunProhibitionPatternGroup, RegExp[]>;
}

type MutablePatternGroups<T extends string> = Record<T, OperationalPatternSpec[]>;

const DEFAULT_FLAGS = 'i';
const GLOBAL_FLAGS = 'gi';

export const DEFAULT_OPERATIONAL_LANGUAGE_LEXICON: OperationalLanguageLexiconConfig = Object.freeze({
  version: 'devseek.operational-language-lexicon/v1',
  externalEffect: Object.freeze({
    unambiguous: Object.freeze([
      pattern('external-effect-unambiguous', String.raw`(?:上线|部署|安装插件|安装扩展|提交(?:当前)?(?:修改|变更)|推送(?:当前)?(?:分支)|拉取(?:最新)?代码|安装[^，,。；;\n]{0,24}(?:依赖|npm\s*包|软件包|包|库|模块)|(?:新增|添加|引入)[^，,。；;\n]{0,16}(?:依赖|npm\s*包|软件包|包|库|模块)|\bdeploy\b|install\s+extension|\binstall\b[^,.;\n]{0,40}\b(?:packages?|dependenc(?:y|ies)|librar(?:y|ies)|modules?)\b|\binstall\s+@[A-Za-z0-9._/-]+\b|\binstall\s+[A-Za-z0-9][A-Za-z0-9._/-]{1,}\b(?=[,.;\n]|$|\s+(?:and|then|to)\b)|\b(?:add|introduce)\b[^,.;\n]{0,40}\b(?:new\s+)?dependenc(?:y|ies)\b|git\s+(?:commit|push|pull|fetch|merge|rebase)|commit\s+(?:(?:the|this)\s+)?(?:changes?|current|current\s+changes?)|push\s+(?:(?:this|the|current)\s+)?branch|(?:open|create|file|submit)\s+(?:a\s+)?(?:pr|pull\s+request)|npm\s+(?:install|i|add|ci)|pnpm\s+(?:install|i|add)|yarn\s+(?:install|add)|pip\s+install)`),
    ]),
    ambiguousRelease: Object.freeze([
      pattern('external-effect-ambiguous-release', String.raw`(?:发布|(?:^|[\s，,。；;:：])(?:release|publish)\b)`),
    ]),
    releaseTarget: Object.freeze([
      pattern('external-effect-release-target', String.raw`(?:版本|软件包|依赖包|npm\s*包|插件|扩展|应用|服务|网站|镜像|构建产物|制品|代码|当前修改|当前变更|生产环境|注册表|市场|\b(?:version|packages?|plugin|extension|app|service|site|image|artifact|changes?|code|production|registry|marketplace)\b)`),
    ]),
    domainOperation: Object.freeze([
      pattern('external-effect-domain-operation', String.raw`(?:事件|订阅|处理器|回调|消息|主题|发布快照|\b(?:event|subscription|subscriber|handler|callback|message|topic)\b|\b(?:publish|release)\s*\()`)
    ]),
    domainInstallAction: Object.freeze([
      pattern('external-effect-domain-install-action', String.raw`(?:安装[^，,。；;\n]{0,24}(?:处理器|回调|监听器|中间件)|\binstall\b[^,.;\n]{0,40}\b(?:handler|callback|listener|middleware)\b)`)
    ]),
    question: Object.freeze([
      pattern('external-effect-question', String.raw`(?:如何|怎么|怎样|为什么|什么是|介绍|说明|方案|计划|\bhow\s+to\b|\bwhat\s+is\b|\bwhy\b|\bplan\b|\bdesign\b|\bapproach\b)`)
    ]),
    negated: Object.freeze([
      pattern('external-effect-negated', String.raw`(?:不要|不得|禁止|不允许|无需|无须|不需要|别|勿|请勿)[^，,。；;\n]{0,28}(?:发布|上线|部署|安装|提交|推送|拉取|创建\s*(?:PR|pr)|提(?:交)?\s*(?:PR|pr))|(?:do\s+not|don't|must\s+not|should\s+not|never|without)[^,.;\n]{0,36}(?:release|deploy|publish|install|commit|push|pull|fetch|merge|rebase|open\s+(?:a\s+)?(?:pr|pull\s+request)|create\s+(?:a\s+)?(?:pr|pull\s+request)|file\s+(?:a\s+)?(?:pr|pull\s+request)|submit\s+(?:a\s+)?(?:pr|pull\s+request))`)
    ]),
    bareReleaseImperative: Object.freeze([
      pattern('external-effect-bare-release-imperative', String.raw`^(?:请|现在|立即|帮我|麻烦)?\s*(?:发布|release|publish)\s*(?:吧)?$`)
    ]),
    negatedPhrase: Object.freeze([
      pattern('external-effect-negated-phrase', String.raw`(?:不要|不得|禁止|不允许|无需|无须|不需要|别|勿|请勿)[^，,。；;\n]{0,28}(?:发布|上线|部署|安装|提交|推送|拉取|创建\s*(?:PR|pr)|提(?:交)?\s*(?:PR|pr))|(?:do\s+not|don't|must\s+not|should\s+not|never|without)[^,.;\n]{0,36}(?:release|deploy|publish|install|commit|push|pull|fetch|merge|rebase|open\s+(?:a\s+)?(?:pr|pull\s+request)|create\s+(?:a\s+)?(?:pr|pull\s+request)|file\s+(?:a\s+)?(?:pr|pull\s+request)|submit\s+(?:a\s+)?(?:pr|pull\s+request))`, GLOBAL_FLAGS)
    ]),
  }),
  runProhibition: Object.freeze({
    strong: Object.freeze([
      pattern('run-prohibition-strong', String.raw`(?:不要|不用|无需|无须|不需要|不必|不得|不准|不能|禁止|别|勿|请勿)[^，,。；;\n]{0,24}(?:运行|执行|启动|测试)|(?:do\s+not|don't|must\s+not|should\s+not|may\s+not|never|without)[^,.;\n]{0,32}\b(?:run|running|execute|executing|start|starting|test|testing)\b|\bno\s+tests?\b`)
    ]),
    weak: Object.freeze([
      pattern('run-prohibition-weak', String.raw`(?:不|未)(?:运行|执行|启动|测试)|\bnot\s+(?:run|executed?|started?|tested?)\b`)
    ]),
    directWeak: Object.freeze([
      pattern('run-prohibition-direct-weak', String.raw`^(?:但|并且|同时|然后)?\s*(?:不|未)(?:运行|执行|启动|测试)(?:\s|$)`)
    ]),
    domainExecutionSubject: Object.freeze([
      pattern('run-prohibition-domain-subject', String.raw`(?:事件|订阅|处理器|回调|消息|发布|\b(?:event|subscription|subscriber|handler|callback|message|publish)\b)`)
    ]),
    operationalExecutionTarget: Object.freeze([
      pattern('run-prohibition-operational-target', String.raw`(?:命令|脚本|终端|编译|构建|测试套件|程序|项目|test\.sh|ctest|pytest|npm\s+test|pnpm\s+test|yarn\s+test|\b(?:command|script|terminal|compile|build|test\s+suite|program|project)\b)`)
    ]),
    phrase: Object.freeze([
      pattern('run-prohibition-phrase', String.raw`(?:不要|不用|无需|无须|不需要|不必|不得|不准|不能|禁止|别|勿|请勿)[^，,。；;\n]{0,24}(?:运行|执行|启动|测试)[^，,。；;\n]*|(?:do\s+not|don't|must\s+not|should\s+not|may\s+not|never|without)[^,.;\n]{0,32}\b(?:run|running|execute|executing|start|starting|test|testing)\b[^,.;\n]*|\bno\s+tests?\b`, GLOBAL_FLAGS)
    ]),
  }),
});

export function compileOperationalLanguageLexicon(
  extensionConfig?: OperationalLanguageLexiconConfig,
): CompiledOperationalLanguageLexicon {
  const merged = mergeOperationalLanguageLexicon(DEFAULT_OPERATIONAL_LANGUAGE_LEXICON, extensionConfig);
  return {
    externalEffect: compilePatternGroups(merged.externalEffect, EXTERNAL_EFFECT_GROUPS),
    runProhibition: compilePatternGroups(merged.runProhibition, RUN_PROHIBITION_GROUPS),
  };
}

export function loadOperationalLanguageLexiconConfigFromFile(filePath: string): OperationalLanguageLexiconConfig {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  return validateOperationalLanguageLexiconConfig(parsed);
}

function mergeOperationalLanguageLexicon(
  base: OperationalLanguageLexiconConfig,
  extensionConfig: OperationalLanguageLexiconConfig | undefined,
): Required<Pick<OperationalLanguageLexiconConfig, 'externalEffect' | 'runProhibition'>> {
  validateOperationalLanguageLexiconConfig(base);
  if (!extensionConfig) {
    return {
      externalEffect: clonePatternGroups(base.externalEffect, EXTERNAL_EFFECT_GROUPS),
      runProhibition: clonePatternGroups(base.runProhibition, RUN_PROHIBITION_GROUPS),
    };
  }
  validateOperationalLanguageLexiconConfig(extensionConfig);
  return {
    externalEffect: mergePatternGroups(base.externalEffect, extensionConfig.externalEffect, EXTERNAL_EFFECT_GROUPS),
    runProhibition: mergePatternGroups(base.runProhibition, extensionConfig.runProhibition, RUN_PROHIBITION_GROUPS),
  };
}

function validateOperationalLanguageLexiconConfig(value: unknown): OperationalLanguageLexiconConfig {
  if (!value || typeof value !== 'object') {
    throw new Error('operational-language-lexicon:config-must-be-object');
  }
  const config = value as OperationalLanguageLexiconConfig;
  if (config.version !== 'devseek.operational-language-lexicon/v1') {
    throw new Error('operational-language-lexicon:unsupported-version');
  }
  validatePatternGroups(config.externalEffect, new Set(EXTERNAL_EFFECT_GROUPS), 'externalEffect');
  validatePatternGroups(config.runProhibition, new Set(RUN_PROHIBITION_GROUPS), 'runProhibition');
  return config;
}

function validatePatternGroups<T extends string>(
  groups: Partial<Record<T, OperationalPatternSpec[]>> | undefined,
  allowedGroups: Set<string>,
  owner: string,
): void {
  if (!groups) return;
  for (const [group, specs] of Object.entries(groups)) {
    if (!allowedGroups.has(group)) throw new Error(`operational-language-lexicon:unknown-group:${owner}.${group}`);
    if (!Array.isArray(specs)) throw new Error(`operational-language-lexicon:group-not-array:${owner}.${group}`);
    for (const spec of specs) validatePatternSpec(spec, `${owner}.${group}`);
  }
}

function validatePatternSpec(spec: unknown, owner: string): asserts spec is OperationalPatternSpec {
  if (!spec || typeof spec !== 'object') {
    throw new Error(`operational-language-lexicon:pattern-not-object:${owner}`);
  }
  const candidate = spec as OperationalPatternSpec;
  if (!candidate.id || typeof candidate.id !== 'string') {
    throw new Error(`operational-language-lexicon:pattern-missing-id:${owner}`);
  }
  if (!candidate.source || typeof candidate.source !== 'string') {
    throw new Error(`operational-language-lexicon:pattern-missing-source:${owner}.${candidate.id}`);
  }
  const flags = candidate.flags ?? DEFAULT_FLAGS;
  if (!/^[dgimsuvy]*$/.test(flags)) {
    throw new Error(`operational-language-lexicon:pattern-invalid-flags:${owner}.${candidate.id}`);
  }
  new RegExp(candidate.source, flags);
}

function compilePatternGroups<T extends string>(
  groups: Partial<Record<T, OperationalPatternSpec[]>> | undefined,
  orderedGroups: readonly T[],
): Record<T, RegExp[]> {
  const compiled = {} as Record<T, RegExp[]>;
  for (const group of orderedGroups) {
    compiled[group] = (groups?.[group] ?? []).map(spec => new RegExp(spec.source, spec.flags ?? DEFAULT_FLAGS));
  }
  return compiled;
}

function mergePatternGroups<T extends string>(
  base: Partial<Record<T, readonly OperationalPatternSpec[]>> | undefined,
  extensionGroups: Partial<Record<T, readonly OperationalPatternSpec[]>> | undefined,
  orderedGroups: readonly T[],
): MutablePatternGroups<T> {
  const merged = {} as MutablePatternGroups<T>;
  for (const group of orderedGroups) {
    merged[group] = [
      ...(base?.[group] ?? []),
      ...(extensionGroups?.[group] ?? []),
    ];
  }
  return merged;
}

function clonePatternGroups<T extends string>(
  groups: Partial<Record<T, readonly OperationalPatternSpec[]>> | undefined,
  orderedGroups: readonly T[],
): MutablePatternGroups<T> {
  const cloned = {} as MutablePatternGroups<T>;
  for (const group of orderedGroups) cloned[group] = [...(groups?.[group] ?? [])];
  return cloned;
}

function pattern(id: string, source: string, flags = DEFAULT_FLAGS): OperationalPatternSpec {
  return { id, source, flags };
}

const EXTERNAL_EFFECT_GROUPS: readonly ExternalEffectPatternGroup[] = Object.freeze([
  'unambiguous',
  'ambiguousRelease',
  'releaseTarget',
  'domainOperation',
  'domainInstallAction',
  'question',
  'negated',
  'bareReleaseImperative',
  'negatedPhrase',
]);

const RUN_PROHIBITION_GROUPS: readonly RunProhibitionPatternGroup[] = Object.freeze([
  'strong',
  'weak',
  'directWeak',
  'domainExecutionSubject',
  'operationalExecutionTarget',
  'phrase',
]);
