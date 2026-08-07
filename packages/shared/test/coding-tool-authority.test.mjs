import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CanonicalTaskContractService,
  CanonicalToolAuthorityService,
} from '../dist/index.js';

function contract(mode = 'change') {
  return new CanonicalTaskContractService().build({
    goal: `${mode} src/value.ts safely`,
    mode,
    include: ['src/value.ts'],
    deliverables: [{
      id: mode === 'change' || mode === 'release' ? 'change' : 'report',
      kind: mode === 'change' || mode === 'release' ? 'source-change' : 'report',
      ...(mode === 'change' || mode === 'release' ? { path: 'src/value.ts' } : {}),
    }],
    acceptance: [{ id: 'settled', statement: 'The requested task is settled.' }],
    provenanceRefs: ['test:user-prompt'],
  });
}

function session(mode = 'change') {
  return new CanonicalToolAuthorityService().bind({
    runId: `run-${mode}`,
    surface: 'headless',
    workspaceRoot: '/workspace',
    taskContract: contract(mode),
  });
}

test('authority derives mutation and verification permission from the immutable task contract', () => {
  const change = session('change');
  const mutation = change.authorize({
    actionId: 'write-1',
    tool: 'write_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    input: { path: 'src/value.ts', content: 'export const value = 1;' },
    risk: 'medium',
    targetPaths: ['src/value.ts'],
  });
  const verification = change.authorize({
    actionId: 'verify-1',
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process'],
    input: { command: 'npm test' },
    risk: 'medium',
  });

  assert.equal(mutation.receipt.status, 'authorized');
  assert.equal(mutation.receipt.decision, 'allow');
  assert.equal(verification.receipt.status, 'authorized');
  assert.equal(change.sandbox.workspaceAccess, 'read-write');
  assert.equal(change.sandbox.processAccess, 'allowed');
  assert.equal(Object.isFrozen(mutation), true);
  assert.equal(mutation.receipt.evidenceRefs.some(ref => ref.startsWith('sandbox-policy:')), true);
});

test('sandboxed verification may write local build output without redundant confirmation', () => {
  const change = session('change');
  const request = {
    tool: 'run_terminal',
    purpose: 'verify',
    effects: ['process', 'workspace-mutation'],
    input: { command: 'npm run build' },
    risk: 'medium',
  };
  const unconfirmed = change.authorize({
    ...request,
    actionId: 'compile-unconfirmed',
  });
  const confirmed = change.authorize({
    ...request,
    actionId: 'compile-confirmed',
    surfaceConstraint: {
      decision: 'require-confirmation',
      reason: 'user-confirmed-build-output',
      confirmationRef: 'terminal-confirmation',
      evidenceRefs: ['surface:confirmed'],
    },
  });

  assert.equal(unconfirmed.receipt.status, 'authorized');
  assert.equal(unconfirmed.receipt.decision, 'allow');
  assert.equal(unconfirmed.permission.reason, 'task-contract-change-allows-verify');
  assert.equal(confirmed.receipt.status, 'authorized');
  assert.equal(confirmed.receipt.confirmationRef, 'terminal-confirmation');
});

test('read-only task contracts deny mutation even when a Surface tries to allow it', () => {
  const review = session('review');
  const authorization = review.authorize({
    actionId: 'write-denied',
    tool: 'write_file',
    purpose: 'workspace-mutation',
    effects: ['workspace-mutation'],
    input: { path: 'src/value.ts', content: 'export const value = 2;' },
    surfaceConstraint: {
      decision: 'allow',
      reason: 'surface-would-allow',
      evidenceRefs: ['surface:allow'],
    },
  });

  assert.equal(authorization.receipt.status, 'denied');
  assert.equal(authorization.receipt.decision, 'deny');
  assert.equal(authorization.permission.reason, 'sandbox-denies-workspace-mutation');
  assert.equal(review.sandbox.workspaceAccess, 'read-only');
});

