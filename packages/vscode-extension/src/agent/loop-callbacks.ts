import type { AgentLoopCallbacks } from './loop-types';

/** Copies callback capabilities without collapsing dynamic Kernel-owned getters. */
export function copyAgentLoopCallbacks(
  callbacks: AgentLoopCallbacks,
  overrides: Partial<AgentLoopCallbacks> = {},
): AgentLoopCallbacks {
  return Object.defineProperties(
    {} as AgentLoopCallbacks,
    {
      ...Object.getOwnPropertyDescriptors(callbacks),
      ...Object.getOwnPropertyDescriptors(overrides),
    },
  );
}
