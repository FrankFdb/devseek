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

test('CLI composition root delegates artifact interpretation, mutation, and verification to named owners', () => {
  const index = readSource('index.ts');

  assert.match(index, /new CliCodingArtifactInterpreter\(\)/);
  assert.match(index, /new CliWorkspaceMutationService\(\)/);
  assert.match(index, /new CliVerificationService\(\)/);
  assert.match(index, /codingArtifactInterpreter\.interpret\(response\)/);
  assert.match(index, /workspaceMutationService\.apply\(input\.cwd, artifactProposal\)/);
  assert.match(index, /verificationService\.verify\(input\.cwd, files, input\.prompt\)/);

  assert.doesNotMatch(index, /function parse(?:FileToolCalls|UnifiedDiffs)\b/);
  assert.doesNotMatch(index, /function apply(?:FileToolCalls|UnifiedDiffs|CodingArtifacts)\b/);
  assert.doesNotMatch(index, /function (?:validateChangedFiles|runDevseekVerifier|runProjectVerifier)\b/);
  assert.doesNotMatch(index, /\bspawnSync\s*\(/);
});

test('CLI extracted owners keep provider interpretation, workspace mutation, and verification separate', () => {
  const interpreter = readSource('cli-coding-artifact-interpreter.ts');
  const mutation = readSource('cli-workspace-mutation-service.ts');
  const verification = readSource('cli-verification-service.ts');

  assert.match(interpreter, /class CliCodingArtifactInterpreter/);
  assert.doesNotMatch(interpreter, /(?:readFile|writeFile|spawnSync)\s*\(/);

  assert.match(mutation, /class CliWorkspaceMutationService/);
  assert.match(mutation, /resolveCliWorkspacePath/);
  assert.doesNotMatch(mutation, /(?:spawnSync|devseek\.verify\.json)/);

  assert.match(verification, /class CliVerificationService/);
  assert.match(verification, /spawnSync/);
  assert.doesNotMatch(verification, /(?:create_file|replace_file|<tool_call>)/);
});
