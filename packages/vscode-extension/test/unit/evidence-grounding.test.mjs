import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const bundlePath = path.join(rootDir, 'test/unit/evidence-grounding.bundle.cjs');
execSync(`npx esbuild src/agent/evidence-grounding.ts --bundle --outfile=${bundlePath} --format=cjs --platform=node`, {
  cwd: rootDir,
  stdio: 'pipe',
});
const {
  EvidenceStore,
  SOURCE_EVIDENCE_GRAPH_PROTOCOL_VERSION,
  buildSourceEvidenceGraph,
  buildSourceEvidenceGraphFromClaims,
  deriveArtifactClaimSpecs,
  formatArtifactClaimSpecsForPrompt,
  formatClaimVerificationFeedback,
  validateSourceEvidenceGraph,
  verifyArtifactClaims,
} = createRequire(import.meta.url)(bundlePath);
const fixtureDir = path.join(rootDir, 'test/fixtures/runtime-replay/20260711-131537');

function loadReplay() {
  return {
    prompt: readFileSync(path.join(fixtureDir, 'request.txt'), 'utf8'),
    source: readFileSync(path.join(fixtureDir, 'license_types.hpp'), 'utf8'),
    wrong: readFileSync(path.join(fixtureDir, 'license-transport-facts.wrong.md'), 'utf8'),
    oracle: JSON.parse(readFileSync(path.join(fixtureDir, 'oracle.json'), 'utf8')),
  };
}

function requirements(prompt) {
  return [...new Set(prompt.match(/\bk[A-Z][A-Za-z0-9_]+\b/g) || [])].map(symbol => ({
    symbol,
    sourcePath: 'license_types.hpp',
  }));
}

test('20260711-131537 replay rejects five hallucinated facts with exact differences', () => {
  const replay = loadReplay();
  const store = new EvidenceStore('/replay', replay.oracle.runId);
  const sourceRef = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const artifactRef = store.recordFileRead({
    path: '/replay/license-transport-facts.md',
    content: replay.wrong,
    kind: 'artifact-readback',
  });
  const specs = deriveArtifactClaimSpecs(requirements(replay.prompt), [sourceRef]);
  const sourceReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const result = verifyArtifactClaims(specs, artifactRef, [sourceReadback]);

  assert.equal(specs.length, 6);
  assert.deepEqual(Object.fromEntries(specs.map(spec => [spec.symbol, spec.normalizedExpectedValue])), replay.oracle.claims);
  assert.equal(result.ok, false);
  assert.equal(result.differences.length, replay.oracle.wrongArtifactExpectedFailures);
  assert.equal(result.claims.find(claim => claim.symbol === 'kTunnelVersion')?.status, 'verified');
  assert.match(formatClaimVerificationFeedback(result), /kMavTunnelCmdLicense: 实际 300，期望 33007/);
  assert.match(formatClaimVerificationFeedback(result), /kTunnelMaxTotalLen: 实际 81920，期望 64 \* 1024/);
});

test('host-derived claim prompt facts preserve artifact spelling and JSON escaping', () => {
  const replay = loadReplay();
  const store = new EvidenceStore('/replay', 'prompt-facts');
  const sourceRef = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const specs = deriveArtifactClaimSpecs(requirements(replay.prompt), [sourceRef]);
  const facts = JSON.parse(formatArtifactClaimSpecsForPrompt(specs));

  assert.equal(facts.find(fact => fact.symbol === 'kTopicLicenseState').artifactValue, '/uav/license/state');
  assert.equal(facts.find(fact => fact.symbol === 'kTopicLicenseState').sourceInitializer, '"/uav/license/state"');
  assert.equal(facts.find(fact => fact.symbol === 'kTunnelMaxTotalLen').artifactValue, '64 * 1024');
  assert.equal(facts.find(fact => fact.symbol === 'kTunnelMaxTotalLen').normalizedValue, 65536);
  assert.equal(facts.every(fact => fact.evidenceId === sourceRef.evidenceId), true);
});

test('source evidence graph binds every fact to source location and repository snapshot', () => {
  const sourcePath = '/repo/config.hpp';
  const source = 'inline constexpr int kPort = 3721;\n';
  const store = new EvidenceStore('/repo', 'source-graph-basic');
  const sourceRef = store.recordFileRead({ path: sourcePath, content: source });
  const [spec] = deriveArtifactClaimSpecs([{ symbol: 'kPort', sourcePath }], [sourceRef]);

  const graph = buildSourceEvidenceGraphFromClaims({
    snapshot: {
      workspaceRoot: '/repo',
      branch: 'main',
      headCommit: 'abc123',
      worktreeStatusHash: 'clean',
    },
    claims: [spec],
  });

  assert.equal(graph.version, SOURCE_EVIDENCE_GRAPH_PROTOCOL_VERSION);
  assert.equal(graph.snapshot.branch, 'main');
  assert.equal(graph.snapshot.headCommit, 'abc123');
  assert.equal(graph.facts.length, 1);
  assert.equal(graph.facts[0].sourcePath, sourcePath);
  assert.equal(graph.facts[0].lineStart, 1);
  assert.equal(graph.facts[0].lineEnd, 1);
  assert.equal(graph.facts[0].contentHash, sourceRef.contentHash);
  assert.equal(graph.facts[0].snapshot.headCommit, 'abc123');
  assert.equal(graph.facts[0].evidenceId, sourceRef.evidenceId);

  const valid = validateSourceEvidenceGraph({
    graph,
    snapshot: graph.snapshot,
    readSource: () => source,
  });
  assert.equal(valid.ok, true, valid.reasons.join('\n'));
  assert.deepEqual(valid.staleFacts, []);
});

