/**
 * Restricted evaluator for C++ integer constant expressions.
 *
 * This deliberately implements only the integer subset whose width and
 * behaviour are deterministic in DevSeek's evidence-grounding model:
 *   - int / unsigned int: 32 bits
 *   - long long / unsigned long long: 64 bits
 *
 * Platform-dependent long/unsigned long literals and constructs outside the
 * supported grammar fail closed. No JavaScript Number, eval, or Function
 * semantics participate in evaluation.
 */

export type CppIntegerBitWidth = 32 | 64;

export type CppIntegerTypeName =
  | 'int'
  | 'unsigned int'
  | 'long long'
  | 'unsigned long long';

export type CppIntegerEvaluationErrorCode =
  | 'empty-expression'
  | 'expression-too-large'
  | 'invalid-token'
  | 'invalid-syntax'
  | 'unsupported-literal'
  | 'indeterminate-width'
  | 'integer-overflow'
  | 'division-by-zero'
  | 'invalid-shift';

export interface CppIntegerConstantValue {
  /** Exact mathematical value after applying the selected C++ integer type. */
  value: bigint;
  /** Base-10 representation suitable for stable comparison and persistence. */
  canonicalValue: string;
  bitWidth: CppIntegerBitWidth;
  signed: boolean;
  typeName: CppIntegerTypeName;
}

export interface CppIntegerEvaluationError {
  code: CppIntegerEvaluationErrorCode;
  message: string;
  offset: number;
}

export type CppIntegerConstantEvaluation =
  | ({ ok: true } & CppIntegerConstantValue)
  | { ok: false; error: CppIntegerEvaluationError };

const MAX_EXPRESSION_LENGTH = 4096;
const MAX_TOKENS = 512;
const MAX_OPERATIONS = 256;
const MAX_NESTING_DEPTH = 64;

const INT32_MIN = -(1n << 31n);
const INT32_MAX = (1n << 31n) - 1n;
const UINT32_MAX = (1n << 32n) - 1n;
const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;

interface IntegerType {
  width: CppIntegerBitWidth;
  signed: boolean;
}

interface TypedInteger {
  value: bigint;
  type: IntegerType;
}

type TokenKind = 'literal' | 'operator' | 'left-paren' | 'right-paren' | 'eof';

interface Token {
  kind: TokenKind;
  text: string;
  offset: number;
}

class EvaluationFailure extends Error {
  constructor(
    readonly code: CppIntegerEvaluationErrorCode,
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = 'EvaluationFailure';
  }
}

function fail(
  code: CppIntegerEvaluationErrorCode,
  message: string,
  offset: number,
): never {
  throw new EvaluationFailure(code, message, offset);
}

function isAsciiDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

