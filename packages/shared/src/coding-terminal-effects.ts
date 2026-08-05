import type { CodingToolEffect } from './coding-conformance';

const NETWORK_EFFECT_RE = /(?:\b(?:curl|wget|ssh|scp|rsync)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b|\b(?:pip|pip3|python3?\s+-m\s+pip)\s+install\b)/iu;
const WORKSPACE_MUTATION_RE = /(?:^|[;&|]\s*)(?:touch|mkdir|cp|mv|rm|chmod|chown|ln|truncate)\b|(?:^|[^>])>{1,2}(?!=)|\bgit\s+(?:add|apply|checkout|commit|merge|pull|rebase|reset|restore|stash|switch)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b|\b(?:pip|pip3|python3?\s+-m\s+pip)\s+install\b/iu;

/** Classifies effects from the command itself instead of from a Surface-local tool label. */
export function classifyCodingTerminalEffects(command: string): CodingToolEffect[] {
  const normalized = String(command || '').trim();
  if (!normalized) throw new Error('coding-terminal-effects:missing-command');
  return [
    'process',
    ...(NETWORK_EFFECT_RE.test(normalized) ? ['network' as const] : []),
    ...(WORKSPACE_MUTATION_RE.test(normalized) ? ['workspace-mutation' as const] : []),
  ];
}
