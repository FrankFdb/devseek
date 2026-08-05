import {
  resolveCodingKernelTaskContract,
  type CodingKernelTaskContract,
} from '@devseek-netai/shared';
export function buildCliCodingKernelTaskContract(
  prompt: string,
  contextFiles: readonly string[],
): CodingKernelTaskContract {
  return resolveCodingKernelTaskContract({ prompt, contextFiles, surface: 'cli' });
}
