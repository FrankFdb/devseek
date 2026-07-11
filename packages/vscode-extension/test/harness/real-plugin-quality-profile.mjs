export function buildRealPluginQualityProfile(scenario) {
  const kind = classifyScenario(scenario);
  return {
    kind,
    minimumMarkdownBytes: kind === 'canary' ? 120 : kind === 'medium' ? 300 : 500,
    requireFormalProjectQuality: kind !== 'canary',
  };
}

export function parseRequiredArtifactSnippets(value) {
  return String(value || '')
    .split(/\|\||\r?\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

function classifyScenario(value) {
  const scenario = String(value || '').toLowerCase();
  if (/canary|smoke|short|tiny|read-only/.test(scenario)) return 'canary';
  if (/medium|integration/.test(scenario)) return 'medium';
  return 'formal';
}
