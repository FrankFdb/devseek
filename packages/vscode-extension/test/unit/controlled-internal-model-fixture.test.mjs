import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindControlledInternalModelPrompt,
  controlledInternalModelResponse,
} from '../harness/controlled-internal-model-fixture.mjs';

const phase1Marker = 'You are DevSeek memory Phase 1. Extract durable coding-agent memory from one immutable rollout.';
const phase2Marker = 'You are DevSeek memory Phase 2. Consolidate bounded Phase 1 evidence into durable coding memory proposals.';

test('internal model fixture binds only the complete Phase 1 protocol', () => {
  const binding = bindControlledInternalModelPrompt([
    `[指令]\n${phase1Marker}`,
    'For no durable signal return exactly {"rollout_summary":"","raw_memory":"","candidates":[]}.',
    'Schema includes "evidence_refs":["..."] for every candidate.',
    '',
    '{"repositoryId":"repo-test","evidenceCatalog":[]}',
  ].join('\n'));

  assert.equal(binding?.requestKind, 'memory-phase-1');
  assert.equal(binding?.promptContract.bound, true);
  assert.equal(controlledInternalModelResponse(binding.requestKind), '{"rollout_summary":"","raw_memory":"","candidates":[]}');
});

test('internal model fixture binds only the complete Phase 2 protocol', () => {
  const binding = bindControlledInternalModelPrompt([
    `[指令]\n${phase2Marker}`,
    'The always-loaded summary is generated locally from accepted records; never propose or emit summary text.',
    'When there is no useful change, return {"proposals":[]}.',
    '',
    '{"current_memory":[],"stage1_outputs":[]}',
  ].join('\n'));

  assert.equal(binding?.requestKind, 'memory-phase-2');
  assert.equal(binding?.promptContract.bound, true);
  assert.equal(controlledInternalModelResponse(binding.requestKind), '{"proposals":[]}');
});

test('internal model fixture rejects incomplete protocol and ignores ordinary user text', () => {
  const incomplete = bindControlledInternalModelPrompt([
    `[指令]\n${phase1Marker}`,
    '',
    '{"repositoryId":"repo-test"}',
  ].join('\n'));
  assert.equal(incomplete?.promptContract.bound, false);

  assert.equal(bindControlledInternalModelPrompt(
    '请检查 DevSeek memory Phase 1 的设计，不要执行内部记忆提取。',
  ), undefined);
  assert.throws(
    () => controlledInternalModelResponse('ordinary-user-request'),
    /Unknown controlled internal model request kind/,
  );
});
