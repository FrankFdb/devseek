const R3_07G_STALE_DOMAIN_SNIPPETS = Object.freeze([
  'warranty',
  'UAV 吊运维保',
  '维保提醒',
  'maintenance_threshold_engine',
  'uav-warranty-reminder',
]);

const R3_07G_SKILL_AGGREGATE_SPEC = Object.freeze({
  id: 'r3-07g-skill-aggregate',
  kind: 'iteration',
  profileKind: 'skill',
  minimumMarkdownBytes: 900,
  minimumMarkdownLines: 18,
  minimumMarkdownHeadings: 4,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-07G-skill-AGGREGATE denominator aggregation audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-07g-skill-aggregate-denominator.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-07g-skill-aggregate-denominator.md',
  requiredArtifactSnippets: Object.freeze([
    'R3-07G-skill-AGGREGATE',
    'ExtensionProfilePlanService',
    '20 task slots',
    '100 permission-fault slots',
    'missing/failed/vetoed/blocked/duplicate/foreign',
    'aggregateExecutionAllowed: false',
    'slotExecutionAllowed: false',
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
});

const R3_07G_HOOK_AGGREGATE_SPEC = Object.freeze({
  id: 'r3-07g-hook-aggregate',
  kind: 'iteration',
  profileKind: 'hook',
  minimumMarkdownBytes: 950,
  minimumMarkdownLines: 22,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-07G-hook-AGGREGATE denominator aggregation audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-07g-hook-aggregate-denominator.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-07g-hook-aggregate-denominator.md',
  requiredArtifactSnippets: Object.freeze([
    'R3-07G-hook-AGGREGATE',
    'ExtensionProfilePlanService',
    'HookPlanner',
    'HookPolicy',
    '20 task slots',
    '100 permission-fault slots',
    'hook-direct-writer-denied',
    'hook-failure-visible',
    'hook-bypass-visible',
    'skill receipts cannot qualify hook slots',
    'aggregateExecutionAllowed: false',
    'slotExecutionAllowed: false',
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
});

export function buildRealPluginQualityProfile(scenario) {
  const spec = lookupScenarioSpec(scenario);
  if (spec) {
    return {
      kind: spec.kind,
      minimumMarkdownBytes: spec.minimumMarkdownBytes,
      minimumMarkdownLines: spec.minimumMarkdownLines,
      minimumMarkdownHeadings: spec.minimumMarkdownHeadings,
      requireFormalProjectQuality: spec.requireFormalProjectQuality,
    };
  }
  const kind = classifyScenario(scenario);
  return {
    kind,
    minimumMarkdownBytes: kind === 'canary' ? 120 : kind === 'medium' ? 300 : 500,
    minimumMarkdownLines: kind === 'canary' ? 2 : 8,
    minimumMarkdownHeadings: kind === 'canary' ? 1 : 2,
    requireFormalProjectQuality: kind !== 'canary',
  };
}

export function buildRealPluginScenarioSpec(scenario) {
  const spec = lookupScenarioSpec(scenario);
  if (!spec) {
    return {
      id: normalizeScenario(scenario),
      promptTitle: '',
      requestedOutputDocRel: '',
      expectedArtifactRel: '',
      requiredArtifactSnippets: [],
      forbiddenArtifactSnippets: [],
    };
  }
  return {
    id: spec.id,
    kind: spec.kind,
    minimumMarkdownBytes: spec.minimumMarkdownBytes,
    minimumMarkdownLines: spec.minimumMarkdownLines,
    minimumMarkdownHeadings: spec.minimumMarkdownHeadings,
    requireFormalProjectQuality: spec.requireFormalProjectQuality,
    promptTitle: spec.promptTitle,
    profileKind: spec.profileKind,
    deliveryMode: spec.deliveryMode,
    requestedOutputDocRel: spec.requestedOutputDocRel,
    expectedArtifactRel: spec.expectedArtifactRel,
    requiredArtifactSnippets: [...spec.requiredArtifactSnippets],
    forbiddenArtifactSnippets: [...spec.forbiddenArtifactSnippets],
  };
}

export function parseRequiredArtifactSnippets(value) {
  return String(value || '')
    .split(/\|\||\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

function lookupScenarioSpec(value) {
  const scenario = normalizeScenario(value);
  if (scenario === R3_07G_SKILL_AGGREGATE_SPEC.id) return R3_07G_SKILL_AGGREGATE_SPEC;
  if (scenario === R3_07G_HOOK_AGGREGATE_SPEC.id) return R3_07G_HOOK_AGGREGATE_SPEC;
  return null;
}

function normalizeScenario(value) {
  return String(value || '').trim().toLowerCase();
}

function classifyScenario(value) {
  const scenario = normalizeScenario(value);
  if (/canary|smoke|short|tiny|read-only/.test(scenario)) return 'canary';
  if (/medium|integration/.test(scenario)) return 'medium';
  return 'formal';
}