test('source evidence graph fails closed on stale source, wrong branch, wrong head, and stale symbol line', () => {
  const sourcePath = '/repo/config.hpp';
  const source = 'inline constexpr int kPort = 3721;\n';
  const store = new EvidenceStore('/repo', 'source-graph-drift');
  const sourceRef = store.recordFileRead({ path: sourcePath, content: source });
  const [spec] = deriveArtifactClaimSpecs([{ symbol: 'kPort', sourcePath }], [sourceRef]);
  const graph = buildSourceEvidenceGraphFromClaims({
    snapshot: {
      workspaceRoot: '/repo',
      branch: 'main',
      headCommit: 'abc123',
      worktreeStatusHash: 'clean',
    },
    claims: [spec],
  });

  const wrongBranch = validateSourceEvidenceGraph({
    graph,
    snapshot: { ...graph.snapshot, branch: 'feature' },
    readSource: () => source,
  });
  assert.equal(wrongBranch.ok, false);
  assert.ok(wrongBranch.reasons.includes('wrong-branch'));

  const wrongHead = validateSourceEvidenceGraph({
    graph,
    snapshot: { ...graph.snapshot, headCommit: 'def456' },
    readSource: () => source,
  });
  assert.equal(wrongHead.ok, false);
  assert.ok(wrongHead.reasons.includes('wrong-head'));

  const changedSource = validateSourceEvidenceGraph({
    graph,
    snapshot: graph.snapshot,
    readSource: () => 'inline constexpr int kPort = 9999;\n',
  });
  assert.equal(changedSource.ok, false);
  assert.ok(changedSource.reasons.includes('source-hash-drift'));
  assert.equal(changedSource.staleFacts[0].factId, graph.facts[0].factId);

  const staleLineGraph = buildSourceEvidenceGraph({
    snapshot: graph.snapshot,
    facts: [{
      factId: 'fact-stale-line',
      kind: 'design',
      label: 'kPort design fact',
      symbol: 'kPort',
      evidenceId: sourceRef.evidenceId,
      sourcePath,
      lineStart: 2,
      lineEnd: 2,
      contentHash: sourceRef.contentHash,
      captureSequence: sourceRef.captureSequence,
    }],
  });
  const staleLine = validateSourceEvidenceGraph({
    graph: staleLineGraph,
    snapshot: staleLineGraph.snapshot,
    readSource: () => source,
  });
  assert.equal(staleLine.ok, false);
  assert.ok(staleLine.reasons.includes('stale-symbol-location'));

  assert.throws(
    () => buildSourceEvidenceGraph({
      snapshot: { workspaceRoot: '/repo', branch: 'main', headCommit: 'abc123' },
      facts: [{
        kind: 'requirement',
        label: 'unbound fact',
        evidenceId: sourceRef.evidenceId,
        sourcePath,
        lineStart: 0,
        lineEnd: 0,
        contentHash: sourceRef.contentHash,
        captureSequence: sourceRef.captureSequence,
      }],
    }),
    /missing-source-location/,
  );
});

test('all six source claims pass after a grounded repair and evidence is immutable', () => {
  const replay = loadReplay();
  const repaired = replay.wrong
    .replace('/uav/dt/license/state', '/uav/license/state')
    .replace('/uav/dt/license/tunnel/rx', '/uav/license/tunnel/rx')
    .replace('`300`', '`33007`')
    .replace('`81920`', '`65536`')
    .replace('`30000`', '`5000`');
  const store = new EvidenceStore('/replay', replay.oracle.runId);
  const sourceRef = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const prematureReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const artifactRef = store.recordFileRead({ path: '/replay/license-transport-facts.md', content: repaired, kind: 'artifact-readback' });
  const specs = deriveArtifactClaimSpecs(requirements(replay.prompt), [sourceRef]);
  const prematureResult = verifyArtifactClaims(specs, artifactRef, [prematureReadback]);
  assert.equal(prematureResult.claims.every(claim => claim.status === 'missing-source-readback'), true);
  const sourceReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const result = verifyArtifactClaims(specs, artifactRef, [sourceReadback]);

  assert.equal(result.ok, true);
  assert.equal(result.claims.every(claim => claim.status === 'verified'), true);
  assert.equal(Object.isFrozen(sourceRef), true);
  assert.equal(sourceRef.contentHash?.length, 64);
  assert.throws(() => { sourceRef.content = 'tampered'; }, /read only|extensible|assign/i);
});

test('a requested source claim missing from the artifact blocks verification', () => {
  const replay = loadReplay();
  const store = new EvidenceStore('/replay', replay.oracle.runId);
  const sourceRef = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const artifactRef = store.recordFileRead({ path: '/replay/report.md', content: '# empty report\n', kind: 'artifact-readback' });
  const sourceReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const result = verifyArtifactClaims(deriveArtifactClaimSpecs(requirements(replay.prompt), [sourceRef]), artifactRef, [sourceReadback]);

  assert.equal(result.ok, false);
  assert.equal(result.claims.every(claim => claim.status === 'missing'), true);
});

test('unpaired Markdown and quote delimiters cannot normalize into verified claims', () => {
  const source = [
    'constexpr const char* kTopic = "/uav/state";',
    'constexpr int kTimeout = 5000;',
  ].join('\n');
  const store = new EvidenceStore('/replay', 'malformed-artifact-delimiters');
  const sourceRef = store.recordFileRead({ path: '/replay/source.hpp', content: source });
  const specs = deriveArtifactClaimSpecs([
    { symbol: 'kTopic', sourcePath: '/replay/source.hpp' },
    { symbol: 'kTimeout', sourcePath: '/replay/source.hpp' },
  ], [sourceRef]);

  for (const [index, content] of [
    '| Symbol | Value |\n| --- | --- |\n| kTopic | "/uav/state\' |\n| kTimeout | 5000 |\n',
    '| Symbol | Value |\n| --- | --- |\n| kTopic | `/uav/state |\n| kTimeout | `5000 |\n',
    '| Symbol | Value |\n| --- | --- |\n| kTopic | /uav/state。 |\n| kTimeout | 5000； |\n',
  ].entries()) {
    const artifact = store.recordFileRead({
      path: `/replay/malformed-${index}.md`,
      content,
      kind: 'artifact-readback',
    });
    const readback = store.recordFileRead({ path: '/replay/source.hpp', content: source });
    const result = verifyArtifactClaims(specs, artifact, [readback]);
    assert.equal(result.ok, false);
    assert.ok(result.claims.some(claim => claim.status === 'mismatch'));
  }
});

