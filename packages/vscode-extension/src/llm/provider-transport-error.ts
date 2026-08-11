const NON_TRANSPORT_FAILURE = /\b(?:aborterror|cancelled|canceled|login[_ -]?required|captcha|verification)\b|验证码|安全验证|(?:http\s*)?429|rate[- ]?limit/i;
const TRANSIENT_TRANSPORT_FAILURE = /\b(?:econnreset|econnrefused|econnaborted|epipe|enotfound|etimedout|und_err_socket|und_err_connect_timeout|und_err_headers_timeout)\b|fetch failed|socket hang up|network error|bridge_connector_unavailable|connection (?:reset|refused|closed|lost)|(?:bridge|socket) disconnected/i;

export function providerErrorText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();

  const visit = (value: unknown, depth: number): void => {
    if (value === undefined || value === null || depth > 4 || seen.has(value)) return;
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
      return;
    }
    if (typeof value !== 'object') return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    for (const key of ['name', 'message', 'code']) visit(record[key], depth + 1);
    visit(record.cause, depth + 1);
  };

  visit(error, 0);
  return parts.join('\n');
}

export function isTransientProviderTransportError(error: unknown): boolean {
  const text = providerErrorText(error);
  if (!text || NON_TRANSPORT_FAILURE.test(text)) return false;
  return TRANSIENT_TRANSPORT_FAILURE.test(text);
}
