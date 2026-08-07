import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';
import {
  CanonicalChangePlanService,
  CanonicalContextGraphService,
  CanonicalDesignDecisionService,
  CanonicalRequirementDecisionService,
  buildCodingKernelTaskContract,
  evaluateCodingChangePlanEffect,
} from '../dist/index.js';

test('I15-DSN-01 produces an immutable impact, rollback, acceptance, and effect plan', () => {
  const scenario = loadUserSimulationCase('I15', 'I15-DSN-01');
  const fixture = readyFixture(scenario.input);
  const design = new CanonicalDesignDecisionService().decide({
    ...fixture,
    evidence: {
      dependencyChecks: [{
        from: scenario.input.dependency_from,
        to: scenario.input.dependency_to,
        status: 'allowed',
        evidenceRef: scenario.input.dependency_evidence_ref,
      }],
      evidenceRefs: [scenario.input.dependency_evidence_ref],
    },
  });
  const plan = new CanonicalChangePlanService().create({ ...fixture, design });

  assert.equal(design.status, 'ready');
  assert.equal(design.selectedAlternativeId, 'semantic-owner-change');
  assert.equal(design.alternatives.find(item => item.id === 'surface-local-patch').selected, false);
  assert.equal(design.impactSet.primary.impacts[0].target, scenario.input.target_path);
  assert.equal(design.rollback.status, 'planned');
  assert.deepEqual(design.acceptanceMapping[0].impactIds, ['primary:1']);
  assert.equal(plan.status, 'ready');
  assert.deepEqual(plan.steps.map(step => step.action), ['modify', 'verify']);
  assert.deepEqual(plan.authorizedTargets, [scenario.input.target_path]);
  assert.equal(Object.isFrozen(plan.steps), true);
  assert.throws(() => plan.steps.push({}), TypeError);

  assert.equal(evaluateCodingChangePlanEffect(plan, {
    effects: ['read'],
    targetPaths: [],
  }).decision, 'allow');
  assert.equal(evaluateCodingChangePlanEffect(plan, {
    effects: ['workspace-mutation'],
    targetPaths: [scenario.input.target_path],
  }).decision, 'allow');
  assert.match(evaluateCodingChangePlanEffect(plan, {
    effects: ['workspace-mutation'],
    targetPaths: [scenario.input.outside_target_path],
  }).reason, /target-outside-scope:src\/auth\.ts/u);
  assert.equal(evaluateCodingChangePlanEffect(plan, {
    effects: ['git'],
    targetPaths: [],
  }).reason, 'change-plan-effect-not-authorized:git');
});

test('dependency violations and unresolved targets block plans before workspace effects', () => {
  const fixture = readyFixture();
  const violatingDesign = new CanonicalDesignDecisionService().decide({
    ...fixture,
    evidence: { dependencyChecks: [{
      from: 'packages/shared',
      to: 'packages/vscode-extension',
      status: 'violation',
      evidenceRef: 'workspace-file:src/value.ts',
    }] },
  });
  const violatingPlan = new CanonicalChangePlanService().create({ ...fixture, design: violatingDesign });

  assert.equal(violatingDesign.status, 'clarification-required');
  assert.equal(violatingPlan.status, 'blocked');
  assert.equal(evaluateCodingChangePlanEffect(violatingPlan, {
    effects: ['workspace-mutation'],
    targetPaths: ['src/value.ts'],
  }).decision, 'deny');

  const targetless = fixtureFor(targetlessContract());
  const targetlessDesign = new CanonicalDesignDecisionService().decide(targetless);
  const targetlessPlan = new CanonicalChangePlanService().create({ ...targetless, design: targetlessDesign });
  assert.equal(targetlessDesign.status, 'exploration-required');
  assert.equal(targetlessPlan.status, 'blocked');
  assert.match(targetlessPlan.reasonCodes.join(','), /missing-change-target/u);
});