test('escaped or prefixed C++ string literals fail closed instead of verifying spelling as runtime value', () => {
  for (const [index, initializer] of ['"\\x2fuav/state"', 'u8"/uav/state"', '"a" "b"'].entries()) {
    const store = new EvidenceStore('/replay', `unsupported-source-string-${index}`);
    const sourceRef = store.recordFileRead({
      path: '/replay/source.hpp',
      content: `constexpr const char* kTopic = ${initializer};\n`,
    });
    assert.throws(
      () => deriveArtifactClaimSpecs([{ symbol: 'kTopic', sourcePath: '/replay/source.hpp' }], [sourceRef]),
      /unsupported-source-string-(?:escape|literal)/,
    );
  }

  const wrongTypeStore = new EvidenceStore('/replay', 'unsupported-source-string-type');
  const wrongType = wrongTypeStore.recordFileRead({
    path: '/replay/wrong-type.hpp',
    content: 'constexpr bool kEnabled = "false";\n',
  });
  assert.throws(
    () => deriveArtifactClaimSpecs([{ symbol: 'kEnabled', sourcePath: '/replay/wrong-type.hpp' }], [wrongType]),
    /unsupported-source-string-type/,
  );

  for (const [index, initializer] of ['`5000`', '5000。'].entries()) {
    const store = new EvidenceStore('/replay', `unsupported-source-markup-${index}`);
    const sourceRef = store.recordFileRead({
      path: '/replay/markup.hpp',
      content: `constexpr int kTimeout = ${initializer};\n`,
    });
    assert.throws(
      () => deriveArtifactClaimSpecs([{ symbol: 'kTimeout', sourcePath: '/replay/markup.hpp' }], [sourceRef]),
      /unsupported-source-expression/,
    );
  }
});

test('C++ integer claim normalization uses exact width and precision semantics', () => {
  const source = [
    'inline constexpr uint64_t kWide = 1ULL << 40;',
    'inline constexpr uint64_t kHuge = 9007199254740993ULL;',
    'inline constexpr uint32_t kMask = ~0U;',
  ].join('\n');
  const report = [
    '# 源码事实报告',
    '',
    '| Symbol | Value |',
    '| --- | --- |',
    '| kWide | 1099511627776 |',
    '| kHuge | 9007199254740993ULL |',
    '| kMask | 4294967295 |',
  ].join('\n');
  const store = new EvidenceStore('/replay', 'cpp-width');
  const sourceRef = store.recordFileRead({ path: '/replay/width.hpp', content: source });
  const specs = deriveArtifactClaimSpecs([
    { symbol: 'kWide', sourcePath: '/replay/width.hpp' },
    { symbol: 'kHuge', sourcePath: '/replay/width.hpp' },
    { symbol: 'kMask', sourcePath: '/replay/width.hpp' },
  ], [sourceRef]);
  assert.deepEqual(Object.fromEntries(specs.map(spec => [spec.symbol, spec.normalizedExpectedValue])), {
    kWide: 1099511627776,
    kHuge: '9007199254740993',
    kMask: 4294967295,
  });
  const artifactRef = store.recordFileRead({ path: '/replay/width.md', content: report, kind: 'artifact-readback' });
  const sourceReadback = store.recordFileRead({ path: '/replay/width.hpp', content: source });
  const result = verifyArtifactClaims(specs, artifactRef, [sourceReadback]);
  assert.equal(result.ok, true);
  assert.equal(result.claims.every(claim => claim.status === 'verified'), true);

  const wrongArtifact = store.recordFileRead({
    path: '/replay/width.md',
    content: report.replace('1099511627776', '256'),
    kind: 'artifact-readback',
  });
  const finalReadback = store.recordFileRead({ path: '/replay/width.hpp', content: source });
  const wrong = verifyArtifactClaims(specs, wrongArtifact, [finalReadback]);
  assert.equal(wrong.claims.find(claim => claim.symbol === 'kWide')?.status, 'mismatch');

  const unsupportedStore = new EvidenceStore('/replay', 'cpp-unsupported');
  const unsupported = unsupportedStore.recordFileRead({
    path: '/replay/unsupported.hpp',
    content: 'inline constexpr uint32_t kUnknown = WIDTH * 2;\n',
  });
  assert.throws(
    () => deriveArtifactClaimSpecs([{ symbol: 'kUnknown', sourcePath: '/replay/unsupported.hpp' }], [unsupported]),
    /unsupported-source-expression/,
  );
});

