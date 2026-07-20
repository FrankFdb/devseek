import { buildTaskContract, type TaskContract } from '../agent/task-contract';
import {
  buildIntentRevisionLineage,
  type IntentRevisionLineage,
  type IntentRevisionLineageInput,
} from './intent-revision-lineage';

export type ClarificationRiskStatus = 'ready' | 'blocked' | 'needs-confirmation';
export type ClarificationQuestionKind = 'intent-action' | 'target-scope' | 'acceptance';

export interface ClarificationQuestion {
  id: string;
  kind: ClarificationQuestionKind;
  impact: 'high';
  prompt: string;
  blockers: string[];
}

export interface ClarificationRiskEvidence {
  kind:
    | 'lineage-evaluated'
    | 'high-impact-ambiguity-detected'
    | 'low-risk-clarification-skipped'
    | 'clarification-answer-required'
    | 'clarification-answer-merged'
    | 'clarification-answer-insufficient'
    | 'task-contract-merged';
  source: 'lineage' | 'orientation' | 'answer' | 'contract';
  value: string;
}

export interface ClarificationRiskInput extends IntentRevisionLineageInput {
  lineage?: IntentRevisionLineage;
  clarificationAnswer?: string;
}

export interface ClarificationRiskDecision {
  version: 'devseek.clarification-risk/v1';
  prompt: string;
  mergedPrompt: string;
  status: ClarificationRiskStatus;
  lineage: IntentRevisionLineage;
  effectiveLineage: IntentRevisionLineage;
  taskContract: TaskContract;
  clarification: {
    required: boolean;
    highImpact: boolean;
    answered: boolean;
    question?: ClarificationQuestion;
  };
  blockers: string[];
  evidence: ClarificationRiskEvidence[];
  allowedToExecute: boolean;
}

const PATH_RE = /(?:^|[^A-Za-z0-9_.@+~/-])((?:(?:\.{0,2}\/)?[\w.@+~-]+(?:\/[\w.@+~-]+)+|[\w.@+~-]+\.(?:cxx|cpp|cc|c|hxx|hpp|hh|h|tsx|ts|jsx|js|mjs|cjs|py|json|ya?ml|toml|xml|txt|log|csv|ini|conf|cfg|proto|graphql|sh|bash|zsh|ps1|sql|cmake|gradle|markdown|md)))(?=$|[^A-Za-z0-9_.@+~/-])/gi;
const SOURCE_CONTEXT_PATH_RE = /\.(?:cxx|cpp|cc|c|hxx|hpp|hh|h|tsx|ts|jsx|js|mjs|cjs|py|json|ya?ml|toml|xml|ini|conf|cfg|proto|graphql|sh|bash|zsh|ps1|sql|cmake|gradle)$/i;

export function buildClarificationRiskDecision(input: ClarificationRiskInput): ClarificationRiskDecision {
  const prompt = String(input.prompt || input.lineage?.effectiveRevision.prompt || '').trim();
  const lineage = input.lineage ?? buildIntentRevisionLineage({
    prompt,
    previous: input.previous,
    committedEffects: input.committedEffects,
    knownPaths: input.knownPaths,
    authorizedExternalEffects: input.authorizedExternalEffects,
  });
  const answer = normalizeAnswer(input.clarificationAnswer);
  const highImpactQuestion = buildHighImpactQuestion(lineage);
  const hasHighImpactClarification = highImpactQuestion !== undefined;
  const evidence: ClarificationRiskEvidence[] = [{
    kind: 'lineage-evaluated',
    source: 'lineage',
    value: `${lineage.effectiveRevision.id}:${lineage.effectiveRevision.orientation.status}`,
  }];

  if (hasHighImpactClarification) {
    evidence.push({
      kind: 'high-impact-ambiguity-detected',
      source: 'orientation',
      value: highImpactQuestion.kind,
    });
  } else {
    evidence.push({
      kind: 'low-risk-clarification-skipped',
      source: 'orientation',
      value: lineage.effectiveRevision.orientation.risk,
    });
  }

  if (hasHighImpactClarification && !answer) {
    const blockers = uniqueStrings([...lineage.blockers, 'clarification-answer-required']);
    evidence.push({
      kind: 'clarification-answer-required',
      source: 'lineage',
      value: highImpactQuestion.id,
    });
    return {
      version: 'devseek.clarification-risk/v1',
      prompt,
      mergedPrompt: prompt,
      status: 'blocked',
      lineage,
      effectiveLineage: lineage,
      taskContract: lineage.effectiveRevision.orientation.route.semanticContract.taskContract,
      clarification: {
        required: true,
        highImpact: true,
        answered: false,
        question: highImpactQuestion,
      },
      blockers,
      evidence,
      allowedToExecute: false,
    };
  }

  const effectiveLineage = answer
    ? buildIntentRevisionLineage({
      previous: lineage,
      prompt: buildClarificationRevisionPrompt(lineage, answer),
      knownPaths: input.knownPaths,
      authorizedExternalEffects: input.authorizedExternalEffects,
      committedEffects: input.committedEffects,
    })
    : lineage;
  const taskContract = buildMergedTaskContract(effectiveLineage);
  const answerDidResolve = !effectiveLineage.effectiveRevision.orientation.requiresClarification;
  const status = resolveStatus(effectiveLineage, hasHighImpactClarification, answerDidResolve);
  const blockers = uniqueStrings([
    ...effectiveLineage.blockers,
    ...(hasHighImpactClarification && answer && !answerDidResolve
      ? ['clarification-answer-insufficient']
      : []),
  ]);

  if (answer) {
    evidence.push({
      kind: answerDidResolve ? 'clarification-answer-merged' : 'clarification-answer-insufficient',
      source: 'answer',
      value: effectiveLineage.effectiveRevision.id,
    });
  }
  evidence.push({
    kind: 'task-contract-merged',
    source: 'contract',
    value: taskContract.taskShapes.join('+') || 'general',
  });

  return {
    version: 'devseek.clarification-risk/v1',
    prompt,
    mergedPrompt: effectiveLineage.effectiveRevision.prompt,
    status,
    lineage,
    effectiveLineage,
    taskContract,
    clarification: {
      required: hasHighImpactClarification && !answerDidResolve,
      highImpact: hasHighImpactClarification,
      answered: answer !== '',
      question: hasHighImpactClarification && !answerDidResolve ? highImpactQuestion : undefined,
    },
    blockers,
    evidence,
    allowedToExecute: status === 'ready',
  };
}

