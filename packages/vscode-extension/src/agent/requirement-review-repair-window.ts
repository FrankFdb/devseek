const AGENTIC_REQUIREMENT_REVIEW_REPAIR_GRACE_ROUNDS = 6;
const AGENTIC_REQUIREMENT_REVIEW_MAX_GRACE_ROUNDS = 24;

export interface RequirementReviewRepairWindowUpdate {
  graceRounds: number;
  failureStatus?: readonly [title: string, detail: string, activity: string];
}

export interface RequirementReviewRepairWindowRenewal {
  currentGraceRounds: number;
  baseRoundLimit: number;
  roundCount: number;
  concreteProgress: boolean;
  reviewPending: boolean;
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
        '公开验证已经通过，但最终源码仍有需求级反例。DevSeek 已切换到局部修复窗口：核实完整 finding 队列，合并修复共同责任边界并回归大 case。',
        '修复审查 finding 队列',
      ],
    } : {}),
  };
}

/** Renews an active review repair lease only from accepted, observable progress. */
export function renewRequirementReviewRepairWindow(
  input: RequirementReviewRepairWindowRenewal,
): number {
  if (!input.concreteProgress || !input.reviewPending) return input.currentGraceRounds;
  const requiredGraceRounds = Math.max(
    0,
    input.roundCount + AGENTIC_REQUIREMENT_REVIEW_REPAIR_GRACE_ROUNDS - input.baseRoundLimit,
  );
  return Math.min(
    AGENTIC_REQUIREMENT_REVIEW_MAX_GRACE_ROUNDS,
    Math.max(input.currentGraceRounds, requiredGraceRounds),
  );
}
