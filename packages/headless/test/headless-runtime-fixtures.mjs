export function completedRuntimeResult(request, value, options = {}) {
  const prefix = options.evidencePrefix ?? 'headless-review';
  const acceptanceEvidence = request.taskContract.acceptance.map(criterion => ({
    criterionId: criterion.id,
    status: 'passed',
    evidenceRefs: [`${prefix}:${criterion.id}:passed`],
  }));
  return {
    result: value,
    completionEvidence: {
      reviewRequired: false,
      acceptanceEvidence,
      pendingRefs: [],
      adverseEvidenceRefs: [],
      residualRisks: [],
      evidenceRefs: acceptanceEvidence.flatMap(item => item.evidenceRefs),
      ...options.completionEvidence,
    },
  };
}