function buildHighImpactQuestion(lineage: IntentRevisionLineage): ClarificationQuestion | undefined {
  const revision = lineage.effectiveRevision;
  const blockers = uniqueStrings([...revision.blockers, ...lineage.blockers]);
  if (!revision.orientation.requiresClarification && blockers.length === 0) return undefined;

  const missingPathBlockers = blockers.filter(blocker => blocker.startsWith('orientation-target-path-not-found:'));
  if (missingPathBlockers.length > 0) {
    return {
      id: `clarify-target-${revision.id}`,
      kind: 'target-scope',
      impact: 'high',
      prompt: '请确认正确的文件、目录或允许的目标范围。',
      blockers: missingPathBlockers,
    };
  }

  if (blockers.includes('orientation-ambiguous-intent')
    || blockers.includes('semantic-clarification-needed')) {
    return {
      id: `clarify-action-${revision.id}`,
      kind: 'intent-action',
      impact: 'high',
      prompt: '请确认下一步是只读说明、制定计划、修改文件、运行验证，还是执行外部操作。',
      blockers: blockers.filter(blocker => (
        blocker === 'orientation-ambiguous-intent'
        || blocker === 'semantic-clarification-needed'
      )),
    };
  }

  if (revision.orientation.status === 'needs-clarification') {
    return {
      id: `clarify-acceptance-${revision.id}`,
      kind: 'acceptance',
      impact: 'high',
      prompt: '请补充目标、范围或验收标准后再执行。',
      blockers,
    };
  }

  return undefined;
}

function buildMergedTaskContract(effectiveLineage: IntentRevisionLineage): TaskContract {
  const contract = buildTaskContract(effectiveLineage.effectiveRevision.prompt);
  const sourcePaths = uniqueStrings([
    ...contract.verificationContract.requiredSourcePaths,
    ...contract.inputs,
    ...effectiveLineage.effectiveRevision.scope.targets,
  ].filter(isSourceContextPath).map(normalizePathToken));

  return {
    ...contract,
    verificationContract: {
      ...contract.verificationContract,
      requiredSourcePaths: sourcePaths,
    },
  };
}

function resolveStatus(
  effectiveLineage: IntentRevisionLineage,
  hadHighImpactClarification: boolean,
  answerDidResolve: boolean,
): ClarificationRiskStatus {
  if (effectiveLineage.effectiveRevision.orientation.requiresConfirmation) return 'needs-confirmation';
  if (!effectiveLineage.allowedToExecute) return 'blocked';
  if (hadHighImpactClarification && !answerDidResolve) return 'blocked';
  return 'ready';
}

function buildClarificationRevisionPrompt(lineage: IntentRevisionLineage, answer: string): string {
  const scopedAnswer = answerHasPath(answer)
    ? answer
    : appendScopeFromLineage(answer, lineage);
  return `澄清答复（以此为准）：${scopedAnswer}`;
}

function appendScopeFromLineage(answer: string, lineage: IntentRevisionLineage): string {
  const targets = [
    ...lineage.effectiveRevision.scope.targets,
    ...collectPaths(lineage.effectiveRevision.prompt),
  ];
  const uniqueTargets = uniqueStrings(targets.map(normalizePathToken).filter(Boolean));
  if (uniqueTargets.length === 0) return answer;
  return `${answer} 目标范围：${uniqueTargets.join('、')}。`;
}

function answerHasPath(answer: string): boolean {
  return collectPaths(answer).length > 0;
}

function isSourceContextPath(value: string): boolean {
  return SOURCE_CONTEXT_PATH_RE.test(stripTrailingPunctuation(value));
}

function collectPaths(text: string): string[] {
  const paths: string[] = [];
  PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_RE.exec(text)) !== null) {
    paths.push(stripTrailingPunctuation(match[1]));
  }
  return paths;
}

function normalizeAnswer(answer: string | undefined): string {
  return String(answer || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function stripTrailingPunctuation(value: string): string {
  return value.trim().replace(/[.,;:!?，。；：！？）)\]]+$/g, '');
}

function normalizePathToken(value: string): string {
  return stripTrailingPunctuation(value)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/+$/, '');
}
