export function isNetworkError(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('fetch failed')) return true;
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset')) return true;
  if (msg.includes('etimedout') || msg.includes('socket hang up')) return true;
  if (msg.includes('networkerror') || msg.includes('network error')) return true;
  if (msg.includes('login_required') || msg.includes('response_corrupted:login-required')) return false;
  if (msg.includes('empty_provider_response')) return true;
  if (msg.includes('response_corrupted:empty')) return true;
  if (msg.includes('response_corrupted:rate-limited')) return true;
  if (msg.includes('response_corrupted:unclosed-markdown-fence')) return true;
  if (msg.includes('response_corrupted:incomplete-tool-block')) return true;
  if (msg.includes('response_corrupted:incomplete-assistant-intent')) return true;
  if (e instanceof Error && e.name === 'AbortError' && (msg.includes('timeout') || msg.includes('timed out'))) return true;
  if (msg.includes('http 502') || msg.includes('http 503') || msg.includes('http 504')) return true;
  return false;
}
