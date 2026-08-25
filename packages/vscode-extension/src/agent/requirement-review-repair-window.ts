const AGENTIC_REQUIREMENT_REVIEW_REPAIR_GRACE_ROUNDS = 6;
const AGENTIC_REQUIREMENT_REVIEW_MAX_GRACE_ROUNDS = 24;

export interface RequirementReviewRepairWindowUpdate {
  graceRounds: number;
  failureStatus?: readonly [title: string, detail: string, activity: string];
}

/** Owns the bounded local-repair budget for failed final-source reviews. */
export function updateRequirementReviewRepairWindow(
  currentGraceRounds: number,
  reviewFeedback: string,
): RequirementReviewRepairWindowUpdate {
  const failedReview = /【独立需求审查：未通过】/.test(reviewFeedback);
  const nextGraceRounds = failedReview
    ? currentGraceRounds + AGENTIC_REQUIREMENT_REVIEW_REPAIR_GRACE_ROUNDS
    : Math.max(currentGraceRounds, AGENTIC_REQUIREMENT_REVIEW_REPAIR_GRACE_ROUNDS);
  return {
    graceRounds: Math.min(nextGraceRounds, AGENTIC_REQUIREMENT_REVIEW_MAX_GRACE_ROUNDS),
    ...(failedReview ? {
      failureStatus: [
        '独立需求审查发现缺陷，进入定点修复',
        '公开验证已经通过，但最终源码仍有需求级反例。DevSeek 已切换到局部修复窗口：先复现首个 finding，再修生产源码并回归大 case。',
        '定点修复审查反例',
      ],
    } : {}),
  };
}
