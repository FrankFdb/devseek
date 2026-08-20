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

test('CLI composition root delegates canonical execution to the shared Kernel', () => {
  const index = readSource('index.ts');
  const productKernel = readSource('cli-product-coding-kernel.ts');
  const runLifecycle = readSource('cli-run-lifecycle.ts');

  assert.match(index, /new CliLegacyWorkspaceContextSelector\(\)/);
  assert.match(index, /CliRunEvidence\.open\(/);
  assert.match(index, /acceptCliCodingKernelOutput\(evidence, await productCliCodingKernelExecutor\.execute\(/);
  assert.match(index, /settleCliRunFailure\(\{/);
  assert.doesNotMatch(index, /kernelOutput\.status !== 'completed'/);
  assert.match(index, /workspaceContextSelector\.select\(/);
  assert.doesNotMatch(index, /CliCodingArtifactInterpreter|CliWorkspaceMutationHostAdapter|CliVerificationAdapter|CliVerificationHostAdapter/);
  assert.doesNotMatch(index, /CanonicalCodingKernel|CliCodingKernelRuntimeAdapter/);

  assert.match(productKernel, /new CliCodingArtifactInterpreter\(\)/);
  assert.match(productKernel, /new CliWorkspaceMutationHostAdapter\(\)/);
  assert.match(productKernel, /new CliVerificationAdapter\(new CliVerificationHostAdapter\(\)\)/);
  assert.match(productKernel, /new CanonicalCodingKernel\(new CliCodingKernelRuntimeAdapter\(/);
  assert.match(productKernel, /const output = await kernel\.execute\(/);
  assert.match(productKernel, /completion: output\.completion/);
  assert.match(productKernel, /route: 'canonical'/);
  assert.match(productKernel, /output\.status === 'completed'/);
  assert.match(productKernel, /completion\.reasonCodes/);

  assert.match(runLifecycle, /export function acceptCliCodingKernelOutput\(/);
  assert.match(runLifecycle, /evidence\.retainLifecycle\(output\.lifecycle\);\s*assertCompletedCliCodingKernelOutput\(output\);/);
  assert.match(runLifecycle, /export async function settleCliRunFailure\(/);
  assert.match(runLifecycle, /resolveCliRunTerminalStatus\(input\.error, input\.cancellation\.cancelled\)/);
  assert.match(runLifecycle, /await input\.renderLifecycle\(status, exitCode\)/);
  assert.match(runLifecycle, /input\.evidence\.settle\(status\)/);

  assert.doesNotMatch(index, /function runCodingLoop\b/);
  assert.doesNotMatch(index, /CliLegacyCodingLoop|legacyCodingLoop|cli-legacy-coding-loop/);
  assert.doesNotMatch(index, /function buildRepairPrompt\b/);
  assert.doesNotMatch(index, /function (?:note|close)CliRecovery\w*\b/);
  assert.doesNotMatch(index, /codingArtifactInterpreter\.interpret\(/);
  assert.doesNotMatch(index, /workspaceMutationService\.apply\(/);
  assert.doesNotMatch(index, /verificationService\.verify\(/);
  assert.doesNotMatch(index, /function (?:selectWorkspaceContextFiles|discoverImplicitProjectContextFiles|collectContextFiles)\b/);
  assert.doesNotMatch(index, /function (?:openCliRunEvidence|recordCliOperationEvidence|assertCliBridgeEvidenceComplete|settleCliEvidence)\b/);
  assert.doesNotMatch(index, /(?:ProductRunEvidenceSession|createProductRunEvidenceAuthorityToken)/);
  assert.doesNotMatch(index, /\b(?:readdir|stat)\s*\(/);
  assert.doesNotMatch(index, /function parse(?:FileToolCalls|UnifiedDiffs)\b/);
  assert.doesNotMatch(index, /function apply(?:FileToolCalls|UnifiedDiffs|CodingArtifacts)\b/);
  assert.doesNotMatch(index, /function (?:validateChangedFiles|runDevseekVerifier|runProjectVerifier)\b/);
  assert.doesNotMatch(index, /\bspawnSync\s*\(/);
});

test('CLI runtime adapter keeps context, interpretation, mutation, and verification separate', () => {
  const interpreter = readSource('cli-coding-artifact-interpreter.ts');
  const codingRuntime = readSource('cli-coding-kernel-runtime.ts');
  const contextSelector = readSource('cli-legacy-workspace-context-selector.ts');
  const runEvidence = readSource('cli-run-evidence.ts');
  const mutation = readSource('cli-workspace-mutation-service.ts');
  const verificationAdapter = readSource('cli-verification-adapter.ts');
  const verification = readSource('cli-verification-service.ts');

  assert.match(interpreter, /class CliCodingArtifactInterpreter/);
  assert.doesNotMatch(interpreter, /(?:readFile|writeFile|spawnSync)\s*\(/);

  assert.match(codingRuntime, /class CliCodingKernelRuntimeAdapter/);
  assert.match(codingRuntime, /implements CodingKernelRuntimePort/);
  assert.match(codingRuntime, /this\.artifactInterpreter\.interpret\(/);
  assert.match(codingRuntime, /toolExecution\.executeWorkspaceMutation\(/);
  assert.match(codingRuntime, /this\.verification\.prepare\(/);
  assert.match(codingRuntime, /this\.verification\.execute\(/);
  assert.ok(
    codingRuntime.indexOf('this.verification.prepare(') < codingRuntime.indexOf('request.externalEffects.execute('),
    'read-only verifier discovery must finish before process authority executes',
  );
  assert.ok(
    codingRuntime.indexOf('this.verification.execute(') > codingRuntime.indexOf('request.externalEffects.execute('),
    'selected verifier execution must stay inside the external-effect boundary',
  );
  assert.match(codingRuntime, /function buildRepairPrompt\b/);
  assert.doesNotMatch(codingRuntime, /(?:AgentApplicationService|CliSurfaceAdapter|bridgeChat)/);

  assert.match(contextSelector, /class CliLegacyWorkspaceContextSelector/);
  assert.match(contextSelector, /resolveCliWorkspacePath/);
  assert.match(contextSelector, /\breaddir\s*\(/);
  assert.match(contextSelector, /\bstat\s*\(/);
  assert.doesNotMatch(contextSelector, /(?:AgentApplicationService|create_file|replace_file|spawnSync)/);
  assert.doesNotMatch(
    contextSelector,
    /(?:CodingKernelTaskContract|CodingToolAuthority|taskContract|toolAuthority|completion)/,
  );

  assert.match(runEvidence, /class CliRunEvidence/);
  assert.match(runEvidence, /ProductRunEvidenceSession\.forWorkspace/);
  assert.match(runEvidence, /CanonicalRunEvidenceRetentionService/);
  assert.match(runEvidence, /retainLifecycle\(snapshot: CodingRunLifecycleSnapshot\)/);
  assert.match(runEvidence, /settleAndSeal/);
  assert.match(runEvidence, /boundary === 'bridge-server'/);
  assert.match(runEvidence, /type: 'evidence\.degraded'/);
  assert.doesNotMatch(runEvidence, /(?:AgentApplicationService|CliSurfaceAdapter|bridgeChat)/);

  assert.match(mutation, /class CliWorkspaceMutationHostAdapter/);
  assert.match(mutation, /implements WorkspaceMutationPort/);
  assert.match(mutation, /mutationState: 'unchanged'/);
  assert.match(mutation, /mutationState: 'possibly-changed'/);
  assert.match(mutation, /resolveCliWorkspacePath/);
  assert.doesNotMatch(mutation, /(?:spawnSync|devseek\.verify\.json)/);

  assert.match(verificationAdapter, /async prepare\(/);
  assert.match(verificationAdapter, /async execute\(/);
  assert.match(verificationAdapter, /ports\.selection\.select\(/);
  assert.match(verificationAdapter, /ports\.orchestration\.execute\(/);
  assert.match(verificationAdapter, /ports\.verification\.verify\(/);
  assert.match(verification, /class CliVerificationHostAdapter/);
  assert.match(verification, /spawnSync/);
  assert.doesNotMatch(verification, /(?:create_file|replace_file|<tool_call>)/);
});
