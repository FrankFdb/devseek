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
