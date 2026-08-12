const DEVSEEK_EXECUTED_TOOL_SUMMARY_RE = /\[DevSeek 已执行工具请求摘要\]/u;
const DEVSEEK_TOOL_RESULT_ROUND_RE = /\[工具结果 Round\s+\d+\]/u;
const PROVIDER_AUTHORED_TOOL_RESULT_RE =
  /(?:工具返回|工具执行结果|run_terminal:|read_file:|list_dir:|grep_search:|\[(?:读文件|读取文件|read_file|write_file|replace_in_file|run_terminal|list_dir|grep_search)\s*[:：])/u;

interface RequirementReviewRecoverySource {
  recoverNoToolCompletion(consecutiveRound: number):
    | { kind: 'retry'; feedback: string }
    | { kind: 'stop'; reason: string }
    | undefined;
  completionBlocker(): string | undefined;
}

export type RequirementReviewNoToolRecoveryDecision =
  | {
      kind: 'retry';
      feedback: string;
      statusTitle: string;
      statusDetail: string;
      statusActivity: string;
    }
  | {
      kind: 'stop';
      reason: string;
    };

export function containsProviderAuthoredToolTranscript(text: string): boolean {
  return DEVSEEK_EXECUTED_TOOL_SUMMARY_RE.test(text)
    || DEVSEEK_TOOL_RESULT_ROUND_RE.test(text)
    || PROVIDER_AUTHORED_TOOL_RESULT_RE.test(text);
}

export function buildProviderAuthoredToolTranscriptRecovery(
  blocker: string,
  containsTranscript: boolean,
): string {
  return [
    containsTranscript
      ? '【系统反馈：伪造工具结果已拦截】'
      : '【系统反馈：工具执行缺失】',
    containsTranscript
      ? '上一轮回复复述了 DevSeek 内部工具摘要、工具结果或审查结论文本，但没有产生任何真实工具调用；这些文字不能作为 read_file、验证或独立审查证据。'
      : '上一轮回复没有产生真实工具调用，不能推进当前门禁。',
    blocker,
    '下一回复只输出真实工具调用：需要最终源码复核时调用 read_file 读取指定源码；需要修复时调用 replace_in_file/write_file；不要再输出 [DevSeek 已执行工具请求摘要]、[工具结果 Round] 或自造审查通过结论。',
  ].join('\n');
}

export function recoverRequirementReviewNoToolCompletion(
  requirementReview: RequirementReviewRecoverySource,
  consecutiveRound: number,
  providerText: string,
): RequirementReviewNoToolRecoveryDecision | undefined {
  const containsTranscript = containsProviderAuthoredToolTranscript(providerText);
  const reviewRecovery = requirementReview.recoverNoToolCompletion(consecutiveRound);
  if (reviewRecovery?.kind === 'stop') {
    return { kind: 'stop', reason: reviewRecovery.reason };
  }
  if (reviewRecovery?.kind === 'retry') {
    const feedback = containsTranscript
      ? buildProviderAuthoredToolTranscriptRecovery(
          [
            requirementReview.completionBlocker(),
            reviewRecovery.feedback,
          ].filter(Boolean).join('\n\n'),
          true,
        )
      : reviewRecovery.feedback;
    return buildRetryDecision(feedback, containsTranscript);
  }

  const reviewBlocker = requirementReview.completionBlocker();
  if (!reviewBlocker || consecutiveRound > 4) return undefined;
  return buildRetryDecision(
    buildProviderAuthoredToolTranscriptRecovery(reviewBlocker, containsTranscript),
    containsTranscript,
  );
}

function buildRetryDecision(
  feedback: string,
  containsTranscript: boolean,
): RequirementReviewNoToolRecoveryDecision {
  return {
    kind: 'retry',
    feedback,
    statusTitle: containsTranscript ? '已拦截伪造工具结果' : '正在复核最终源码与用户需求',
    statusDetail: containsTranscript
      ? '模型回复复述了内部工具结果文本，但没有任何真实工具调用。DevSeek 正在要求下一轮只输出真实 read_file/write/terminal 工具调用。'
      : '公开测试已经通过，但最终源码尚未经过独立需求覆盖复核。DevSeek 正在要求模型重新读取变更后的实现，再逐条核对用户行为要求。',
    statusActivity: containsTranscript ? '拦截伪造工具结果' : '要求重新读取最终源码',
  };
}
