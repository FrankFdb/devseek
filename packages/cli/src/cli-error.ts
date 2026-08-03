export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error && typeof error === 'object' && 'cause' in error
    ? (error as { cause?: unknown }).cause
    : undefined;
  if (!cause) return message;

  const causeMessage = cause instanceof Error ? cause.message : String(cause);
  const causeCode = cause && typeof cause === 'object' && 'code' in cause
    ? String((cause as { code?: unknown }).code)
    : '';
  return [message, causeCode, causeMessage].filter(Boolean).join(' ');
}