test('source claim values include declared C++ integer initialization conversion', () => {
  const source = [
    'inline constexpr uint8_t kNarrow = 300;',
    'inline constexpr uint32_t kTruncated = 1ULL << 40;',
    'inline constexpr unsigned int kAll = -1;',
  ].join('\n');
  const store = new EvidenceStore('/replay', 'cpp-declared-types');
  const sourceRef = store.recordFileRead({ path: '/replay/types.hpp', content: source });
  const specs = deriveArtifactClaimSpecs([
    { symbol: 'kNarrow', sourcePath: '/replay/types.hpp' },
    { symbol: 'kTruncated', sourcePath: '/replay/types.hpp' },
    { symbol: 'kAll', sourcePath: '/replay/types.hpp' },
  ], [sourceRef]);
  assert.deepEqual(Object.fromEntries(specs.map(spec => [spec.symbol, spec.normalizedExpectedValue])), {
    kNarrow: 44,
    kTruncated: 0,
    kAll: 4294967295,
  });
  const artifact = store.recordFileRead({
    path: '/replay/types.md',
    content: [
      '| Symbol | Value |',
      '| --- | --- |',
      '| kNarrow | 44 |',
      '| kTruncated | 0 |',
      '| kAll | 4294967295 |',
    ].join('\n'),
    kind: 'artifact-readback',
  });
  const readback = store.recordFileRead({ path: '/replay/types.hpp', content: source });
  assert.equal(verifyArtifactClaims(specs, artifact, [readback]).ok, true);

  const unknownTypeStore = new EvidenceStore('/replay', 'cpp-unknown-type');
  const unknownType = unknownTypeStore.recordFileRead({
    path: '/replay/unknown.hpp',
    content: 'inline constexpr unsigned long kUnknownAbi = 1;\n',
  });
  assert.throws(
    () => deriveArtifactClaimSpecs([{ symbol: 'kUnknownAbi', sourcePath: '/replay/unknown.hpp' }], [unknownType]),
    /unsupported-source-integer-type/,
  );

  const aliasStore = new EvidenceStore('/replay', 'cpp-case-sensitive-alias');
  const aliasRef = aliasStore.recordFileRead({
    path: '/replay/alias.hpp',
    content: 'using UINT8_T = uint16_t;\ninline constexpr UINT8_T kAlias = 300;\n',
  });
  assert.throws(
    () => deriveArtifactClaimSpecs([{ symbol: 'kAlias', sourcePath: '/replay/alias.hpp' }], [aliasRef]),
    /(?:unsupported-source-integer-type|shadowed-fixed-width-integer-type)/,
  );

  const suffixStore = new EvidenceStore('/replay', 'cpp-artifact-suffix');
  const suffixSource = 'inline constexpr int kSigned = -1;\n';
  const suffixSourceRef = suffixStore.recordFileRead({ path: '/replay/suffix.hpp', content: suffixSource });
  const suffixSpecs = deriveArtifactClaimSpecs([
    { symbol: 'kSigned', sourcePath: '/replay/suffix.hpp' },
  ], [suffixSourceRef]);
  const suffixArtifact = suffixStore.recordFileRead({
    path: '/replay/suffix.md',
    content: '| Symbol | Value |\n| --- | --- |\n| kSigned | -1U |\n',
    kind: 'artifact-readback',
  });
  const suffixReadback = suffixStore.recordFileRead({ path: '/replay/suffix.hpp', content: suffixSource });
  assert.equal(verifyArtifactClaims(suffixSpecs, suffixArtifact, [suffixReadback]).claims[0].status, 'mismatch');

  const characterStore = new EvidenceStore('/replay', 'cpp-character-literal');
  const characterRef = characterStore.recordFileRead({
    path: '/replay/character.hpp',
    content: "inline constexpr int kCharacter = 'A';\n",
  });
  assert.throws(
    () => deriveArtifactClaimSpecs([{ symbol: 'kCharacter', sourcePath: '/replay/character.hpp' }], [characterRef]),
    /unsupported-source-expression/,
  );
});

test('source grounding fails closed when fixed-width integer spellings are shadowed', () => {
  const shadowingCases = [
    'using uint8_t = uint16_t;\ninline constexpr uint8_t kShadowed = 300;\n',
    'typedef uint16_t uint8_t;\ninline constexpr uint8_t kShadowed = 300;\n',
    'typedef unsigned short uint8_t, *byte_ptr;\ninline constexpr uint8_t kShadowed = 300;\n',
    'typedef unsigned short uint8_t __attribute__((unused));\ninline constexpr uint8_t kShadowed = 300;\n',
    'typedef unsigned short uint8_t [[maybe_unused]];\ninline constexpr uint8_t kShadowed = 300;\n',
    'struct uint8_t { int value; constexpr uint8_t(int x) : value(x) {} };\ninline constexpr uint8_t kShadowed = 300;\n',
    'class [[nodiscard]] int16_t {};\ninline constexpr int16_t kShadowed = 300;\n',
    'struct alignas(8) uint8_t { int value; constexpr uint8_t(int x) : value(x) {} };\ninline constexpr uint8_t kShadowed = 300;\n',
    'struct S { static constexpr int alignment = 8; };\nstruct alignas(S::alignment) uint8_t { int value; constexpr uint8_t(int x) : value(x) {} };\ninline constexpr uint8_t kShadowed = 300;\n',
    'struct [[gnu::aligned(8)]] uint16_t { int value; constexpr uint16_t(int x) : value(x) {} };\ninline constexpr uint16_t kShadowed = 300;\n',
    'union uint32_t { unsigned value; };\ninline constexpr uint32_t kShadowed = { 300 };\n',
    'enum class uint64_t { value = 300 };\ninline constexpr uint64_t kShadowed = uint64_t::value;\n',
    'namespace nested { enum struct uint8_t { value = 44 }; }\ninline constexpr nested::uint8_t kShadowed = nested::uint8_t::value;\n',
    '#define uint8_t uint16_t\ninline constexpr uint8_t kShadowed = 300;\n',
  ];
  shadowingCases.forEach((source, index) => {
    const store = new EvidenceStore('/replay', `cpp-shadowed-fixed-width-${index}`);
    const sourceRef = store.recordFileRead({ path: '/replay/shadowed.hpp', content: source });
    assert.throws(
      () => deriveArtifactClaimSpecs([
        { symbol: 'kShadowed', sourcePath: '/replay/shadowed.hpp' },
      ], [sourceRef]),
      /shadowed-fixed-width-integer-type/,
      `shadowing case ${index} must fail closed`,
    );
  });
});

