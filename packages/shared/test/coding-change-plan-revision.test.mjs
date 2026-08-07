import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';
import {
  CanonicalChangePlanRevisionService,
  CanonicalChangePlanService,
  CanonicalContextGraphService,
  CanonicalDesignDecisionService,
  CanonicalRequirementDecisionService,
  buildCodingKernelTaskContract,
  evaluateCodingChangePlanEffect,
  projectCodingWorkspaceTargets,
} from '../dist/index.js';

test('I16-RPL-01 tool-proposed targets revise a targetless plan before workspace authority', () => {
  const scenario = loadUserSimulationCase('I16', 'I16-RPL-01');
  const fixture = buildFixture({ include: [] });
  const session = bindRevision(fixture, scenario.input.workspace_root);
  const initialPlan = session.currentPlan();

  const decision = session.ensureTargets({
    actionId: scenario.input.action_id,
    targetPaths: scenario.input.target_paths,
  });

  assert.equal(decision.status, 'revised');
  assert.equal(session.currentDesign().status, 'ready');
  assert.equal(session.currentPlan().status, 'ready');
  assert.equal(session.currentPlan().parentPlanId, initialPlan.planId);
  assert.deepEqual(session.currentPlan().authorizedTargets, [
    'src/feature.ts',
    'test/feature.test.ts',
  ]);
  assert.equal(session.designHistory().length, 2);
  assert.equal(session.planHistory().length, 2);
  assert.equal(evaluateCodingChangePlanEffect(session.currentPlan(), {
    effects: ['workspace-mutation'],
    targetPaths: ['src/feature.ts', 'test/feature.test.ts'],
  }).decision, 'allow');
});

test('I16-SCP-01 strict user scope cannot be widened by a tool proposal', () => {
  const scenario = loadUserSimulationCase('I16', 'I16-SCP-01');
  const fixture = buildFixture({
    include: [scenario.input.allowed_path],
    constraints: ['workspace-root-only', 'no-other-files'],
    deliverablePath: scenario.input.allowed_path,
  });
  const session = bindRevision(fixture, scenario.input.workspace_root);

  const decision = session.ensureTargets({
    actionId: scenario.input.action_id,
    targetPaths: [scenario.input.proposed_path],
  });

  assert.equal(decision.status, 'denied');
  assert.equal(decision.reason, `change-plan-target-outside-scope:${scenario.input.proposed_path}`);
  assert.equal(session.planHistory().length, 1);
});

test('I16-BND-01 workspace escape is rejected before plan scope evaluation', () => {
  const scenario = loadUserSimulationCase('I16', 'I16-BND-01');
  const session = bindRevision(buildFixture({ include: [] }), scenario.input.workspace_root);
  const decision = session.ensureTargets({
    actionId: scenario.input.action_id,
    targetPaths: [scenario.input.proposed_path],
  });

  assert.equal(decision.status, 'denied');
  assert.equal(decision.reason, `workspace-path-outside-root:${scenario.input.proposed_path}`);
  assert.equal(session.currentPlan().status, 'blocked');
});

test('workspace target projection rejects traversal through either path separator', () => {
  for (const target of ['../escape.ts', '..\\escape.ts', 'src\\..\\..\\escape.ts']) {
    const projection = projectCodingWorkspaceTargets([target], '/repo');

    assert.equal(projection.decision, 'denied');
    assert.equal(projection.reason, `workspace-path-outside-root:${target}`);
  }
});

test('I16-GLO-01 strict glob scope admits only matching concrete proposals', () => {
  const scenario = loadUserSimulationCase('I16', 'I16-GLO-01');
  const session = bindRevision(buildFixture({
    include: [scenario.input.allowed_scope],
    constraints: ['workspace-root-only', 'no-other-files'],
  }), scenario.input.workspace_root);

  assert.equal(session.ensureTargets({
    actionId: scenario.input.allowed_action_id,
    targetPaths: [scenario.input.allowed_path],
  }).status, 'revised');
  assert.equal(session.ensureTargets({
    actionId: scenario.input.outside_action_id,
    targetPaths: [scenario.input.outside_path],
  }).reason, `change-plan-target-outside-scope:${scenario.input.outside_path}`);
});

test('excluded glob scope rejects a matching proposal before plan revision', () => {
  const session = bindRevision(buildFixture({
    include: ['src/**'],
    exclude: ['src/generated/**'],
  }));

  const decision = session.ensureTargets({
    actionId: 'write-generated',
    targetPaths: ['src/generated/client.ts'],
  });

  assert.equal(decision.status, 'denied');
  assert.equal(decision.reason, 'change-plan-target-excluded:src/generated/client.ts');
  assert.equal(session.planHistory().length, 1);
});

test('one out-of-scope target denies an entire strict multi-file proposal', () => {
  const session = bindRevision(buildFixture({
    include: ['src/**'],
    constraints: ['workspace-root-only', 'no-other-files'],
  }));

  const decision = session.ensureTargets({
    actionId: 'write-batch',
    targetPaths: ['src/feature.ts', 'test/feature.test.ts'],
  });

  assert.equal(decision.status, 'denied');
  assert.equal(decision.reason, 'change-plan-target-outside-scope:test/feature.test.ts');
  assert.equal(session.currentPlan().authorizedTargets.includes('src/feature.ts'), false);
  assert.equal(session.planHistory().length, 1);
});

function bindRevision(fixture, workspaceRoot = '/repo') {
  const designs = new CanonicalDesignDecisionService();
  const plans = new CanonicalChangePlanService();
  const design = designs.decide(fixture);
  const plan = plans.create({ ...fixture, design });
  return new CanonicalChangePlanRevisionService(designs, plans).bind({
    workspaceRoot,
    ...fixture,
    design,
    plan,
  });
}

function buildFixture({
  include,
  exclude = [],
  constraints = ['workspace-root-only'],
  deliverablePath,
}) {
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Implement the requested feature and verify it.',
    mode: 'change',
    include,
    exclude,
    constraints,
    deliverables: [{
      id: 'source',
      kind: 'source-change',
      ...(deliverablePath ? { path: deliverablePath } : {}),
    }],
    acceptance: [{
      id: 'verified',
      statement: 'Focused verification passes.',
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier: 'focused-test-suite',
        scope: ['workspace'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
  const contextGraph = new CanonicalContextGraphService().build({
    workspaceRoot: '/repo',
    userPrompt: taskContract.goal,
    taskContract,
  });
  const requirements = new CanonicalRequirementDecisionService().decide({ taskContract, contextGraph });
  return { taskContract, contextGraph, requirements };
}
