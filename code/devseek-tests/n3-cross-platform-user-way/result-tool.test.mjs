import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  buildResultTemplate,
  packetSha256,
  sealEvidenceHashes,
  validatePacket,
  verifyResult,
  verifyResultMatrix,
} from './result-contract.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const packetPath = path.join(root, 'cases.json');
const packet = readJson(packetPath);
const packetHash = packetSha256(packetPath);

test('packet fixes one candidate, ordered user journeys, and non-qualifying evidence', () => {
  assert.deepEqual(validatePacket(packet), []);
  assert.equal(packet.candidate.vsix_sha256, '8386445523df3b550d9a9edda07e59b594cc3c766e2aecc0a367b9ef5084a854');
  assert.equal(packet.qualification_effect, 'NONE');
  assert.equal(packet.claims_permitted, false);
  assert.equal(packet.asserts_gate_pass, false);
  assert.deepEqual(packet.cases.map(item => item.case_id), [
    'N3-UW-01-INSTALL-IDENTITY',
    'N3-UW-02-NATURAL-MEDIUM-TASK',
    'N3-UW-03-PATH-SYMLINK-BOUNDARY',
    'N3-UW-04-PERMISSION-FAILURE-RECOVERY',
    'N3-UW-05-STEERING-CANCEL',
    'N3-UW-06-RESTART-RESUME',
    'N3-UW-07-NETWORK-INTERRUPTION',
    'N3-UW-08-DELIVERY-CLEANUP',
  ]);
});

test('sealed exact-candidate result with complete independent evidence is accepted', (t) => {
  const fixture = createAcceptedFixture(t);
  const verification = verifyFixture(fixture);
  assert.equal(verification.accepted, true, verification.errors.join('\n'));
  assert.equal(verification.summary.passed_cases, 8);
});

test('candidate drift, non-pass status, selective rerun, and evidence tamper fail closed', async (t) => {
  const attacks = [
    ['candidate-drift', fixture => { fixture.result.candidate.vsix_sha256 = '0'.repeat(64); }, 'candidate:mismatch'],
    ['failed-case', fixture => { fixture.result.case_results[3].status = 'FAIL'; }, 'case:N3-UW-04-PERMISSION-FAILURE-RECOVERY:status-FAIL'],
    ['selective-rerun', fixture => { fixture.result.tester.selective_rerun_performed = true; }, 'tester:selective-rerun'],
    ['hash-tamper', fixture => { fs.appendFileSync(path.join(fixture.directory, fixture.result.case_results[0].evidence[0].path), 'tampered'); }, 'evidence:sha256-mismatch'],
  ];
  for (const [name, mutate, expected] of attacks) await t.test(name, () => {
    const fixture = createAcceptedFixture(t);
    mutate(fixture);
    const verification = verifyFixture(fixture);
    assert.equal(verification.accepted, false);
    assert.ok(verification.errors.some(error => error.includes(expected)), verification.errors.join('\n'));
  });
});

test('evidence escape, symlink substitution, reuse, and obvious secrets fail closed', async (t) => {
  const outside = path.join(os.tmpdir(), `devseek-n3-outside-${process.pid}.txt`);
  fs.writeFileSync(outside, 'outside');
  t.after(() => fs.rmSync(outside, { force: true }));

  const attacks = [
    ['escape', fixture => {
      fixture.result.case_results[0].evidence[0].path = path.relative(fixture.directory, outside);
    }, 'evidence:path-escape'],
    ['symlink', fixture => {
      const evidence = fixture.result.case_results[0].evidence[0];
      const target = path.join(fixture.directory, evidence.path);
      fs.rmSync(target);
      fs.symlinkSync(outside, target);
    }, 'symlink-forbidden'],
    ['reuse', fixture => {
      fixture.result.case_results[0].evidence[1].path = fixture.result.case_results[0].evidence[0].path;
      fixture.result.case_results[0].evidence[1].sha256 = fixture.result.case_results[0].evidence[0].sha256;
    }, 'evidence:path-reused'],
    ['secret', fixture => {
      const evidence = fixture.result.case_results[0].evidence[0];
      const target = path.join(fixture.directory, evidence.path);
      fs.writeFileSync(target, 'DEVSEEK_BRIDGE_TOKEN=do-not-share');
      fixture.result = sealEvidenceHashes(fixture.result, fixture.resultPath);
    }, 'evidence:possible-secret'],
  ];
  for (const [name, mutate, expected] of attacks) await t.test(name, () => {
    const fixture = createAcceptedFixture(t);
    mutate(fixture);
    const verification = verifyFixture(fixture);
    assert.equal(verification.accepted, false);
    assert.ok(verification.errors.some(error => error.includes(expected)), verification.errors.join('\n'));
  });
});