test('source grounding fails closed for macro-built aliases and noncanonical includes', () => {
  const cases = [
    {
      source: '#define TYPE uint8_t\ntypedef unsigned short TYPE;\nconstexpr uint8_t kX = 300;\n',
      error: /unsupported-source-macro-expansion: TYPE/,
    },
    {
      source: '#include "evil.hpp"\nconstexpr unsigned kX = 1ULL << 40;\n',
      error: /unsupported-source-include: "evil\.hpp"/,
    },
    {
      source: '#include <evil.hpp>\nconstexpr unsigned kX = 1ULL << 40;\n',
      error: /unsupported-source-include: <evil\.hpp>/,
    },
    {
      source: '#include_next "evil.hpp"\nconstexpr int kX = 300;\n',
      error: /unsupported-source-include: #include_next/,
    },
    {
      source: '#import "evil.hpp"\nconstexpr int kX = 300;\n',
      error: /unsupported-source-include: #import/,
    },
  ];
  cases.forEach(({ source, error }, index) => {
    const store = new EvidenceStore('/replay', `cpp-unsupported-translation-unit-${index}`);
    const sourceRef = store.recordFileRead({ path: '/replay/source.hpp', content: source });
    assert.throws(
      () => deriveArtifactClaimSpecs([{ symbol: 'kX', sourcePath: '/replay/source.hpp' }], [sourceRef]),
      error,
    );
  });
});

test('source grounding rejects macro expansion anywhere in active source code', () => {
  const sources = [
    '#define TAG uint8_t\nstruct TAG { int value; constexpr uint8_t(int x) : value(x) {} };\nconstexpr uint8_t kX = 300;\n',
    '#define DECL struct uint8_t { int value; constexpr uint8_t(int x) : value(x) {} };\nDECL\nconstexpr uint8_t kX = 300;\n',
    '#define DECL(T) struct T { int value; constexpr T(int x) : value(x) {} };\nDECL(uint8_t)\nconstexpr uint8_t kX = 300;\n',
  ];
  sources.forEach((source, index) => {
    const store = new EvidenceStore('/replay', `cpp-active-macro-expansion-${index}`);
    const sourceRef = store.recordFileRead({ path: '/replay/source.hpp', content: source });
    assert.throws(
      () => deriveArtifactClaimSpecs([{ symbol: 'kX', sourcePath: '/replay/source.hpp' }], [sourceRef]),
      /unsupported-source-macro-expansion/,
    );
  });
});

test('source grounding rejects preprocessing digraphs and translation-phase trigraphs', () => {
  const cases = [
    {
      source: '%:define int unsigned char\nconstexpr int kX = 300;\n%:undef int\n',
      error: /unsupported-source-preprocessing-digraph/,
    },
    {
      source: '// comment ??/\nconstexpr int kX = 300;\n',
      error: /unsupported-source-lexing: preprocessing trigraph/,
    },
  ];
  cases.forEach(({ source, error }, index) => {
    const store = new EvidenceStore('/replay', `cpp-alternative-preprocessor-token-${index}`);
    const sourceRef = store.recordFileRead({ path: '/replay/source.hpp', content: source });
    assert.throws(
      () => deriveArtifactClaimSpecs([{ symbol: 'kX', sourcePath: '/replay/source.hpp' }], [sourceRef]),
      error,
    );
  });
});

test('source grounding rejects pragma-controlled macro stack mutations', () => {
  const cases = [
    '#define int unsigned char\n#pragma push_macro("int")\n#undef int\n#pragma pop_macro("int")\nconstexpr int kX = 300;\n',
    '#define RESTORE _Pragma("pop_macro(\\\"int\\\")")\nconstexpr int kX = 300;\n',
    '_Pragma("push_macro(\\\"int\\\")")\nconstexpr int kX = 300;\n',
  ];
  cases.forEach((source, index) => {
    const store = new EvidenceStore('/replay', `cpp-pragma-macro-stack-${index}`);
    const sourceRef = store.recordFileRead({ path: '/replay/source.hpp', content: source });
    assert.throws(
      () => deriveArtifactClaimSpecs([{ symbol: 'kX', sourcePath: '/replay/source.hpp' }], [sourceRef]),
      /unsupported-source-pragma-(?:macro-stack|operator)/,
    );
  });
});

test('pipes inside the required fenced code block are not parsed as Markdown tables', () => {
  const source = 'constexpr uint8_t kX = 1;\n';
  const store = new EvidenceStore('/replay', 'fenced-pipe');
  const sourceRef = store.recordFileRead({ path: '/replay/source.hpp', content: source });
  const specs = deriveArtifactClaimSpecs([{ symbol: 'kX', sourcePath: '/replay/source.hpp' }], [sourceRef]);
  const artifact = store.recordFileRead({
    path: '/replay/report.md',
    content: '# Source Facts Report\n\n| Symbol | Value |\n| --- | --- |\n| kX | 1 |\n\n```python\nprint("left|right")\n```\n',
    kind: 'artifact-readback',
  });
  const readback = store.recordFileRead({ path: '/replay/source.hpp', content: source });
  const result = verifyArtifactClaims(specs, artifact, [readback], {
    requireTitle: true,
    exactClaimTable: { symbols: ['kX'], rowCount: 1, forbidAdditionalRows: true },
    exactCodeBlocks: [{ language: 'python', content: 'print("left|right")' }],
    requireArtifactReadback: true,
  });
  assert.equal(result.ok, true, result.differences.join('\n'));
});

