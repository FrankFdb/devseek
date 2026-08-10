import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildCodingKernelTaskContract } from '../../shared/dist/index.js';
import { HeadlessCodingKernelExecutor } from '../dist/index.js';
import { loadUserSimulationCase } from '../../../scripts/lib/devseek-user-simulation-fixture.mjs';
import { completedRuntimeResult } from './headless-runtime-fixtures.mjs';

test('I13-PRV-01 user journey: provider event snapshot survives later provider-buffer mutation', async () => {
  const scenario = loadUserSimulationCase('I13', 'I13-PRV-01');
  const output = await runReviewJourney(scenario, request => {
    const rawCall = structuredClone(scenario.input.tool_call);
    const event = request.providerEvents.accept({
      type: 'tool-call',
      provider: scenario.input.provider,
      workflowId: request.runId,
      call: rawCall,
    });
    rawCall.input.path = scenario.input.post_accept_path;
    assert.equal(event.type, 'tool-call');
    assert.equal(event.call.input.path, scenario.input.tool_call.input.path);
    const envelope = request.toolDispatch.dispatch(event.call, {
      source: 'native',
      workspaceRoot: request.workspaceRoot,
    });
    assert.equal(envelope.decision, 'accepted');
    return { acceptedPath: envelope.call.input.path, provider: event.provider };
  });

  assert.deepEqual(output.result, { acceptedPath: 'src/index.ts', provider: 'deepseek' });
});

test('I13-SCH-01 user journey: provider alias resolves through one shared schema registry', async () => {
  const scenario = loadUserSimulationCase('I13', 'I13-SCH-01');
  const output = await runReviewJourney(scenario, request => {
    const canonicalName = request.toolSchemas.canonicalName(scenario.input.tool_name);
    const descriptor = request.toolSchemas.resolve(canonicalName);
    const input = request.toolSchemas.normalizeInput(canonicalName, scenario.input.arguments);
    assert.equal(descriptor.name, 'grep_search');
    assert.equal(descriptor.kind, 'search');
    assert.equal(request.toolSchemas.listNames().includes('apply_workspace_artifacts'), false);
    return {
      canonicalName,
      pattern: input.pattern,
      path: input.path,
      includePattern: input.includePattern,
    };
  });

  assert.deepEqual(output.result, {
    canonicalName: 'grep_search',
    pattern: 'glutMouseFunc|mouse',
    path: 'code/shape_manager',
    includePattern: '.cpp,.h',
  });
});

test('I13-DSP-01 user journey: fake and native calls converge while incomplete input stops before host', async () => {
  const scenario = loadUserSimulationCase('I13', 'I13-DSP-01');
  let hostCalls = 0;
  const output = await runReviewJourney(scenario, request => {
    const fake = request.toolDispatch.dispatch(scenario.input.fake_call, {
      source: 'fake-tool',
      workspaceRoot: request.workspaceRoot,
    });
    const native = request.toolDispatch.dispatch(scenario.input.native_call, {
      source: 'native',
      workspaceRoot: request.workspaceRoot,
    });
    const invalid = request.toolDispatch.dispatch(scenario.input.invalid_call, {
      source: 'surface',
      workspaceRoot: request.workspaceRoot,
    });
    for (const envelope of [invalid]) {
      if (envelope.decision === 'accepted') hostCalls += 1;
    }
    assert.equal(fake.decision, 'accepted');
    assert.equal(native.decision, 'accepted');
    assert.deepEqual(canonicalFacts(fake.call), canonicalFacts(native.call));
    assert.equal(invalid.reason, 'invalid-tool-input');
    assert.deepEqual(invalid.call.missingFields, ['path']);
    return { hostCalls, rejection: invalid.reason };
  });

  assert.deepEqual(output.result, { hostCalls: 0, rejection: 'invalid-tool-input' });
});

function canonicalFacts(call) {
  return {
    name: call.name,
    input: call.input,
    kind: call.kind,
    risk: call.risk,
    purpose: call.purpose,
    effects: call.effects,
    executable: call.executable,
  };
}

async function runReviewJourney(scenario, execute) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'devseek-i13-provider-dispatch-'));
  const taskContract = buildCodingKernelTaskContract({
    goal: scenario.input.prompt,
    mode: 'review',
    deliverables: [{ id: 'report', kind: 'report' }],
    acceptance: [{
      id: 'reported',
      statement: 'The requested protocol behavior is reported.',
      deliverableIds: ['report'],
      oracle: {
        kind: 'response-evidence',
        verifier: 'headless-provider-adapter',
        scope: ['response'],
        evidenceKinds: ['response-evidence'],
      },
      externalBoundaryRefs: [],
    }],
    provenanceRefs: ['user:current'],
  });
  try {
    const executor = new HeadlessCodingKernelExecutor({
      async executeCanonical(request) {
        return completedReview(request, execute(request));
      },
    });
    return await executor.execute({
      runId: scenario.case_id.toLowerCase(),
      userPrompt: scenario.input.prompt,
      workspaceRoot,
      taskContract,
      runtimeContext: { journey: scenario.case_id },
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function completedReview(request, value) {
  return completedRuntimeResult(request, value, { evidencePrefix: 'i13-review' });
}