function isLiteralContinuation(char: string): boolean {
  return /[A-Za-z0-9_']/.test(char);
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let offset = 0;

  const push = (token: Token): void => {
    if (tokens.length >= MAX_TOKENS) {
      fail('expression-too-large', `expression exceeds ${MAX_TOKENS} tokens`, token.offset);
    }
    tokens.push(token);
  };

  while (offset < expression.length) {
    const char = expression[offset];
    if (/\s/.test(char)) {
      offset += 1;
      continue;
    }

    if (isAsciiDigit(char)) {
      const start = offset;
      offset += 1;
      while (offset < expression.length && isLiteralContinuation(expression[offset])) {
        offset += 1;
      }
      push({ kind: 'literal', text: expression.slice(start, offset), offset: start });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const start = offset;
      offset += 1;
      while (offset < expression.length && /[A-Za-z0-9_]/.test(expression[offset])) {
        offset += 1;
      }
      fail(
        'invalid-token',
        `identifiers are not supported: ${expression.slice(start, offset)}`,
        start,
      );
    }

    const pair = expression.slice(offset, offset + 2);
    if (pair === '<<' || pair === '>>') {
      push({ kind: 'operator', text: pair, offset });
      offset += 2;
      continue;
    }

    if (
      pair === '++'
      || pair === '--'
      || pair === '&&'
      || pair === '||'
      || pair === '=='
      || pair === '!='
      || pair === '<='
      || pair === '>='
      || pair === '::'
      || pair === '->'
      || pair === '**'
      || pair === '//'
      || pair === '/*'
    ) {
      fail('invalid-token', `operator ${pair} is not supported`, offset);
    }

    if ('+-*/%~&^|'.includes(char)) {
      push({ kind: 'operator', text: char, offset });
      offset += 1;
      continue;
    }

    if (char === '(') {
      push({ kind: 'left-paren', text: char, offset });
      offset += 1;
      continue;
    }

    if (char === ')') {
      push({ kind: 'right-paren', text: char, offset });
      offset += 1;
      continue;
    }

    fail('invalid-token', `unsupported token ${JSON.stringify(char)}`, offset);
  }

  tokens.push({ kind: 'eof', text: '', offset: expression.length });
  return tokens;
}

const INTEGER_LITERAL_PATTERN = /^(?:(?<hex>0[xX][0-9a-fA-F](?:'?[0-9a-fA-F])*)|(?<binary>0[bB][01](?:'?[01])*)|(?<octal>0(?:'?[0-7])*)|(?<decimal>[1-9](?:'?[0-9])*))(?<suffix>[uU](?:(?:ll|LL)|[lL])?|(?:(?:ll|LL)|[lL])[uU]?)?$/;

function parseIntegerLiteral(token: Token): TypedInteger {
  const match = INTEGER_LITERAL_PATTERN.exec(token.text);
  if (!match?.groups) {
    fail('unsupported-literal', `unsupported integer literal ${token.text}`, token.offset);
  }

  const suffix = (match.groups.suffix || '').toLowerCase();
  const hasUnsignedSuffix = suffix.includes('u');
  const hasLongLongSuffix = suffix.includes('ll');
  const hasSingleLongSuffix = suffix.includes('l') && !hasLongLongSuffix;
  if (hasSingleLongSuffix) {
    fail(
      'indeterminate-width',
      `literal ${token.text} depends on the target width of long`,
      token.offset,
    );
  }

  let value: bigint;
  let isDecimal = false;
  try {
    if (match.groups.hex) {
      value = BigInt(match.groups.hex.replace(/'/g, ''));
    } else if (match.groups.binary) {
      value = BigInt(match.groups.binary.replace(/'/g, ''));
    } else if (match.groups.octal) {
      const digits = match.groups.octal.replace(/'/g, '').slice(1);
      value = digits.length === 0 ? 0n : BigInt(`0o${digits}`);
    } else {
      isDecimal = true;
      value = BigInt(match.groups.decimal.replace(/'/g, ''));
    }
  } catch {
    fail('unsupported-literal', `invalid integer literal ${token.text}`, token.offset);
  }

  if (hasLongLongSuffix) {
    if (hasUnsignedSuffix) {
      if (value > UINT64_MAX) {
        fail('integer-overflow', `${token.text} exceeds unsigned long long`, token.offset);
      }
      return typed(value, 64, false);
    }

    if (isDecimal) {
      if (value > INT64_MAX) {
        fail('integer-overflow', `${token.text} exceeds long long`, token.offset);
      }
      return typed(value, 64, true);
    }

    if (value <= INT64_MAX) {
      return typed(value, 64, true);
    }
    if (value <= UINT64_MAX) {
      return typed(value, 64, false);
    }
    fail('integer-overflow', `${token.text} exceeds 64-bit integer range`, token.offset);
  }

  if (hasUnsignedSuffix) {
    if (value <= UINT32_MAX) {
      return typed(value, 32, false);
    }
    fail(
      'indeterminate-width',
      `literal ${token.text} requires a platform-dependent unsigned long type`,
      token.offset,
    );
  }

  if (isDecimal) {
    if (value <= INT32_MAX) {
      return typed(value, 32, true);
    }
    fail(
      'indeterminate-width',
      `literal ${token.text} does not have a target-independent width`,
      token.offset,
    );
  }

  if (value <= INT32_MAX) {
    return typed(value, 32, true);
  }
  if (value <= UINT32_MAX) {
    return typed(value, 32, false);
  }
  fail(
    'indeterminate-width',
    `literal ${token.text} does not have a target-independent width`,
    token.offset,
  );
}

function typed(value: bigint, width: CppIntegerBitWidth, signed: boolean): TypedInteger {
  return { value, type: { width, signed } };
}

function modulus(width: CppIntegerBitWidth): bigint {
  return 1n << BigInt(width);
}

function unsignedValue(value: bigint, width: CppIntegerBitWidth): bigint {
  const base = modulus(width);
  return ((value % base) + base) % base;
}

function signedMin(width: CppIntegerBitWidth): bigint {
  return width === 32 ? INT32_MIN : INT64_MIN;
}

function signedMax(width: CppIntegerBitWidth): bigint {
  return width === 32 ? INT32_MAX : INT64_MAX;
}

function ensureSignedRange(value: bigint, type: IntegerType, offset: number): bigint {
  if (value < signedMin(type.width) || value > signedMax(type.width)) {
    fail('integer-overflow', `signed ${type.width}-bit integer overflow`, offset);
  }
  return value;
}

function normalizeResult(value: bigint, type: IntegerType, offset: number): TypedInteger {
  return {
    value: type.signed
      ? ensureSignedRange(value, type, offset)
      : unsignedValue(value, type.width),
    type,
  };
}

function convert(value: TypedInteger, target: IntegerType, offset: number): TypedInteger {
  if (!target.signed) {
    return normalizeResult(value.value, target, offset);
  }
  return normalizeResult(value.value, target, offset);
}

function commonType(left: IntegerType, right: IntegerType): IntegerType {
  if (left.signed === right.signed) {
    return {
      width: Math.max(left.width, right.width) as CppIntegerBitWidth,
      signed: left.signed,
    };
  }

  const signedType = left.signed ? left : right;
  const unsignedType = left.signed ? right : left;
  if (unsignedType.width >= signedType.width) {
    return { width: unsignedType.width, signed: false };
  }
  if (signedType.width > unsignedType.width) {
    return { width: signedType.width, signed: true };
  }
  return { width: signedType.width, signed: false };
}

function fromBitPattern(pattern: bigint, type: IntegerType): TypedInteger {
  const raw = unsignedValue(pattern, type.width);
  if (!type.signed) {
    return { value: raw, type };
  }
  const signBit = 1n << BigInt(type.width - 1);
  return {
    value: (raw & signBit) === 0n ? raw : raw - modulus(type.width),
    type,
  };
}

function applyUnary(operator: string, operand: TypedInteger, offset: number): TypedInteger {
  if (operator === '+') {
    return operand;
  }
  if (operator === '-') {
    return normalizeResult(-operand.value, operand.type, offset);
  }
  if (operator === '~') {
    const mask = modulus(operand.type.width) - 1n;
    return fromBitPattern(unsignedValue(operand.value, operand.type.width) ^ mask, operand.type);
  }
  return fail('invalid-syntax', `unsupported unary operator ${operator}`, offset);
}

function applyShift(
  operator: '<<' | '>>',
  left: TypedInteger,
  right: TypedInteger,
  offset: number,
): TypedInteger {
  if (right.value < 0n || right.value >= BigInt(left.type.width)) {
    fail(
      'invalid-shift',
      `shift count must be between 0 and ${left.type.width - 1}`,
      offset,
    );
  }
  const count = right.value;

  if (operator === '<<') {
    if (left.type.signed && left.value < 0n) {
      fail('invalid-shift', 'left shift of a negative signed value is not supported', offset);
    }
    return normalizeResult(left.value << count, left.type, offset);
  }

  if (left.type.signed && left.value < 0n) {
    fail(
      'invalid-shift',
      'right shift of a negative signed value has version-dependent C++ semantics',
      offset,
    );
  }
  return normalizeResult(left.value >> count, left.type, offset);
}

function applyBinary(
  operator: string,
  originalLeft: TypedInteger,
  originalRight: TypedInteger,
  offset: number,
): TypedInteger {
  if (operator === '<<' || operator === '>>') {
    return applyShift(operator, originalLeft, originalRight, offset);
  }

  const type = commonType(originalLeft.type, originalRight.type);
  const left = convert(originalLeft, type, offset);
  const right = convert(originalRight, type, offset);

  if ((operator === '/' || operator === '%') && right.value === 0n) {
    fail('division-by-zero', 'integer division or remainder by zero', offset);
  }
  if (
    (operator === '/' || operator === '%')
    && type.signed
    && left.value === signedMin(type.width)
    && right.value === -1n
  ) {
    fail('integer-overflow', `signed ${type.width}-bit division overflow`, offset);
  }

  switch (operator) {
    case '+':
      return normalizeResult(left.value + right.value, type, offset);
    case '-':
      return normalizeResult(left.value - right.value, type, offset);
    case '*':
      return normalizeResult(left.value * right.value, type, offset);
    case '/':
      return normalizeResult(left.value / right.value, type, offset);
    case '%':
      return normalizeResult(left.value % right.value, type, offset);
    case '&':
      return fromBitPattern(
        unsignedValue(left.value, type.width) & unsignedValue(right.value, type.width),
        type,
      );
    case '^':
      return fromBitPattern(
        unsignedValue(left.value, type.width) ^ unsignedValue(right.value, type.width),
        type,
      );
    case '|':
      return fromBitPattern(
        unsignedValue(left.value, type.width) | unsignedValue(right.value, type.width),
        type,
      );
    default:
      return fail('invalid-syntax', `unsupported binary operator ${operator}`, offset);
  }
}

class Parser {
  private index = 0;
  private operations = 0;
  private nestingDepth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): TypedInteger {
    const result = this.parseBitwiseOr();
    const trailing = this.current();
    if (trailing.kind !== 'eof') {
      fail('invalid-syntax', `unexpected token ${trailing.text}`, trailing.offset);
    }
    return result;
  }

  private current(): Token {
    return this.tokens[this.index];
  }

  private advance(): Token {
    const token = this.current();
    this.index += 1;
    return token;
  }

  private consumeOperator(operator: string): Token | undefined {
    const token = this.current();
    if (token.kind === 'operator' && token.text === operator) {
      return this.advance();
    }
    return undefined;
  }

  private countOperation(offset: number): void {
    this.operations += 1;
    if (this.operations > MAX_OPERATIONS) {
      fail('expression-too-large', `expression exceeds ${MAX_OPERATIONS} operations`, offset);
    }
  }

  private enterNesting(offset: number): void {
    this.nestingDepth += 1;
    if (this.nestingDepth > MAX_NESTING_DEPTH) {
      fail(
        'expression-too-large',
        `expression exceeds nesting depth ${MAX_NESTING_DEPTH}`,
        offset,
      );
    }
  }

  private parseBitwiseOr(): TypedInteger {
    let left = this.parseBitwiseXor();
    for (;;) {
      const operator = this.consumeOperator('|');
      if (!operator) {
        return left;
      }
      this.countOperation(operator.offset);
      left = applyBinary('|', left, this.parseBitwiseXor(), operator.offset);
    }
  }

  private parseBitwiseXor(): TypedInteger {
    let left = this.parseBitwiseAnd();
    for (;;) {
      const operator = this.consumeOperator('^');
      if (!operator) {
        return left;
      }
      this.countOperation(operator.offset);
      left = applyBinary('^', left, this.parseBitwiseAnd(), operator.offset);
    }
  }

  private parseBitwiseAnd(): TypedInteger {
    let left = this.parseShift();
    for (;;) {
      const operator = this.consumeOperator('&');
      if (!operator) {
        return left;
      }
      this.countOperation(operator.offset);
      left = applyBinary('&', left, this.parseShift(), operator.offset);
    }
  }

  private parseShift(): TypedInteger {
    let left = this.parseAdditive();
    for (;;) {
      const token = this.current();
      if (token.kind !== 'operator' || (token.text !== '<<' && token.text !== '>>')) {
        return left;
      }
      this.advance();
      this.countOperation(token.offset);
      left = applyBinary(token.text, left, this.parseAdditive(), token.offset);
    }
  }

  private parseAdditive(): TypedInteger {
    let left = this.parseMultiplicative();
    for (;;) {
      const token = this.current();
      if (token.kind !== 'operator' || (token.text !== '+' && token.text !== '-')) {
        return left;
      }
      this.advance();
      this.countOperation(token.offset);
      left = applyBinary(token.text, left, this.parseMultiplicative(), token.offset);
    }
  }

  private parseMultiplicative(): TypedInteger {
    let left = this.parseUnary();
    for (;;) {
      const token = this.current();
      if (
        token.kind !== 'operator'
        || (token.text !== '*' && token.text !== '/' && token.text !== '%')
      ) {
        return left;
      }
      this.advance();
      this.countOperation(token.offset);
      left = applyBinary(token.text, left, this.parseUnary(), token.offset);
    }
  }

  private parseUnary(): TypedInteger {
    const token = this.current();
    if (
      token.kind === 'operator'
      && (token.text === '+' || token.text === '-' || token.text === '~')
    ) {
      this.advance();
      this.countOperation(token.offset);
      this.enterNesting(token.offset);
      try {
        return applyUnary(token.text, this.parseUnary(), token.offset);
      } finally {
        this.nestingDepth -= 1;
      }
    }
    return this.parsePrimary();
  }

  private parsePrimary(): TypedInteger {
    const token = this.current();
    if (token.kind === 'literal') {
      this.advance();
      return parseIntegerLiteral(token);
    }

    if (token.kind === 'left-paren') {
      this.advance();
      this.enterNesting(token.offset);
      try {
        const value = this.parseBitwiseOr();
        const closing = this.current();
        if (closing.kind !== 'right-paren') {
          fail('invalid-syntax', 'missing closing parenthesis', closing.offset);
        }
        this.advance();
        return value;
      } finally {
        this.nestingDepth -= 1;
      }
    }

    fail(
      'invalid-syntax',
      token.kind === 'eof' ? 'unexpected end of expression' : `unexpected token ${token.text}`,
      token.offset,
    );
  }
}

function typeName(type: IntegerType): CppIntegerTypeName {
  if (type.width === 32) {
    return type.signed ? 'int' : 'unsigned int';
  }
  return type.signed ? 'long long' : 'unsigned long long';
}

/**
 * Evaluates a restricted, target-independent C++ integer constant expression.
 * Unsupported or ambiguous syntax is represented as an explicit failure.
 */
export function evaluateCppIntegerConstant(expression: string): CppIntegerConstantEvaluation {
  if (expression.trim().length === 0) {
    return {
      ok: false,
      error: { code: 'empty-expression', message: 'integer expression is empty', offset: 0 },
    };
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    return {
      ok: false,
      error: {
        code: 'expression-too-large',
        message: `expression exceeds ${MAX_EXPRESSION_LENGTH} characters`,
        offset: MAX_EXPRESSION_LENGTH,
      },
    };
  }

  try {
    const result = new Parser(tokenize(expression)).parse();
    return Object.freeze({
      ok: true as const,
      value: result.value,
      canonicalValue: result.value.toString(10),
      bitWidth: result.type.width,
      signed: result.type.signed,
      typeName: typeName(result.type),
    });
  } catch (error) {
    if (error instanceof EvaluationFailure) {
      return Object.freeze({
        ok: false as const,
        error: Object.freeze({
          code: error.code,
          message: error.message,
          offset: error.offset,
        }),
      });
    }
    return Object.freeze({
      ok: false as const,
      error: Object.freeze({
        code: 'invalid-syntax' as const,
        message: error instanceof Error ? error.message : 'unknown evaluation failure',
        offset: 0,
      }),
    });
  }
}
