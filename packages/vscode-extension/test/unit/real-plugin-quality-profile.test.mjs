import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRealPluginQualityProfile,
  buildRealPluginScenarioSpec,
  parseRequiredArtifactSnippets,
} from '../harness/real-plugin-quality-profile.mjs';

test('real plugin quality profile keeps short canaries task-specific', () => {
  const profile = buildRealPluginQualityProfile('short-canary');

  assert.equal(profile.kind, 'canary');
  assert.equal(profile.minimumMarkdownBytes, 120);
  assert.equal(profile.requireFormalProjectQuality, false);
});

test('real plugin quality profile preserves strict project checks for medium and formal tasks', () => {
  assert.equal(buildRealPluginQualityProfile('medium-integration').requireFormalProjectQuality, true);
  assert.equal(buildRealPluginQualityProfile('formal-simulation').requireFormalProjectQuality, true);
  assert.equal(buildRealPluginQualityProfile('unknown').kind, 'formal');
});

test('required artifact snippets are explicit task assertions, not domain keywords', () => {
  assert.deepEqual(
    parseRequiredArtifactSnippets('kMavTunnelCmdLicense||print("\\nready")\nlicense_types.hpp'),
    ['kMavTunnelCmdLicense', 'print("\\nready")', 'license_types.hpp'],
  );
});

test('R3-07G real plugin scenario binds aggregate denominator artifact acceptance', () => {
  const profile = buildRealPluginQualityProfile('r3-07g-skill-aggregate');
  const spec = buildRealPluginScenarioSpec('r3-07g-skill-aggregate');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.minimumMarkdownBytes, 900);
  assert.equal(profile.minimumMarkdownLines, 18);
  assert.equal(profile.minimumMarkdownHeadings, 4);
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-07g-skill-aggregate');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-07g-skill-aggregate-denominator.md');
  assert.match(spec.promptTitle, /R3-07G-skill-AGGREGATE/);
  assert.deepEqual(spec.requiredArtifactSnippets, [
    'R3-07G-skill-AGGREGATE',
    'ExtensionProfilePlanService',
    '20 task slots',
    '100 permission-fault slots',
    'missing/failed/vetoed/blocked/duplicate/foreign',
    'aggregateExecutionAllowed: false',
    'slotExecutionAllowed: false',
  ]);
  assert.deepEqual(spec.forbiddenArtifactSnippets, [
    'warranty',
    'UAV 吊运维保',
    '维保提醒',
    'maintenance_threshold_engine',
    'uav-warranty-reminder',
  ]);
});

test('R3-07G hook real plugin scenario binds hook-specific aggregate artifact acceptance', () => {
  const profile = buildRealPluginQualityProfile('r3-07g-hook-aggregate');
  const spec = buildRealPluginScenarioSpec('r3-07g-hook-aggregate');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.minimumMarkdownBytes, 950);
  assert.equal(profile.minimumMarkdownLines, 22);
  assert.equal(profile.minimumMarkdownHeadings, 5);
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-07g-hook-aggregate');
  assert.equal(spec.profileKind, 'hook');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-07g-hook-aggregate-denominator.md');
  assert.match(spec.promptTitle, /R3-07G-hook-AGGREGATE/);
  assert.deepEqual(spec.requiredArtifactSnippets, [
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
  ]);
  assert.deepEqual(spec.forbiddenArtifactSnippets, [
    'warranty',
    'UAV 吊运维保',
    '维保提醒',
    'maintenance_threshold_engine',
    'uav-warranty-reminder',
  ]);
});

[
  {
    scenario: 'r3-07g-mcp-aggregate',
    profileKind: 'mcp',
    artifactRel: 'docs/r3-iteration/r3-07g-mcp-aggregate-denominator.md',
    requiredSnippets: [
      'R3-07G-mcp-AGGREGATE',
      'McpPermissionService',
      'MCP_TRUST_PROTOCOL',
      'mcp-unknown-mutable-veto',
      'mcp-unsigned-server-veto',
      'mcp-permission-escape-veto',
      'skill receipts cannot qualify mcp slots',
    ],
  },
  {
    scenario: 'r3-07g-plugin-aggregate',
    profileKind: 'plugin',
    artifactRel: 'docs/r3-iteration/r3-07g-plugin-aggregate-denominator.md',
    requiredSnippets: [
      'R3-07G-plugin-AGGREGATE',
      'PluginSupplyChainService',
      'PLUGIN_SUPPLY_CHAIN_PROTOCOL',
      'plugin-unsigned-veto',
      'plugin-tampered-veto',
      'plugin-dependency-veto',
      'skill receipts cannot qualify plugin slots',
    ],
  },
  {
    scenario: 'r3-07g-subagent-aggregate',
    profileKind: 'subagent',
    artifactRel: 'docs/r3-iteration/r3-07g-subagent-aggregate-denominator.md',
    requiredSnippets: [
      'R3-07G-subagent-AGGREGATE',
      'SUBAGENT_CONTRACT_PROTOCOL',
      'Subagent contract',
      'child-direct-effect-rejected',
      'child-terminal-claim-rejected',
      'skill receipts cannot qualify subagent slots',
    ],
  },
].forEach(({ scenario, profileKind, artifactRel, requiredSnippets }) => {
  test(`R3-07G ${profileKind} real plugin scenario adds a fresh visible case`, () => {
    const profile = buildRealPluginQualityProfile(scenario);
    const spec = buildRealPluginScenarioSpec(scenario);

    assert.equal(profile.kind, 'iteration');
    assert.equal(profile.minimumMarkdownBytes, 950);
    assert.equal(profile.minimumMarkdownLines, 22);
    assert.equal(profile.minimumMarkdownHeadings, 5);
    assert.equal(profile.requireFormalProjectQuality, false);
    assert.equal(spec.profileKind, profileKind);
    assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
    assert.equal(spec.expectedArtifactRel, artifactRel);
    assert.match(spec.promptTitle, new RegExp(`R3-07G-${profileKind}-AGGREGATE`));
    for (const snippet of [
      'ExtensionProfilePlanService',
      '20 task slots',
      '100 permission-fault slots',
      'aggregateExecutionAllowed: false',
      'slotExecutionAllowed: false',
      ...requiredSnippets,
    ]) {
      assert.ok(spec.requiredArtifactSnippets.includes(snippet), `${scenario} must require ${snippet}`);
    }
    assert.ok(spec.forbiddenArtifactSnippets.includes('uav-warranty-reminder'));
  });
});

test('R3-07H required-kinds real plugin scenario adds a fresh visible case', () => {
  const profile = buildRealPluginQualityProfile('r3-07h-required-kinds-aggregate');
  const spec = buildRealPluginScenarioSpec('r3-07h-required-kinds-aggregate');

  assert.equal(profile.kind, 'iteration');
  assert.equal(profile.minimumMarkdownBytes, 1000);
  assert.equal(profile.minimumMarkdownLines, 24);
  assert.equal(profile.minimumMarkdownHeadings, 5);
  assert.equal(profile.requireFormalProjectQuality, false);
  assert.equal(spec.id, 'r3-07h-required-kinds-aggregate');
  assert.equal(spec.deliveryMode, 'markdown-file-deliverable');
  assert.equal(spec.expectedArtifactRel, 'docs/r3-iteration/r3-07h-required-kinds-aggregate.md');
  assert.match(spec.promptTitle, /R3-07H-required-kinds-AGGREGATE/);
  assert.deepEqual(spec.requiredArtifactSnippets, [
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
  ]);
  assert.ok(spec.forbiddenArtifactSnippets.includes('uav-warranty-reminder'));
});
