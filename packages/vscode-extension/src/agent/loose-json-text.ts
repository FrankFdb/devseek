export function findJsonObjectEnd(text: string, start: number): number {
  return findJsonContainerEnd(text, start, '{', '}');
}

export function findJsonArrayEnd(text: string, start: number): number {
  return findJsonContainerEnd(text, start, '[', ']');
}

function findJsonContainerEnd(
  text: string,
  start: number,
  open: '{' | '[',
  close: '}' | ']',
): number {
  let depth = 0;
  let inString = false;
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (inString) {
      if (character === '\\') cursor += 1;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === open) depth += 1;
    else if (character === close && --depth === 0) return cursor;
  }
  return -1;
}

export function decodeLooseJsonString(value: string): string {
  return value.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_match, escaped: string) => {
    switch (escaped) {
      case '"': return '"';
      case '\\': return '\\';
      case '/': return '/';
      case 'b': return '\b';
      case 'f': return '\f';
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      default: return String.fromCharCode(Number.parseInt(escaped.slice(1), 16));
    }
  });
}
