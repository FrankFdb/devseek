import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CanonicalProviderCapabilityService,
  CODING_PROVIDER_ADVERTISEMENT_VERSION,
  knownCodingProviderAdvertisement,
} from '../dist/index.js';

test('ProviderCapabilityPort accepts either native or text tool protocols for code changes', () => {
  const service = new CanonicalProviderCapabilityService();
  const bridge = service.bind(knownCodingProviderAdvertisement('bridge'));
  const api = service.bind(knownCodingProviderAdvertisement('deepseek-api'));

  assert.equal(bridge.negotiate({ requestKind: 'code-change' }).decision, 'allow');
  assert.equal(api.negotiate({ requestKind: 'code-change' }).decision, 'allow');
});

test('I21-PRV-01 user journey: provider capability negotiation blocks missing and unknown requirements', () => {
  const service = new CanonicalProviderCapabilityService();
  const vscodeLm = service.bind(knownCodingProviderAdvertisement('vscode-lm'));

  const missingToolProtocol = vscodeLm.negotiate({ requestKind: 'release' });
  assert.equal(missingToolProtocol.decision, 'blocked');
  assert.equal(missingToolProtocol.reason, 'missing-capability');
  assert.deepEqual(missingToolProtocol.missingCapabilities, ['native-tools|text-tools']);

  const unknown = vscodeLm.negotiate({
    requestKind: 'chat',
    requiredCapabilities: ['workspace-admin'],
  });
  assert.equal(unknown.decision, 'blocked');
  assert.equal(unknown.reason, 'unknown-capability');
  assert.deepEqual(unknown.missingCapabilities, ['workspace-admin']);
});

test('ProviderCapabilityPort binds observed advertisements and keeps an immutable decision ledger', () => {
  const service = new CanonicalProviderCapabilityService();
  const capabilities = ['text', 'text-tools', 'cancellation', 'request-correlation'];
  const session = service.bind({
    version: CODING_PROVIDER_ADVERTISEMENT_VERSION,
    provider: 'bridge',
    capabilities,
    evidenceRefs: ['bridge-status:request-42'],
  });
  capabilities.pop();

  const decision = session.negotiate({
    requestKind: 'code-change',
    cancellationRequired: true,
    correlationRequired: true,
  });
  assert.equal(decision.decision, 'allow');
  assert.deepEqual(session.advertisement.capabilities, [
    'text',
    'text-tools',
    'cancellation',
    'request-correlation',
  ]);
  assert.deepEqual(session.decisions(), [decision]);
  assert.throws(() => session.decisions().push(decision), TypeError);
});