test('source grounding fails closed when active macros rewrite declaration tokens or symbols', () => {
  const cases = [
    {
      source: '#define unsigned unsigned long long\nconstexpr unsigned kValue = 1ULL << 40;\n',
      symbol: 'kValue',
      error: /unsupported-source-macro-expansion: unsigned/,
    },
    {
      source: '#define kFoo kBar\nconstexpr uint32_t kFoo = 123;\n',
      symbol: 'kFoo',
      error: /unsupported-source-macro-expansion: kFoo/,
    },
  ];
  cases.forEach(({ source, symbol, error }, index) => {
    const store = new EvidenceStore('/replay', `cpp-macro-definition-${index}`);
    const sourceRef = store.recordFileRead({ path: '/replay/macro.hpp', content: source });
    assert.throws(
      () => deriveArtifactClaimSpecs([{ symbol, sourcePath: '/replay/macro.hpp' }], [sourceRef]),
      error,
    );
  });
});

test('source grounding rejects translation-phase line splicing instead of reviving commented declarations', () => {
  const store = new EvidenceStore('/replay', 'cpp-line-splice');
  const sourceRef = store.recordFileRead({
    path: '/replay/splice.hpp',
    content: '// dead comment \\\nconstexpr uint32_t kFoo = 999;\n',
  });
  assert.throws(
    () => deriveArtifactClaimSpecs([{ symbol: 'kFoo', sourcePath: '/replay/splice.hpp' }], [sourceRef]),
    /unsupported-source-lexing: backslash-newline splicing/,
  );
});

test('source grounding ignores comment, raw-string, and #if 0 pseudo declarations and rejects unresolved conditions', () => {
  const source = [
    '#ifndef SAFE_GROUNDING_HPP',
    '#define SAFE_GROUNDING_HPP',
    '/*',
    'inline constexpr uint8_t kVisible = 41;',
    '*/',
    'inline constexpr const char* kDocumentation = R"DOC(',
    'inline constexpr uint8_t kVisible = 42;',
    ')DOC";',
    '#if 0',
    'inline constexpr uint8_t kVisible = 43;',
    'using uint8_t = uint16_t;',
    '#endif',
    'inline constexpr uint8_t kVisible = 44;',
    '#endif',
  ].join('\n');
  const store = new EvidenceStore('/replay', 'cpp-inactive-pseudo-definitions');
  const sourceRef = store.recordFileRead({ path: '/replay/safe.hpp', content: source });
  const [spec] = deriveArtifactClaimSpecs([
    { symbol: 'kVisible', sourcePath: '/replay/safe.hpp' },
  ], [sourceRef]);
  assert.equal(spec.normalizedExpectedValue, 44);
  assert.equal(spec.sourceLine, 13);

  const unresolvedStore = new EvidenceStore('/replay', 'cpp-unresolved-preprocessor');
  const unresolvedRef = unresolvedStore.recordFileRead({
    path: '/replay/unresolved.hpp',
    content: '#if FEATURE_ENABLED\ninline constexpr uint8_t kMaybe = 1;\n#endif\n',
  });
  assert.throws(
    () => deriveArtifactClaimSpecs([
      { symbol: 'kMaybe', sourcePath: '/replay/unresolved.hpp' },
    ], [unresolvedRef]),
    /unsupported-source-preprocessing: unresolved #if FEATURE_ENABLED/,
  );
});

test('missing, ambiguous, duplicate, and source-drift evidence cannot pass', () => {
  const replay = loadReplay();
  const store = new EvidenceStore('/replay', replay.oracle.runId);
  assert.throws(
    () => deriveArtifactClaimSpecs(requirements(replay.prompt), []),
    /missing-source-evidence: kTopicLicenseState/,
  );
  const first = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const second = store.recordFileRead({ path: '/copy/license_types.hpp', content: replay.source });
  assert.throws(
    () => deriveArtifactClaimSpecs(requirements(replay.prompt).map(item => ({ symbol: item.symbol })), [first, second]),
    /ambiguous-source-evidence/,
  );

  const specs = deriveArtifactClaimSpecs(requirements(replay.prompt), [first]);
  const duplicateArtifact = store.recordFileRead({
    path: '/replay/report.md',
    content: `${replay.wrong}\n| \`kTunnelVersion\` | \`1\` | duplicate |\n`,
    kind: 'artifact-readback',
  });
  const unchangedReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const duplicateResult = verifyArtifactClaims(specs, duplicateArtifact, [unchangedReadback]);
  assert.equal(duplicateResult.claims.find(claim => claim.symbol === 'kTunnelVersion')?.status, 'ambiguous');

  const changedSource = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source.replace('33007', '33008') });
  const driftResult = verifyArtifactClaims(specs, duplicateArtifact, [changedSource]);
  assert.equal(driftResult.claims.every(claim => claim.status === 'source-drift'), true);
});

test('absolute source requirements cannot match suffix-confused evidence paths', () => {
  const store = new EvidenceStore('/tmp', 'path-confusion');
  const confused = store.recordFileRead({
    path: '/tmp/repo/config.hpp',
    content: 'inline constexpr int kValue = 7;\n',
  });
  assert.throws(
    () => deriveArtifactClaimSpecs([{ symbol: 'kValue', sourcePath: '/repo/config.hpp' }], [confused]),
    /missing-source-evidence/,
  );
});

