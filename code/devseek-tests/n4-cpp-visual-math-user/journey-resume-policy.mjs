export function selectJourneyRounds(value, count, resumeExisting = false) {
  if (!value) return Array.from({ length: count }, (_, index) => index + 1);
  const selected = [...new Set(value.split(',').map(Number))];
  if (selected.some(round => !Number.isInteger(round) || round < 1 || round > count)) {
    throw new Error(`--rounds must contain values between 1 and ${count}`);
  }
  const ordered = selected.sort((left, right) => left - right);
  const first = ordered[0];
  const consecutive = ordered.every((round, index) => round === first + index);
  if (!consecutive || (!resumeExisting && first !== 1)) {
    throw new Error(resumeExisting
      ? '--rounds must be a consecutive range such as 2,3,4'
      : '--rounds must be a consecutive prefix such as 1,2,3,4');
  }
  return ordered;
}

export function requiredResumePreflightStage(selectedRounds) {
  const first = selectedRounds[0] ?? 1;
  return Math.max(0, first - 1);
}
