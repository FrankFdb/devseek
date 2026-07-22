const R3_07G_SKILL_AGGREGATE_SPEC = Object.freeze({
  id: 'r3-07g-skill-aggregate',
  kind: 'iteration',
  minimumMarkdownBytes: 900,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-07G-skill-AGGREGATE denominator aggregation audit',
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
});

export function buildRealPluginQualityProfile(scenario) {
  const spec = lookupScenarioSpec(scenario);
  if (spec) {
    return {
      kind: spec.kind,
      minimumMarkdownBytes: spec.minimumMarkdownBytes,
      requireFormalProjectQuality: spec.requireFormalProjectQuality,
    };
  }
  const kind = classifyScenario(scenario);
  return {
    kind,
    minimumMarkdownBytes: kind === 'canary' ? 120 : kind === 'medium' ? 300 : 500,
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
    };
  }
  return {
    id: spec.id,
    kind: spec.kind,
    minimumMarkdownBytes: spec.minimumMarkdownBytes,
    requireFormalProjectQuality: spec.requireFormalProjectQuality,
    promptTitle: spec.promptTitle,
    requestedOutputDocRel: spec.requestedOutputDocRel,
    expectedArtifactRel: spec.expectedArtifactRel,
    requiredArtifactSnippets: [...spec.requiredArtifactSnippets],
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