test('verification is fail-closed for empty specs, missing independent source readback, and artifact structure', () => {
  const replay = loadReplay();
  const store = new EvidenceStore('/replay', replay.oracle.runId);
  const sourceRef = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const specs = deriveArtifactClaimSpecs(requirements(replay.prompt), [sourceRef]);
  const repairedWithoutPythonFence = replay.wrong
    .replace('/uav/dt/license/state', '/uav/license/state')
    .replace('/uav/dt/license/tunnel/rx', '/uav/license/tunnel/rx')
    .replace('`300`', '`33007`')
    .replace('`81920`', '`65536`')
    .replace('`30000`', '`5000`');
  const artifactRef = store.recordFileRead({
    path: '/replay/license-transport-facts.md',
    content: repairedWithoutPythonFence,
    kind: 'artifact-readback',
  });
  assert.throws(() => verifyArtifactClaims([], artifactRef, []), /at least one claim spec/);
  const missingReadback = verifyArtifactClaims(specs, artifactRef, []);
  assert.equal(missingReadback.claims.every(claim => claim.status === 'missing-source-readback'), true);

  const sourceReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const structured = verifyArtifactClaims(specs, artifactRef, [sourceReadback], {
    requireTitle: true,
    requiredSourcePaths: ['/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp'],
    exactClaimTable: { symbols: specs.map(spec => spec.symbol), rowCount: 6, forbidAdditionalRows: true },
    exactCodeBlocks: [{ language: 'python', content: 'print("\\nready")' }],
    requireArtifactReadback: true,
  });
  assert.equal(structured.ok, false);
  assert.deepEqual(structured.contractDifferences, [
    'scope: 精确事实表格只允许 symbol/value 两列，禁止携带未经证据验证的说明列',
    'scope: 精确事实表格表头必须严格为 Symbol/Value 或 常量名/值，禁止写入未经证据验证的事实',
    'scope: 精确事实报告标题必须使用固定无事实模板“源码事实报告”或“Source Facts Report”',
    'structure: 精确事实报告第一行必须逐字为“# 源码事实报告”或“# Source Facts Report”',
    'structure: 精确事实报告标题下一行必须逐字为“源码路径：/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp”',
    'scope: 精确事实报告包含任务范围外内容：**源码路径**: `/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp`',
    'structure: 缺少精确 python 代码块 print("\\nready")',
  ]);

  const strictBase = repairedWithoutPythonFence
    .replace('# License 模块传输常量事实记录', '# 源码事实报告')
    .replace(/\n\n\*\*源码路径\*\*: `([^\n`]+)`\n\n/, '\n源码路径：$1\n')
    .replace(/^\| 常量名 \| 值 \| 说明 \|$/m, '| Symbol | Value |')
    .replace(/^\| --- \| --- \| --- \|$/m, '| --- | --- |')
    .replace(/^\|(\s*`?k[^|]+\|\s*`?[^|]+`?\s*)\|\s*[^|]+\|$/gm, '|$1|')
    .replace('\n```\nprint("\\nready")', '\n```python\nprint("\\nready")');
  const forgedTitleArtifact = store.recordFileRead({
    path: '/replay/license-transport-facts.md',
    content: strictBase.replace('# 源码事实报告', '# AES-256 已启用'),
    kind: 'artifact-readback',
  });
  const forgedTitleReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const forgedTitle = verifyArtifactClaims(specs, forgedTitleArtifact, [forgedTitleReadback], {
    requireTitle: true,
    requiredSourcePaths: ['/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp'],
    exactClaimTable: { symbols: specs.map(spec => spec.symbol), rowCount: 6, forbidAdditionalRows: true },
    exactCodeBlocks: [{ language: 'python', content: 'print("\\nready")' }],
    requireArtifactReadback: true,
  });
  assert.equal(forgedTitle.ok, false);
  assert.equal(forgedTitle.contractDifferences.some(item => /固定无事实模板/.test(item)), true);

  const forgedHeaderArtifact = store.recordFileRead({
    path: '/replay/license-transport-facts.md',
    content: strictBase.replace('| Symbol | Value |', '| AES-256 已启用 | Value |'),
    kind: 'artifact-readback',
  });
  const forgedHeaderReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const forgedHeader = verifyArtifactClaims(specs, forgedHeaderArtifact, [forgedHeaderReadback], {
    requireTitle: true,
    requiredSourcePaths: ['/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp'],
    exactClaimTable: { symbols: specs.map(spec => spec.symbol), rowCount: 6, forbidAdditionalRows: true },
    exactCodeBlocks: [{ language: 'python', content: 'print("\\nready")' }],
    requireArtifactReadback: true,
  });
  assert.equal(forgedHeader.ok, false);
  assert.equal(forgedHeader.contractDifferences.some(item => /表头必须严格/.test(item)), true);

  const missingSeparatorArtifact = store.recordFileRead({
    path: '/replay/license-transport-facts.md',
    content: strictBase.replace('| --- | --- |\n', ''),
    kind: 'artifact-readback',
  });
  const missingSeparatorReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const missingSeparator = verifyArtifactClaims(specs, missingSeparatorArtifact, [missingSeparatorReadback], {
    requireTitle: true,
    requiredSourcePaths: ['/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp'],
    exactClaimTable: { symbols: specs.map(spec => spec.symbol), rowCount: 6, forbidAdditionalRows: true },
    exactCodeBlocks: [{ language: 'python', content: 'print("\\nready")' }],
    requireArtifactReadback: true,
  });
  assert.equal(missingSeparator.ok, false);
  assert.equal(missingSeparator.contractDifferences.some(item => /紧跟 Markdown 分隔行/.test(item)), true);

  const preSeparatorFactArtifact = store.recordFileRead({
    path: '/replay/license-transport-facts.md',
    content: strictBase.replace('| --- | --- |', '| AES-256 | enabled |\n| --- | --- |'),
    kind: 'artifact-readback',
  });
  const preSeparatorFactReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const preSeparatorFact = verifyArtifactClaims(specs, preSeparatorFactArtifact, [preSeparatorFactReadback], {
    requireTitle: true,
    requiredSourcePaths: ['/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp'],
    exactClaimTable: { symbols: specs.map(spec => spec.symbol), rowCount: 6, forbidAdditionalRows: true },
    exactCodeBlocks: [{ language: 'python', content: 'print("\\nready")' }],
    requireArtifactReadback: true,
  });
  assert.equal(preSeparatorFact.ok, false);
  assert.equal(preSeparatorFact.contractDifferences.some(item => /总行数|紧跟 Markdown 分隔行/.test(item)), true);

  const outOfScopeArtifact = store.recordFileRead({
    path: '/replay/license-transport-facts.md',
    content: `${repairedWithoutPythonFence.replace('\n```\nprint("\\nready")', '\n```python\nprint("\\nready")')}\n\n## 未请求的加密事实\n\nAES-256 已启用。\n\n| 常量名 | 值 |\n| --- | --- |\n| \`kSecret\` | \`999\` |\n`,
    kind: 'artifact-readback',
  });
  const finalSourceReadback = store.recordFileRead({ path: '/replay/license_types.hpp', content: replay.source });
  const outOfScope = verifyArtifactClaims(specs, outOfScopeArtifact, [finalSourceReadback], {
    requireTitle: true,
    requiredSourcePaths: ['/home/ff/uav/tars/huida_uav/src/oam/src/license/license_types.hpp'],
    exactClaimTable: { symbols: specs.map(spec => spec.symbol), rowCount: 6, forbidAdditionalRows: true },
    exactCodeBlocks: [{ language: 'python', content: 'print("\\nready")' }],
    requireArtifactReadback: true,
  });
  assert.equal(outOfScope.ok, false);
  assert.equal(outOfScope.contractDifferences.some(item => /只允许唯一 claim 表格/.test(item)), true);
  assert.equal(outOfScope.contractDifferences.some(item => /任务范围外内容/.test(item)), true);
});