test('high-risk effects require a settled confirmation and Surface policy can narrow authority', () => {
  const release = session('release');
  const unconfirmed = release.authorize({
    actionId: 'publish-unconfirmed',
    tool: 'publish',
    purpose: 'external-effect',
    effects: ['release'],
    input: { package: '@devseek/test', tag: 'latest' },
    risk: 'high',
  });
  const confirmed = release.authorize({
    actionId: 'publish-confirmed',
    tool: 'publish',
    purpose: 'external-effect',
    effects: ['release'],
    input: { package: '@devseek/test', tag: 'latest' },
    risk: 'high',
    surfaceConstraint: {
      decision: 'require-confirmation',
      reason: 'user-confirmed-release',
      confirmationRef: 'ui-confirmation-42',
      evidenceRefs: ['surface:user-confirmed'],
    },
  });
  const narrowed = release.authorize({
    actionId: 'publish-denied-by-surface',
    tool: 'publish',
    purpose: 'external-effect',
    effects: ['release'],
    input: { package: '@devseek/test', tag: 'latest' },
    surfaceConstraint: {
      decision: 'deny',
      reason: 'platform-adapter-denied',
      evidenceRefs: ['surface:denied'],
    },
  });

  assert.equal(unconfirmed.receipt.decision, 'require-confirmation');
  assert.equal(unconfirmed.receipt.status, 'denied');
  assert.equal(confirmed.receipt.status, 'authorized');
  assert.equal(confirmed.receipt.confirmationRef, 'ui-confirmation-42');
  assert.equal(narrowed.receipt.status, 'denied');
  assert.match(narrowed.receipt.reason, /^surface-denies:/u);
});

test('every external mutation requires confirmation and read-only task modes still deny it', () => {
  const change = session('change');
  const unconfirmed = change.authorize({
    actionId: 'network-mutation-unconfirmed',
    tool: 'mcp__issues__comment',
    purpose: 'external-effect',
    effects: ['network'],
    input: { issue: 42, body: 'Implemented and verified.' },
    risk: 'low',
  });
  const review = session('review');
  const reviewAttempt = review.authorize({
    actionId: 'network-mutation-review',
    tool: 'mcp__issues__comment',
    purpose: 'external-effect',
    effects: ['network'],
    input: { issue: 42, body: 'Implemented and verified.' },
    surfaceConstraint: {
      decision: 'require-confirmation',
      reason: 'user-confirmed-comment',
      confirmationRef: 'confirmation-review-comment',
      evidenceRefs: ['surface:confirmed'],
    },
  });

  assert.equal(unconfirmed.receipt.decision, 'require-confirmation');
  assert.equal(unconfirmed.receipt.status, 'denied');
  assert.equal(unconfirmed.permission.reason, 'external-effect-requires-confirmation');
  assert.equal(reviewAttempt.receipt.status, 'denied');
  assert.equal(reviewAttempt.permission.reason, 'task-contract-review-denies-external-effect');
});

test('authority replays one settled identity and rejects action drift', () => {
  const authority = session('change');
  const request = {
    actionId: 'read-1',
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    input: { path: 'src/value.ts' },
  };
  const first = authority.authorize(request);
  const replay = authority.authorize(request);

  assert.equal(first, replay);
  assert.equal(authority.authorizations().length, 1);
  assert.equal(first.receipt.inputSha256.length, 64);
  assert.throws(
    () => authority.authorize({ ...request, tool: 'grep_search' }),
    /conflicting-action-identity/u,
  );
  assert.throws(
    () => authority.authorize({ ...request, input: { path: 'src/other.ts' } }),
    /conflicting-action-identity/u,
  );
});

test('authority rejects Surface attempts to issue status or attach approval to allow', () => {
  const authority = session('change');
  const baseRequest = {
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    input: { path: 'src/value.ts' },
  };

  assert.throws(
    () => authority.authorize({
      ...baseRequest,
      actionId: 'surface-issued-status',
      surfaceConstraint: {
        decision: 'allow',
        status: 'authorized',
        reason: 'surface-issued-final-status',
        evidenceRefs: [],
      },
    }),
    /surface-cannot-issue-authority/u,
  );
  assert.throws(
    () => authority.authorize({
      ...baseRequest,
      actionId: 'allow-with-confirmation',
      surfaceConstraint: {
        decision: 'allow',
        confirmationRef: 'invalid-approval',
        reason: 'allow-cannot-carry-approval',
        evidenceRefs: [],
      },
    }),
    /unexpected-surface-confirmation/u,
  );
});

test('authority session rejects a structurally valid receipt issued by another session', () => {
  const request = {
    actionId: 'session-bound-read',
    tool: 'read_file',
    purpose: 'observe',
    effects: ['read'],
    input: { path: 'src/value.ts' },
  };
  const current = session('change');
  const foreign = session('change').authorize(request).receipt;
  const scope = {
    runId: foreign.runId,
    actionId: request.actionId,
    tool: request.tool,
    purpose: request.purpose,
    effects: request.effects,
    input: request.input,
  };

  assert.throws(
    () => current.verifyReceipt(foreign, scope),
    /receipt-not-issued-by-session/u,
  );
  const issued = current.authorize(request).receipt;
  assert.equal(current.verifyReceipt(issued, scope), issued);
});
