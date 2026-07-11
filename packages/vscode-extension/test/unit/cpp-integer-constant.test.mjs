import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/cpp-integer-constant.bundle.cjs');
execSync(
  `npx esbuild src/agent/cpp-integer-constant.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);
const { evaluateCppIntegerConstant } = createRequire(import.meta.url)(bundlePath);

function expectValue(expression, canonicalValue, expected = {}) {
  const result = evaluateCppIntegerConstant(expression);
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.error));
  assert.equal(result.value, BigInt(canonicalValue));
  assert.equal(result.canonicalValue, canonicalValue);
  if (expected.bitWidth !== undefined) {
    assert.equal(result.bitWidth, expected.bitWidth);
  }
  if (expected.signed !== undefined) {
    assert.equal(result.signed, expected.signed);
  }
  if (expected.typeName !== undefined) {
    assert.equal(result.typeName, expected.typeName);
  }
  return result;
}

function expectFailure(expression, code) {
  const result = evaluateCppIntegerConstant(expression);
  assert.equal(result.ok, false, `${expression} unexpectedly evaluated to ${result.canonicalValue}`);
  assert.equal(result.error.code, code);
  assert.equal(Number.isInteger(result.error.offset), true);
}

test('evaluates source-style arithmetic without Number precision loss', () => {
  expectValue('64 * 1024', '65536', {
    bitWidth: 32,
    signed: true,
    typeName: 'int',
  });
  expectValue('1ULL << 40', '1099511627776', {
    bitWidth: 64,
    signed: false,
    typeName: 'unsigned long long',
  });
  expectValue('9007199254740993ULL', '9007199254740993', {
    bitWidth: 64,
    signed: false,
  });
  expectValue("9'007'199'254'740'993ULL", '9007199254740993');
});

test('models unsigned complement and shifts at their explicit suffix width', () => {
  expectValue('~0U', '4294967295', { bitWidth: 32, signed: false });
  expectValue('(~0U) >> 1', '2147483647', { bitWidth: 32, signed: false });
  expectValue('1U << 31', '2147483648', { bitWidth: 32, signed: false });
  expectValue('~0ULL', '18446744073709551615', { bitWidth: 64, signed: false });
  expectValue('(~0ULL) >> 63', '1', { bitWidth: 64, signed: false });
});

test('implements precedence, signed division, remainder, and bitwise operators', () => {
  expectValue('((20 + 4) * 3 - 8) / 2 % 17', '15');
  expectValue('-7 / 3', '-2');
  expectValue('-7 % 3', '-1');
  expectValue('((0xF0U | 0x0FU) ^ 0x33U) & 0xFFU', '204', {
    bitWidth: 32,
    signed: false,
  });
  expectValue('1 << 3 + 2', '32');
  expectValue('~0', '-1', { bitWidth: 32, signed: true });
});

test('applies usual integer conversions and defined unsigned wraparound', () => {
  expectValue('0U - 1U', '4294967295', { bitWidth: 32, signed: false });
  expectValue('-1 + 1U', '0', { bitWidth: 32, signed: false });
  expectValue('4294967295U + 2U', '1', { bitWidth: 32, signed: false });
  expectValue('4294967295U + 1LL', '4294967296', { bitWidth: 64, signed: true });
});

test('rejects identifiers, calls, floating point, and unsupported operators', () => {
  expectFailure('WIDTH * 2', 'invalid-token');
  expectFailure('value()', 'invalid-token');
  expectFailure('1.5 * 2', 'invalid-token');
  expectFailure('1e3', 'unsupported-literal');
  expectFailure('1 && 1', 'invalid-token');
  expectFailure('1 == 1', 'invalid-token');
  expectFailure('1++2', 'invalid-token');
});

test('fails closed for division errors, invalid shifts, and signed overflow', () => {
  expectFailure('1 / 0', 'division-by-zero');
  expectFailure('1 % 0', 'division-by-zero');
  expectFailure('2147483647 + 1', 'integer-overflow');
  expectFailure('1 << 31', 'integer-overflow');
  expectFailure('1U << 32', 'invalid-shift');
  expectFailure('1ULL << 64', 'invalid-shift');
  expectFailure('1 << -1', 'invalid-shift');
  expectFailure('(-1) >> 1', 'invalid-shift');
});

test('fails closed when the literal width depends on the C++ target', () => {
  expectFailure('1L', 'indeterminate-width');
  expectFailure('1UL', 'indeterminate-width');
  expectFailure('2147483648', 'indeterminate-width');
  expectFailure('4294967296U', 'indeterminate-width');
  expectFailure('0x100000000', 'indeterminate-width');
  expectFailure('18446744073709551616ULL', 'integer-overflow');
});

test('rejects malformed and excessively nested expressions', () => {
  expectFailure('', 'empty-expression');
  expectFailure('(1 + 2', 'invalid-syntax');
  expectFailure('1 +', 'invalid-syntax');
  expectFailure('09', 'unsupported-literal');
  expectFailure(`${'('.repeat(65)}1${')'.repeat(65)}`, 'expression-too-large');
});