test('strict fact report requires an exact first-line title and immediately adjacent exact source path', () => {
  const sourcePath = '/replay/config.hpp';
  const artifactPath = '/replay/report.md';
  const source = 'inline constexpr int timeoutMs = 5000;\n';
  const store = new EvidenceStore('/replay', 'strict-title-source-layout');
  const sourceRef = store.recordFileRead({ path: sourcePath, content: source });
  const specs = deriveArtifactClaimSpecs([{ symbol: 'timeoutMs', sourcePath }], [sourceRef]);
  const contract = {
    requireTitle: true,
    requiredSourcePaths: [sourcePath],
    exactClaimTable: { symbols: ['timeoutMs'], rowCount: 1, forbidAdditionalRows: true },
    requireArtifactReadback: true,
  };
  const table = '| Symbol | Value |\n| --- | --- |\n| timeoutMs | 5000 |';
  const verify = content => {
    const artifactRef = store.recordFileRead({ path: artifactPath, content, kind: 'artifact-readback' });
    const sourceReadback = store.recordFileRead({ path: sourcePath, content: source });
    return verifyArtifactClaims(specs, artifactRef, [sourceReadback], contract);
  };

  const valid = verify(`# 源码事实报告\n源码路径：${sourcePath}\n${table}\n`);
  assert.equal(valid.ok, true, valid.differences.join('\n'));

  for (const invalid of [
    `# 源码事实报告\n\n源码路径：${sourcePath}\n${table}\n`,
    `# 源码事实报告\n${table}\n源码路径：${sourcePath}\n`,
    `# 源码事实报告\n**源码路径**: \`${sourcePath}\`\n${table}\n`,
    `# 源码事实报告\n${sourcePath}\n${table}\n`,
  ]) {
    const result = verify(invalid);
    assert.equal(result.ok, false);
    assert.equal(result.contractDifferences.some(item => /标题下一行必须逐字为/.test(item)), true);
  }

  const paddedTitle = verify(` # 源码事实报告\n源码路径：${sourcePath}\n${table}\n`);
  assert.equal(paddedTitle.ok, false);
  assert.equal(paddedTitle.contractDifferences.some(item => /第一行必须逐字为/.test(item)), true);
});

test('host-owned exact artifacts preserve numeric source initializers instead of accepting equivalent rewrites', () => {
  const sourcePath = '/replay/limits.hpp';
  const artifactPath = '/replay/limits.md';
  const source = 'inline constexpr uint32_t kMaxSize = 64 * 1024;\n';
  const store = new EvidenceStore('/replay', 'exact-initializer-presentation');
  const sourceRef = store.recordFileRead({ path: sourcePath, content: source });
  const specs = deriveArtifactClaimSpecs([{ symbol: 'kMaxSize', sourcePath }], [sourceRef]);
  const exactArtifact = {
    kind: 'source-fact-markdown',
    title: '# 源码事实报告',
    sourcePathLines: [`源码路径：${sourcePath}`],
    tableHeader: ['Symbol', 'Value'],
    symbols: ['kMaxSize'],
    valuePresentation: 'source-initializer',
    codeBlocks: [{ language: 'python', content: 'print("left|right")' }],
    forbidAdditionalContent: true,
  };
  const contract = {
    requireTitle: true,
    requiredSourcePaths: [sourcePath],
    exactClaimTable: { symbols: ['kMaxSize'], rowCount: 1, forbidAdditionalRows: true },
    exactCodeBlocks: exactArtifact.codeBlocks,
    exactArtifact,
    requireArtifactReadback: true,
  };
  const verify = value => {
    const artifact = store.recordFileRead({
      path: artifactPath,
      content: [
        exactArtifact.title,
        exactArtifact.sourcePathLines[0],
        '| Symbol | Value |',
        '| --- | --- |',
        `| kMaxSize | ${value} |`,
        '```python',
        'print("left|right")',
        '```',
        '',
      ].join('\n'),
      kind: 'artifact-readback',
    });
    const readback = store.recordFileRead({ path: sourcePath, content: source });
    return verifyArtifactClaims(specs, artifact, [readback], contract);
  };

  assert.equal(verify('64 * 1024').ok, true, 'pipes inside the exact code block are not table rows');
  const rewritten = verify('65536');
  assert.equal(rewritten.ok, false);
  assert.equal(rewritten.claims[0].status, 'mismatch');
  assert.match(rewritten.claims[0].difference, /期望源码 initializer 64 \* 1024/);
});

console.log('\nEvidence grounding tests passed.\n');
