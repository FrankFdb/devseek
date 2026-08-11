import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CanonicalSecretRedactionService,
  CODING_SECRET_REDACTION_VERSION,
  isCodingSecretFieldName,
} from '../dist/index.js';

const AUTHORITY_CAPABILITY = `devseek-ra1_${'A'.repeat(43)}`;

test('I21-SEC-01 user journey: canonical redaction removes credential classes idempotently', () => {
  const service = new CanonicalSecretRedactionService();
  const privateKey = '-----BEGIN PRIVATE KEY-----\nraw-private-material\n-----END PRIVATE KEY-----';
  const source = [
    AUTHORITY_CAPABILITY,
    privateKey,
    `ghp_${'a'.repeat(24)}`,
    'xoxb-1234567890-secret',
    'AKIA1234567890ABCDEF',
    'sk-provider-token-123456',
    'authorization: Bearer bearer-secret-1234',
    'cookie=browser-session-secret',
  ].join('\n');

  const receipt = service.redactText(source);
  assert.equal(receipt.version, CODING_SECRET_REDACTION_VERSION);
  assert.equal(receipt.redacted, true);
  assert.equal(receipt.redactionCount, 8);
  assert.deepEqual(new Set(receipt.matches), new Set([
    'devseek-authority-capability',
    'private-key',
    'github-token',
    'slack-token',
    'aws-access-key',
    'provider-token',
    'authorization-header',
    'secret-assignment',
  ]));
  for (const forbidden of [
    AUTHORITY_CAPABILITY,
    'raw-private-material',
    'bearer-secret-1234',
    'browser-session-secret',
  ]) {
    assert.equal(receipt.text.includes(forbidden), false, forbidden);
  }

  const replay = service.redactText(receipt.text);
  assert.equal(replay.text, receipt.text);
  assert.equal(replay.redactionCount, 0);
});

test('canonical secret redaction recursively protects sensitive fields and object keys', () => {
  const service = new CanonicalSecretRedactionService();
  const source = {
    request_headers: { authorization: 'short' },
    nested: [{ session_token: 'tiny' }, 'token=plain-secret'],
    [`trace-${AUTHORITY_CAPABILITY}`]: 'safe',
  };

  const receipt = service.redactValue(source, { replacement: '[MASKED]' });
  assert.equal(receipt.redacted, true);
  assert.equal(receipt.value.request_headers, '[MASKED]');
  assert.equal(receipt.value.nested[0].session_token, '[MASKED]');
  assert.equal(receipt.value.nested[1].includes('plain-secret'), false);
  assert.equal(Object.keys(receipt.value)[2].includes(AUTHORITY_CAPABILITY), false);
  assert.equal(service.contains({ value: 'ordinary text' }), false);
  assert.equal(isCodingSecretFieldName('request_headers'), true);
  assert.equal(isCodingSecretFieldName('completion_status'), false);
});
