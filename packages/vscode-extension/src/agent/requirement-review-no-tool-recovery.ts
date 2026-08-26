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

export function recoverRequirementReviewNoToolCompletion(
  requirementReview: RequirementReviewRecoverySource,
  consecutiveRound: number,
): RequirementReviewNoToolRecoveryDecision | undefined {
  const reviewRecovery = requirementReview.recoverNoToolCompletion(consecutiveRound);
  if (reviewRecovery?.kind === 'stop') {
    return { kind: 'stop', reason: reviewRecovery.reason };
  }
  if (reviewRecovery?.kind === 'retry') {
    return buildRetryDecision(reviewRecovery.feedback);
  }

  const reviewBlocker = requirementReview.completionBlocker();
  if (!reviewBlocker || consecutiveRound > 4) return undefined;
  return buildRetryDecision([
    '【系统反馈：工具执行缺失】',
    '上一轮回复没有产生真实工具调用，不能推进当前门禁。',
    reviewBlocker,
    '下一回复只输出推进当前审查所需的真实工具调用，不要自造工具结果或审查通过结论。',
  ].join('\n'));
}

function buildRetryDecision(feedback: string): RequirementReviewNoToolRecoveryDecision {
  return {
    kind: 'retry',
    feedback,
    statusTitle: '正在复核最终源码与用户需求',
    statusDetail: '公开测试已经通过，但最终源码尚未经过独立需求覆盖复核。DevSeek 正在要求模型重新读取变更后的实现，再逐条核对用户行为要求。',
    statusActivity: '要求重新读取最终源码',
  };
}
