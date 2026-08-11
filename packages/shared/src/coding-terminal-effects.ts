import type { CodingToolEffect } from './coding-conformance';
import { hasTerminalCommandWorkspaceMutation } from './coding-terminal-command-policy';

const NETWORK_EFFECT_RE = /(?:\b(?:curl|wget|ssh|scp|rsync)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|remove|update|upgrade)\b|\b(?:pip|pip3|python3?\s+-m\s+pip)\s+install\b)/iu;

/** Classifies effects from the command itself instead of from a Surface-local tool label. */
export function classifyCodingTerminalEffects(command: string): CodingToolEffect[] {
  const normalized = String(command || '').trim();
  if (!normalized) throw new Error('coding-terminal-effects:missing-command');
  return [
    'process',
    ...(NETWORK_EFFECT_RE.test(normalized) ? ['network' as const] : []),
    ...(hasTerminalCommandWorkspaceMutation(normalized) ? ['workspace-mutation' as const] : []),
  ];
}
