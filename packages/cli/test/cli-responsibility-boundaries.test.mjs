import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDir, '../src');

function readSource(fileName) {
  return readFileSync(path.join(sourceRoot, fileName), 'utf8');
}

test('CLI composition root delegates the legacy coding workflow to a named coordinator', () => {
  const index = readSource('index.ts');

  assert.match(index, /new CliCodingArtifactInterpreter\(\)/);
  assert.match(index, /new CliWorkspaceMutationService\(\)/);
  assert.match(index, /new CliVerificationService\(\)/);
  assert.match(index, /new CliLegacyCodingLoop\(/);
  assert.match(index, /legacyCodingLoop\.execute\(/);

  assert.doesNotMatch(index, /function runCodingLoop\b/);
  assert.doesNotMatch(index, /function buildRepairPrompt\b/);
  assert.doesNotMatch(index, /function (?:note|close)CliRecovery\w*\b/);
  assert.doesNotMatch(index, /codingArtifactInterpreter\.interpret\(/);
  assert.doesNotMatch(index, /workspaceMutationService\.apply\(/);
  assert.doesNotMatch(index, /verificationService\.verify\(/);
  assert.doesNotMatch(index, /function parse(?:FileToolCalls|UnifiedDiffs)\b/);
  assert.doesNotMatch(index, /function apply(?:FileToolCalls|UnifiedDiffs|CodingArtifacts)\b/);
  assert.doesNotMatch(index, /function (?:validateChangedFiles|runDevseekVerifier|runProjectVerifier)\b/);
  assert.doesNotMatch(index, /\bspawnSync\s*\(/);
});

test('CLI extracted owners keep provider interpretation, workspace mutation, and verification separate', () => {
  const interpreter = readSource('cli-coding-artifact-interpreter.ts');
  const codingLoop = readSource('cli-legacy-coding-loop.ts');
  const mutation = readSource('cli-workspace-mutation-service.ts');
  const verification = readSource('cli-verification-service.ts');

  assert.match(interpreter, /class CliCodingArtifactInterpreter/);
  assert.doesNotMatch(interpreter, /(?:readFile|writeFile|spawnSync)\s*\(/);

  assert.match(codingLoop, /class CliLegacyCodingLoop/);
  assert.match(codingLoop, /this\.artifactInterpreter\.interpret\(/);
  assert.match(codingLoop, /this\.workspaceMutation\.apply\(/);
  assert.match(codingLoop, /this\.verification\.verify\(/);
  assert.match(codingLoop, /function buildRepairPrompt\b/);
  assert.doesNotMatch(codingLoop, /(?:AgentApplicationService|CliSurfaceAdapter|bridgeChat)/);

  assert.match(mutation, /class CliWorkspaceMutationService/);
  assert.match(mutation, /resolveCliWorkspacePath/);
  assert.doesNotMatch(mutation, /(?:spawnSync|devseek\.verify\.json)/);

  assert.match(verification, /class CliVerificationService/);
  assert.match(verification, /spawnSync/);
  assert.doesNotMatch(verification, /(?:create_file|replace_file|<tool_call>)/);
});