test('manual guide exposes candidate, every case, and the init/seal/verify handoff', () => {
  const guide = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(guide, new RegExp(packet.candidate.vsix_sha256));
  for (const testCase of packet.cases) assert.match(guide, new RegExp(testCase.case_id));
  for (const command of ['result-tool.mjs init', 'result-tool.mjs seal', 'result-tool.mjs verify', 'result-tool.mjs matrix']) {
    assert.ok(guide.includes(command), `guide missing ${command}`);
  }
});

test('matrix requires every mandatory profile exactly once and preserves rejected runs', () => {
  const accepted = profile => ({
    resultPath: `/evidence/${profile}/result.json`,
    verification: {
      accepted: true,
      summary: { platform_profile: profile },
      errors: [],
    },
  });
  const required = packet.platform_profiles.filter(profile => profile.required_for_n3).map(profile => profile.profile_id);
  const complete = verifyResultMatrix(packet, required.map(accepted));
  assert.equal(complete.accepted, true, complete.errors.join('\n'));

  const missing = verifyResultMatrix(packet, required.slice(1).map(accepted));
  assert.equal(missing.accepted, false);
  assert.ok(missing.errors.includes(`matrix:required-profile-missing:${required[0]}`));

  const duplicate = verifyResultMatrix(packet, [...required.map(accepted), accepted(required[0])]);
  assert.equal(duplicate.accepted, false);
  assert.ok(duplicate.errors.includes(`matrix:duplicate-profile:${required[0]}`));

  const rejected = required.map(accepted);
  rejected[1] = {
    resultPath: `/evidence/${required[1]}/failed-result.json`,
    verification: { accepted: false, summary: { platform_profile: required[1] }, errors: ['case:failed'] },
  };
  const failed = verifyResultMatrix(packet, rejected);
  assert.equal(failed.accepted, false);
  assert.ok(failed.errors.includes(`matrix:result-rejected:${required[1]}`));
});

function createAcceptedFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devseek-n3-result-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resultPath = path.join(directory, 'result.json');
  let result = buildResultTemplate(packet, packetHash, 'windows-x64-v1', 'n3-windows-accepted');
  result.tester = {
    tester_id: 'independent-tester-1',
    organization: 'independent-lab',
    implementation_contributor: false,
    saw_implementation_or_hidden_oracles_before_execution: false,
    case_order_preserved: true,
    selective_rerun_performed: false,
    consent_to_share_redacted_evidence: true,
  };
  result.environment = {
    os: 'win32',
    architecture: 'x64',
    host_kind: 'native',
    os_version: 'Windows fixture',
    vscode_version: '1.100.0',
    vscode_commit: 'fixture-vscode-commit',
    shell: 'PowerShell 7',
    node_version: 'v22.0.0',
    workspace_path: 'C:\\Temp\\DevSeek Test\\project',
    extension_version: packet.candidate.extension_version,
    vsix_sha256: packet.candidate.vsix_sha256,
  };
  result.started_at = '2026-08-24T03:00:00.000Z';
  result.completed_at = '2026-08-24T04:00:00.000Z';
  for (const [caseIndex, caseResult] of result.case_results.entries()) {
    caseResult.status = 'PASS';
    caseResult.started_at = `2026-08-24T03:${String(caseIndex * 5).padStart(2, '0')}:00.000Z`;
    caseResult.completed_at = `2026-08-24T03:${String(caseIndex * 5 + 4).padStart(2, '0')}:00.000Z`;
    caseResult.observations = `Independent observation for ${caseResult.case_id}`;
    for (const [evidenceIndex, evidence] of caseResult.evidence.entries()) {
      evidence.path = `evidence/${String(caseIndex + 1).padStart(2, '0')}-${evidenceIndex + 1}-${evidence.kind}.txt`;
      const target = path.join(directory, evidence.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, `${caseResult.case_id} ${evidence.kind} redacted evidence\n`);
    }
  }
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  result = sealEvidenceHashes(result, resultPath);
  return { directory, resultPath, result };
}

function verifyFixture(fixture) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateSchema = ajv.compile(readJson(path.join(root, 'result.schema.json')));
  return verifyResult({ packet, packetHash, result: fixture.result, resultPath: fixture.resultPath, validateSchema });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
