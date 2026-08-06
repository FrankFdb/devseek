import path from 'node:path';

export const VERSIONED_SIMULATION_FIXTURE_ROOT = 'scripts/test/fixtures/user-simulations';
export const LOCAL_SIMULATION_ARTIFACT_ROOT = 'code/devseek-tests';

export function resolveVersionedSimulationFixture(repoRoot, value) {
  return resolveWithinRoot(repoRoot, value, VERSIONED_SIMULATION_FIXTURE_ROOT, 'fixture path');
}

export function resolveLocalSimulationArtifactRoot(repoRoot, value) {
  return resolveWithinRoot(repoRoot, value, LOCAL_SIMULATION_ARTIFACT_ROOT, 'artifact root');
}

function resolveWithinRoot(repoRoot, value, allowedRelativeRoot, label) {
  const relativePath = String(value ?? '').trim();
  const allowedRoot = path.resolve(repoRoot, allowedRelativeRoot);
  const resolved = path.resolve(repoRoot, relativePath);
  if (!relativePath || (resolved !== allowedRoot && !resolved.startsWith(`${allowedRoot}${path.sep}`))) {
    throw new Error(`${label} must stay under ${allowedRelativeRoot}`);
  }
  return resolved;
}
