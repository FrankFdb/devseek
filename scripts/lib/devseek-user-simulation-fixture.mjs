import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = path.join(repoRoot, 'docs/process/devseek-iteration-user-journeys.json');

export function loadUserSimulationCase(iterationId, caseId) {
  const manifest = readJson(manifestPath);
  const iteration = manifest.iterations.find(item => item.iteration_id === iterationId);
  if (!iteration) throw new Error(`user-simulation-fixture:unknown-iteration:${iterationId}`);
  const fixturePath = path.resolve(repoRoot, iteration.fixture_path);
  const fixture = readJson(fixturePath);
  const scenario = fixture.cases.find(item => item.case_id === caseId);
  if (!scenario) throw new Error(`user-simulation-fixture:unknown-case:${caseId}`);
  return structuredClone(scenario);
}

export function materializeMemoryCandidates(scenario, options = {}) {
  const workspaceRoot = options.workspaceRoot;
  return (scenario?.input?.memory_candidates ?? []).map((candidate, index) => ({
    memoryId: candidate.memory_id,
    content: candidate.content,
    scope: candidate.scope,
    classification: candidate.classification,
    sourceKind: candidate.source_kind,
    status: 'active',
    approvalState: candidate.approval_state,
    externalContent: candidate.external_content,
    trusted: candidate.trusted,
    ...(candidate.scope === 'repository' && workspaceRoot ? { workspaceRoot } : {}),
    createdAt: 100 + index,
    updatedAt: 200 + index,
  }));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
