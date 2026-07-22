const R3_07G_STALE_DOMAIN_SNIPPETS = Object.freeze([
  'warranty',
  'UAV 吊运维保',
  '维保提醒',
  'maintenance_threshold_engine',
  'uav-warranty-reminder',
]);

const R3_07G_AGGREGATE_SPECS = Object.freeze([
  createR3KindAggregateSpec({
    profileKind: 'skill',
    minimumMarkdownBytes: 900,
    minimumMarkdownLines: 18,
    minimumMarkdownHeadings: 4,
    requiredArtifactSnippets: [
      'R3-07G-skill-AGGREGATE',
      'ExtensionProfilePlanService',
      '20 task slots',
      '100 permission-fault slots',
      'missing/failed/vetoed/blocked/duplicate/foreign',
      'aggregateExecutionAllowed: false',
      'slotExecutionAllowed: false',
    ],
  }),
  createR3KindAggregateSpec({
    profileKind: 'hook',
    requiredArtifactSnippets: [
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
    ],
  }),
  createR3KindAggregateSpec({
    profileKind: 'mcp',
    requiredArtifactSnippets: [
      'R3-07G-mcp-AGGREGATE',
      'ExtensionProfilePlanService',
      'McpPermissionService',
      'MCP_TRUST_PROTOCOL',
      '20 task slots',
      '100 permission-fault slots',
      'mcp-unknown-mutable-veto',
      'mcp-unsigned-server-veto',
      'mcp-permission-escape-veto',
      'skill receipts cannot qualify mcp slots',
      'aggregateExecutionAllowed: false',
      'slotExecutionAllowed: false',
    ],
  }),
  createR3KindAggregateSpec({
    profileKind: 'plugin',
    requiredArtifactSnippets: [
      'R3-07G-plugin-AGGREGATE',
      'ExtensionProfilePlanService',
      'PluginSupplyChainService',
      'PLUGIN_SUPPLY_CHAIN_PROTOCOL',
      '20 task slots',
      '100 permission-fault slots',
      'plugin-unsigned-veto',
      'plugin-tampered-veto',
      'plugin-dependency-veto',
      'skill receipts cannot qualify plugin slots',
      'aggregateExecutionAllowed: false',
      'slotExecutionAllowed: false',
    ],
  }),
  createR3KindAggregateSpec({
    profileKind: 'subagent',
    requiredArtifactSnippets: [
      'R3-07G-subagent-AGGREGATE',
      'ExtensionProfilePlanService',
      'SUBAGENT_CONTRACT_PROTOCOL',
      'Subagent contract',
      '20 task slots',
      '100 permission-fault slots',
      'child-direct-effect-rejected',
      'child-terminal-claim-rejected',
      'skill receipts cannot qualify subagent slots',
      'aggregateExecutionAllowed: false',
      'slotExecutionAllowed: false',
    ],
  }),
]);

const R3_07G_AGGREGATE_SPEC_BY_ID = new Map(R3_07G_AGGREGATE_SPECS.map(spec => [spec.id, spec]));

const R3_07H_REQUIRED_KINDS_AGGREGATE_SPEC = Object.freeze({
  id: 'r3-07h-required-kinds-aggregate',
  kind: 'iteration',
  minimumMarkdownBytes: 1000,
  minimumMarkdownLines: 24,
  minimumMarkdownHeadings: 5,
  requireFormalProjectQuality: false,
  promptTitle: 'R3-07H-required-kinds-AGGREGATE required kind claims audit',
  deliveryMode: 'markdown-file-deliverable',
  requestedOutputDocRel: 'docs/r3-iteration/r3-07h-required-kinds-aggregate.md',
  expectedArtifactRel: 'docs/r3-iteration/r3-07h-required-kinds-aggregate.md',
  requiredArtifactSnippets: Object.freeze([
    'R3-07H-required-kinds-AGGREGATE',
    'ExtensionProfilePlanService',
    'aggregateRequiredKinds',
    '07G claim',
    'skill',
    'hook',
    'mcp',
    'plugin',
    'subagent',
    'required-kinds-missing-veto',
    'required-kinds-duplicate-veto',
    'required-kinds-foreign-veto',
    'required-kinds-blocked-veto',
    'wrong-candidate',
    'one kind cannot substitute another',
    'aggregateExecutionAllowed: false',
    'slotExecutionAllowed: false',
  ]),
  forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
});

function createR3KindAggregateSpec(input) {
  const profileKind = input.profileKind;
  return Object.freeze({
    id: `r3-07g-${profileKind}-aggregate`,
    kind: 'iteration',
    profileKind,
    minimumMarkdownBytes: input.minimumMarkdownBytes ?? 950,
    minimumMarkdownLines: input.minimumMarkdownLines ?? 22,
    minimumMarkdownHeadings: input.minimumMarkdownHeadings ?? 5,
    requireFormalProjectQuality: false,
    promptTitle: `R3-07G-${profileKind}-AGGREGATE denominator aggregation audit`,
    deliveryMode: 'markdown-file-deliverable',
    requestedOutputDocRel: `docs/r3-iteration/r3-07g-${profileKind}-aggregate-denominator.md`,
    expectedArtifactRel: `docs/r3-iteration/r3-07g-${profileKind}-aggregate-denominator.md`,
    requiredArtifactSnippets: Object.freeze(input.requiredArtifactSnippets),
    forbiddenArtifactSnippets: R3_07G_STALE_DOMAIN_SNIPPETS,
  });
}

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
  if (scenario === R3_07H_REQUIRED_KINDS_AGGREGATE_SPEC.id) return R3_07H_REQUIRED_KINDS_AGGREGATE_SPEC;
  return R3_07G_AGGREGATE_SPEC_BY_ID.get(scenario) ?? null;
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