test('change plans authorize the union of deliverable targets and concrete contract scope', () => {
  const taskContract = buildCodingKernelTaskContract({
    goal: 'Update src/app.py and devseek.verify.json.',
    mode: 'change',
    include: ['src/app.py', 'devseek.verify.json', 'generated/**'],
    deliverables: [{ id: 'app', kind: 'source-change', path: 'src/app.py' }],
    acceptance: [{
      id: 'verified',
      statement: 'The app and verifier pass.',
      deliverableIds: ['app'],
      oracle: {
        kind: 'verification',
        verifier: 'focused-test-suite',
        scope: ['src/app.py', 'devseek.verify.json'],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
  const fixture = fixtureFor(taskContract);
  const design = new CanonicalDesignDecisionService().decide(fixture);
  const plan = new CanonicalChangePlanService().create({ ...fixture, design });

  assert.deepEqual(plan.authorizedTargets, ['src/app.py', 'devseek.verify.json']);
  assert.equal(evaluateCodingChangePlanEffect(plan, {
    effects: ['workspace-mutation'],
    targetPaths: ['devseek.verify.json'],
  }).decision, 'allow');
  assert.match(evaluateCodingChangePlanEffect(plan, {
    effects: ['workspace-mutation'],
    targetPaths: ['generated/output.js'],
  }).reason, /target-outside-scope/u);
});

test('design decisions reject a requirement from another context graph', () => {
  const fixture = readyFixture();
  const otherGraph = new CanonicalContextGraphService().build({
    workspaceRoot: '/other',
    userPrompt: fixture.taskContract.goal,
    taskContract: fixture.taskContract,
  });

  assert.throws(() => new CanonicalDesignDecisionService().decide({
    ...fixture,
    contextGraph: otherGraph,
  }), /coding-design-plan:requirement-context-graph-mismatch/u);
});

test('I15-REV-01 change-plan revisions require design-bound evidence and retain lineage', () => {
  const scenario = loadUserSimulationCase('I15', 'I15-REV-01');
  const fixture = readyFixture();
  const design = new CanonicalDesignDecisionService().decide({
    ...fixture,
    evidence: { evidenceRefs: [scenario.input.plan_evidence_ref] },
  });
  const service = new CanonicalChangePlanService();
  const initial = service.create({ ...fixture, design });
  const revised = service.revise({
    ...fixture,
    design,
    previousPlan: initial,
    revisionReason: scenario.input.plan_revision_reason,
    newEvidenceRefs: [scenario.input.plan_evidence_ref],
  });

  assert.equal(revised.parentPlanId, initial.planId);
  assert.equal(revised.revisionReason, scenario.input.plan_revision_reason);
  assert.strictEqual(service.revise({
    ...fixture,
    design,
    previousPlan: revised,
    revisionReason: 'No semantic change.',
    newEvidenceRefs: [scenario.input.plan_evidence_ref],
  }), revised);
  assert.throws(() => service.revise({
    ...fixture,
    design,
    previousPlan: initial,
    revisionReason: 'Use invented evidence.',
    newEvidenceRefs: ['workspace-file:not-observed.ts'],
  }), /coding-design-plan:unbound-plan-revision-evidence/u);
});

function readyFixture(input = {}) {
  return fixtureFor(changeContract(input));
}

function fixtureFor(taskContract) {
  const contextGraph = new CanonicalContextGraphService().build({
    workspaceRoot: '/repo',
    userPrompt: taskContract.goal,
    taskContract,
    seed: { files: [{ path: '/repo/src/value.ts', contentSample: 'export const value = 1;' }] },
  });
  const requirements = new CanonicalRequirementDecisionService().decide({ taskContract, contextGraph });
  return { taskContract, contextGraph, requirements };
}

function changeContract(input = {}) {
  const targetPath = input.target_path ?? 'src/value.ts';
  return buildCodingKernelTaskContract({
    goal: input.prompt ?? 'Change src/value.ts and verify the result.',
    mode: 'change',
    include: [targetPath],
    deliverables: [{ id: 'source', kind: 'source-change', path: targetPath }],
    acceptance: [{
      id: 'verified',
      statement: 'Focused verification passes.',
      deliverableIds: ['source'],
      oracle: {
        kind: 'verification',
        verifier: 'focused-test-suite',
        scope: [targetPath],
        evidenceKinds: ['verification-receipt'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
}

function targetlessContract() {
  return buildCodingKernelTaskContract({
    goal: 'Change the implementation and verify it.',
    mode: 'change',
    include: ['src/**'],
    deliverables: [{ id: 'source', kind: 'source-change' }],
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
}
