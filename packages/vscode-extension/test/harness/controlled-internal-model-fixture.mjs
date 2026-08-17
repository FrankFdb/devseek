const INTERNAL_PROMPT_PREFIX = '[指令]\n';

const INTERNAL_MODEL_CONTRACTS = [
  {
    requestKind: 'memory-phase-1',
    systemMarker: 'You are DevSeek memory Phase 1. Extract durable coding-agent memory from one immutable rollout.',
    requiredSegments: [
      'For no durable signal return exactly {"rollout_summary":"","raw_memory":"","candidates":[]}.',
      '"evidence_refs":["..."]',
    ],
    response: '{"rollout_summary":"","raw_memory":"","candidates":[]}',
  },
  {
    requestKind: 'memory-phase-2',
    systemMarker: 'You are DevSeek memory Phase 2. Consolidate bounded Phase 1 evidence into durable coding memory proposals.',
    requiredSegments: [
      'The always-loaded summary is generated locally from accepted records; never propose or emit summary text.',
      'When there is no useful change, return {"proposals":[]}.',
    ],
    response: '{"proposals":[]}',
  },
];

export function bindControlledInternalModelPrompt(promptText) {
  const contract = INTERNAL_MODEL_CONTRACTS.find(candidate => (
    promptText.startsWith(`${INTERNAL_PROMPT_PREFIX}${candidate.systemMarker}`)
  ));
  if (!contract) return undefined;

  const observedSegments = Object.fromEntries(contract.requiredSegments.map(segment => [
    segment,
    promptText.includes(segment),
  ]));
  const missingSegments = contract.requiredSegments.filter(segment => !observedSegments[segment]);
  const hasEvidencePayload = promptText.includes('\n\n{');
  const bound = missingSegments.length === 0 && hasEvidencePayload;

  return {
    requestKind: contract.requestKind,
    promptContract: {
      contractVersion: 'devseek.controlled-internal-model/v1',
      expected: {
        systemMarker: contract.systemMarker,
        requiredSegments: contract.requiredSegments,
        evidencePayload: true,
      },
      observed: {
        systemMarker: true,
        requiredSegments: observedSegments,
        evidencePayload: hasEvidencePayload,
      },
      bound,
      reason: bound
        ? 'exact internal memory model contract matched'
        : `internal memory model contract mismatch: ${JSON.stringify({ missingSegments, hasEvidencePayload })}`,
    },
  };
}

export function controlledInternalModelResponse(requestKind) {
  const contract = INTERNAL_MODEL_CONTRACTS.find(candidate => candidate.requestKind === requestKind);
  if (!contract) throw new Error(`Unknown controlled internal model request kind: ${requestKind}`);
  return contract.response;
}
