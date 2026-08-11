import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CanonicalSurfaceAccessibilityService,
  CanonicalUserCollaborationService,
  CODING_CANCELLATION_RECEIPT_VERSION,
  CODING_STEERING_RECEIPT_VERSION,
} from '../dist/index.js';

test('I22-COL-01 user journey: collaboration requires a complete interactive control and review path', () => {
  const decision = new CanonicalUserCollaborationService().assess({
    surface: 'vscode',
    interactions: [
      'clarification',
      'progress',
      'plan-review',
      'diff-review',
      'permission-decision',
      'steering',
      'cancellation',
      'resume',
      'error-explanation',
    ],
    eventTypes: ['chat.started', 'provider.status', 'error'],
    traceBound: true,
    cancellationProtocol: CODING_CANCELLATION_RECEIPT_VERSION,
    steeringProtocol: CODING_STEERING_RECEIPT_VERSION,
    evidenceRefs: ['vscode-collaboration:test'],
  });

  assert.equal(decision.status, 'conformant');
  assert.deepEqual(decision.missingInteractions, []);
});

test('UserCollaborationPort fails closed on an attractive but non-interactive Surface declaration', () => {
  const decision = new CanonicalUserCollaborationService().assess({
    surface: 'vscode',
    interactions: ['progress'],
    eventTypes: [],
    traceBound: false,
    cancellationProtocol: CODING_CANCELLATION_RECEIPT_VERSION,
    evidenceRefs: [],
  });

  assert.equal(decision.status, 'non-conformant');
  assert.equal(decision.missingInteractions.includes('cancellation'), true);
  assert.equal(decision.reasonCodes.includes('same-trace-projection-missing'), true);
  assert.equal(decision.reasonCodes.includes('steering-protocol-missing'), false);
});

test('I22-ACC-01 user journey: accessibility requirements follow visual and programmatic surfaces', () => {
  const service = new CanonicalSurfaceAccessibilityService();
  const vscode = service.assess({
    surface: 'vscode',
    channels: ['keyboard', 'screen-reader', 'text-status'],
    statusNotColorOnly: true,
    cancellationReachable: true,
    recoveryReachable: true,
    evidenceRefs: ['vscode-a11y:test'],
  });
  const headless = service.assess({
    surface: 'headless',
    channels: ['programmatic'],
    statusNotColorOnly: true,
    cancellationReachable: true,
    recoveryReachable: true,
    evidenceRefs: ['headless-a11y:test'],
  });

  assert.equal(vscode.status, 'conformant');
  assert.equal(headless.status, 'conformant');
});
