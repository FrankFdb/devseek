import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'devseek-independent-review-'));
const bundlePath = path.join(tempRoot, 'independent-requirement-review.cjs');

execSync(
  `npx esbuild src/agent/independent-requirement-review.ts --bundle ` +
  `--outfile=${bundlePath} --format=cjs --platform=node`,
  { cwd: rootDir, stdio: 'pipe' },
);

const {
  IndependentRequirementReviewer,
  parseIndependentReviewResponse,
} = createRequire(import.meta.url)(bundlePath);

after(() => rmSync(tempRoot, { recursive: true, force: true }));

function snapshot(relativePath, content) {
  return {
    path: relativePath,
    absolutePath: path.join('/workspace', relativePath),
    content,
    lineCount: content.split('\n').length,
  };
}

function response(body, toolCount = 0) {
  return { text: JSON.stringify(body), toolCount };
}

function requirementCheck(requirementId, requirementQuote, status = 'satisfied') {
  const rejectionEvidence = 'Scenario invalid/duplicate input: second submit of id A or negative capacity reaches line 1 and throws std::invalid_argument as a caller-observable failure, distinct from valid no-op success.';
  return {
    requirement_id: requirementId,
    requirement_quote: requirementQuote,
    status,
    evidence: /reject|invalid|duplicate|already-used|negative|拒绝|非法|重复|已使用/i.test(requirementQuote)
      ? rejectionEvidence
      : 'src/order_book.cpp:1 follows the traced execution path.',
  };
}

function finding(source, requirementQuote, overrides = {}) {
  return {
    requirement_id: 'R1',
    requirement_quote: requirementQuote,
    title: 'Expose invalid input to the caller',
    observed_behavior: 'The invalid branch returns the same empty result as a valid no-trade submission.',
    expected_behavior: 'The invalid branch must expose rejection through the unchanged public API.',
    counterexample: 'Submitting an empty id and a valid non-crossing order both return an empty trade list, so the caller cannot distinguish rejection.',
    priority: 1,
    confidence_score: 0.99,
    code_location: {
      absolute_file_path: source.absolutePath,
      line_range: { start: 1, end: 1 },
    },
    ...overrides,
  };
}

test('strict review parser accepts an evidenced failing finding', () => {
  const source = snapshot('src/order_book.cpp', 'line one\nline two');
  const prompt = 'Reject duplicate or already-used ids.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [finding(source, prompt, {
      title: 'Preserve used identifiers',
      observed_behavior: 'The implementation erases completed ids and accepts them again.',
      expected_behavior: 'Completed and cancelled ids must remain rejected as already used.',
      counterexample: 'Submit id A, complete it, then submit id A again; the second submission is accepted instead of rejected.',
      code_location: {
        absolute_file_path: source.absolutePath,
        line_range: { start: 2, end: 2 },
      },
    })],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'A required state invariant is lost after completion.',
    overall_confidence_score: 0.99,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings[0].requirementId, 'R1');
  assert.equal(decision.findings[0].path, 'src/order_book.cpp');
  assert.equal(decision.findings[0].line, 2);
});

test('strict review parser treats minimal program wording as creation scope, not ordering trace', () => {
  const source = snapshot('controlled-hello.cpp', [
    '#include <iostream>',
    '',
    'int main() {',
    '  std::cout << "下午好" << std::endl;',
    '  return 0;',
    '}',
    '',
  ].join('\n'));
  const prompt = '请在当前工作区编写一个最小 C++ 程序 controlled-hello.cpp，运行后打印下午好。必须用 g++ 编译并运行验证输出后结束，不要修改其他文件。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'controlled-hello.cpp:1-6 defines main(), prints 下午好 on the requested execution path, and the validation fact says g++ -std=c++17 -fsyntax-only controlled-hello.cpp exit-0.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The final source and validation fact satisfy the requested minimal C++ program.',
    overall_confidence_score: 0.98,
  }), [source], prompt);

  assert.equal(decision.status, 'passed');
});

test('strict review parser treats obvious bug wording as repair scope, not error-path evidence', () => {
  const source = snapshot('src/math.js', [
    'function add(a, b) {',
    '  return a + b;',
    '}',
    'module.exports = { add };',
    '',
  ].join('\n'));
  const prompt = '请修复 src/math.js 中 add(a, b) 的明显错误。要求 add(2, 3) 返回 5，修改后用 node 命令验证并结束任务。不要修改其他文件。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'src/math.js:1 final source snapshot and the validation fact cover add(2, 3) returning 5.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The final source and validation fact satisfy the requested add repair.',
    overall_confidence_score: 0.98,
  }), [source], prompt);

  assert.equal(decision.status, 'passed');
});

test('strict review parser treats ERROR and WARN as domain tokens, not failure-path requirements', () => {
  const source = snapshot('tools/log_summary.py', [
    'import sys',
    '',
    'def main():',
    '    lines = sys.stdin.read().splitlines()',
    '    errors = sum(1 for line in lines if "ERROR" in line)',
    '    warns = sum(1 for line in lines if "WARN" in line)',
    '    print(f"ERROR={errors} WARN={warns}")',
    '',
    'if __name__ == "__main__":',
    '    main()',
    '',
  ].join('\n'));
  const prompt = '我在真实项目里需要一个小 Python 命令行工具 tools/log_summary.py。它从 stdin 读取日志文本，统计包含 ERROR 和 WARN 的行数，输出格式先用 ERROR=<n> WARN=<n>。请实现最小版本并用 python 命令自测；不要引入依赖，不要改其他文件。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'tools/log_summary.py:1 final source snapshot and the validation fact cover stdin counting with ERROR=1 WARN=1.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The final source and validation fact satisfy the requested log summary format.',
    overall_confidence_score: 0.98,
  }), [source], prompt);

  assert.equal(decision.status, 'passed');
});

test('strict review parser rejects a mixed trustworthy and malformed verdict', () => {
  const source = snapshot('src/order_book.cpp', 'return empty_trades;\nthrow invalid_order;');
  const prompt = 'submit rejects invalid input.';
  const validFinding = finding(source, prompt);
  const malformedFinding = {
    ...validFinding,
    title: 'Unsupported priority',
    priority: 5,
  };
  const failed = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [validFinding],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'One caller-visible contract is missing.',
    overall_confidence_score: 0.98,
  }), [source], prompt);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.findings.length, 1);

  const mixed = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [validFinding, malformedFinding],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'The response contains an untrusted sibling finding.',
    overall_confidence_score: 0.9,
  }), [source], prompt);
  assert.equal(mixed.status, 'indeterminate');
});

test('strict review parser preserves actionable findings when check statuses are inconsistent', () => {
  const source = snapshot('src/order_book.cpp', 'used_ids.erase(id);\nreturn accepted;\n');
  const prompt = 'Keep the public API unchanged.\nReject duplicate or already-used ids.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [
      requirementCheck('R1', 'Keep the public API unchanged.'),
      requirementCheck('R2', 'Reject duplicate or already-used ids.'),
    ],
    findings: [finding(source, 'Reject duplicate or already-used ids.', {
      requirement_id: 'R2',
      title: 'Preserve used identifiers after completion',
      observed_behavior: 'The implementation erases completed ids and accepts them again.',
      expected_behavior: 'Already-used identifiers must remain rejected after completion or cancellation.',
      counterexample: 'Submit id A, complete A, then submit A again; the second submit is accepted instead of rejected.',
      code_location: {
        absolute_file_path: source.absolutePath,
        line_range: { start: 1, end: 1 },
      },
    })],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'The review table forgot to mark R2 violated, but the finding has a concrete counterexample.',
    overall_confidence_score: 0.98,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.explanation, /findings 不完全一致/);
  assert.equal(decision.findings[0].requirementId, 'R2');
  assert.match(decision.findings[0].counterexample, /submit A again/);
});

test('strict review parser preserves actionable findings when the check table is malformed', () => {
  const source = snapshot('src/order_book.cpp', 'idToEntry_.erase(id);\nreturn accepted;\n');
  const prompt = 'Keep the public API unchanged.\nReject duplicate or already-used ids.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [
      requirementCheck('R1', 'Keep the public API unchanged.'),
    ],
    findings: [
      finding(source, 'Reject duplicate or already-used ids.', {
        requirement_id: 'R2',
        title: 'Preserve used identifiers after completion',
        observed_behavior: 'Completed identifiers are erased from the active index and accepted again.',
        expected_behavior: 'Already-used identifiers must remain rejected after completion or cancellation.',
        counterexample: 'Submit id A, complete A, then submit A again; the second submit is accepted instead of rejected.',
        code_location: {
          absolute_file_path: source.absolutePath,
          line_range: { start: 1, end: 1 },
        },
      }),
      finding(source, 'Reject duplicate or already-used ids.', {
        requirement_id: 'R2',
        title: 'Speculative sibling',
        observed_behavior: 'The implementation might be wrong under some path.',
        expected_behavior: 'Maybe a different behavior is needed.',
        counterexample: 'Possibly this could fail.',
      }),
    ],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'The check table is incomplete, but the finding is grounded.',
    overall_confidence_score: 0.98,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.explanation, /未逐条覆盖需求清单/);
  assert.equal(decision.findings[0].requirementId, 'R2');
  assert.match(decision.findings[0].observedBehavior, /active index/);
});

test('strict review parser passes only an exact no-finding verdict', () => {
  const source = snapshot('src/cache.cpp', 'int cache = 0;');
  const prompt = 'Keep the cache initialized.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt)],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'Every stated invariant is represented in the final source.',
    overall_confidence_score: 0.95,
  }), [source], prompt);
  assert.equal(decision.status, 'passed');

  assert.equal(parseIndependentReviewResponse({
    text: 'looks good',
    toolCount: 0,
  }, [source], prompt).status, 'indeterminate');
  assert.equal(parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt)],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'No issue.',
    overall_confidence_score: 0.8,
  }, 1), [source], prompt).status, 'indeterminate');
});

test('strict review parser falls back to local price-priority checks when reviewer requests tools', () => {
  const header = snapshot('include/order_book.hpp', [
    '#include "order_book.hpp"',
    '#include <map>',
    'namespace devseek_case {',
    'struct PriceLevel {};',
    'using PriceLevels = std::map<double, PriceLevel>;',
    'class OrderBook {',
    '  PriceLevels bids_;',
    '  PriceLevels asks_;',
    '};',
    '}',
  ].join('\n'));
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    'namespace devseek_case {',
    'std::vector<Trade> OrderBook::match(Order* incoming) {',
    '  auto& opponent_levels = (incoming->side == Side::Buy) ? asks_ : bids_;',
    '  while (!opponent_levels.empty()) {',
    '    auto it = opponent_levels.begin();',
    '    return makeTrade(*it);',
    '  }',
    '  return {};',
    '}',
    '}',
  ].join('\n'));
  const prompt = '成交价使用 resting order 价格，遵循价格优先、同价时间优先；卖单必须先撮合最高买价。';
  const decision = parseIndependentReviewResponse({
    text: JSON.stringify({
      requirement_checks: [requirementCheck('R1', prompt)],
      findings: [],
      overall_correctness: 'patch is correct',
      overall_explanation: 'The order book is correct.',
      overall_confidence_score: 0.95,
    }),
    toolCount: 1,
  }, [header, source], prompt);

  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings[0].path, 'src/order_book.cpp');
  assert.match(decision.explanation, /本地最终源码合约/);
  assert.match(decision.findings[0].title, /highest bid/);
  assert.match(decision.findings[0].counterexample, /b2@11/);
});

test('strict review parser cross-checks price priority when reviewer misses it', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <map>',
    'namespace devseek_case {',
    'struct PriceLevel {};',
    'class OrderBook {',
    '  std::map<double, PriceLevel> bids_;',
    '  std::map<double, PriceLevel> asks_;',
    '  std::vector<Trade> match(Order* incoming) {',
    '    auto& opponent_levels = (incoming->side == Side::Buy) ? asks_ : bids_;',
    '    while (!opponent_levels.empty()) {',
    '      auto it = opponent_levels.begin();',
    '      return makeTrade(*it);',
    '    }',
    '    return {};',
    '  }',
    '};',
    '}',
  ].join('\n'));
  const prompt = '成交价使用 resting order 价格，遵循价格优先、同价时间优先；卖单必须先撮合最高买价。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'Trace two price levels: submit b1@10 then b2@11, incoming sell first matches b2; same-price orders preserve FIFO.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The order book is correct.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.explanation, /源码执行路径不一致/);
  assert.match(decision.findings[0].observedBehavior, /lowest eligible bid/);
});

test('strict review parser runs local price-priority checks when review inventory is malformed', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <map>',
    'namespace devseek_case {',
    'struct PriceLevel {};',
    'class OrderBook {',
    '  std::map<double, PriceLevel> bids_;',
    '  std::map<double, PriceLevel> asks_;',
    '  std::vector<Trade> match(Order* incoming) {',
    '    auto& opponent_levels = (incoming->side == Side::Buy) ? asks_ : bids_;',
    '    while (!opponent_levels.empty()) {',
    '      auto it = opponent_levels.begin();',
    '      return makeTrade(*it);',
    '    }',
    '    return {};',
    '  }',
    '};',
    '}',
  ].join('\n'));
  const prompt = '成交价使用 resting order 价格，遵循价格优先、同价时间优先；卖单必须先撮合最高买价。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'WRONG',
      requirement_quote: 'not the original requirement',
      status: 'satisfied',
      evidence: 'looks fine',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The order book is correct.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.explanation, /本地最终源码合约/);
  assert.match(decision.findings[0].title, /highest bid/);
});

test('strict review parser does not flag descending bid maps for price priority', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <map>',
    'namespace devseek_case {',
    'struct PriceLevel {};',
    'class OrderBook {',
    '  std::map<double, PriceLevel, std::greater<double>> bids_;',
    '  std::map<double, PriceLevel> asks_;',
    '  std::vector<Trade> match(Order* incoming) {',
    '    auto& opponent_levels = (incoming->side == Side::Buy) ? asks_ : bids_;',
    '    while (!opponent_levels.empty()) {',
    '      auto it = opponent_levels.begin();',
    '      return makeTrade(*it);',
    '    }',
    '    return {};',
    '  }',
    '};',
    '}',
  ].join('\n'));
  const prompt = '成交价使用 resting order 价格，遵循价格优先、同价时间优先；卖单必须先撮合最高买价。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'Trace two price levels: bids use std::greater<double>, so begin() is the highest bid; same-price orders preserve FIFO.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'Every stated invariant is represented in the final source.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(decision.status, 'passed');
});

test('strict review parser cross-checks state-owned trade identity and bestBid direction', () => {
  const header = snapshot('include/order_book.hpp', [
    '#include <cstdint>',
    '#include <optional>',
    '#include <string>',
    '#include <vector>',
    'namespace devseek_case {',
    'enum class Side { Buy, Sell };',
    'struct Order { std::string id; Side side; double price; std::int64_t quantity; };',
    'struct Trade { std::string incomingId; std::string restingId; double price; std::int64_t quantity; };',
    'class OrderBook {',
    ' public:',
    '  std::vector<Trade> submit(Order order);',
    '  std::optional<double> bestBid() const;',
    '};',
    '}',
  ].join('\n'));
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <map>',
    '#include <queue>',
    'namespace devseek_case {',
    'struct State {',
    '  std::map<double, std::queue<std::string>, std::greater<double>> bids;',
    '};',
    'static State& getState(const OrderBook* book);',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  auto& state = getState(this);',
    '  std::vector<Trade> trades;',
    '  if (order.side == Side::Buy) {',
    '    return trades;',
    '  } else {',
    '    auto bidIt = state.bids.begin();',
    '    std::string buyId = bidIt->second.front();',
    '    trades.push_back(Trade{buyId, order.id, bidIt->first, 1});',
    '  }',
    '  return trades;',
    '}',
    'std::optional<double> OrderBook::bestBid() const {',
    '  auto& state = getState(this);',
    '  auto it = state.bids.rbegin();',
    '  return it->first;',
    '}',
    '}',
  ].join('\n'));
  const prompt = '卖单与最高买价撮合；返回的 Trade 按实际撮合顺序，quantity 为本次成交量；bestBid 无订单时 nullopt。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt)],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The final source satisfies all order-book requirements.',
    overall_confidence_score: 0.95,
  }), [header, source], prompt);

  assert.equal(decision.status, 'failed');
  const titles = decision.findings.map(item => item.title).join('\n');
  assert.match(titles, /Preserve Trade incoming\/resting identity fields/);
  assert.match(titles, /Report bestBid from the highest bid level/);
});

test('strict review parser trusts throwing validators and reports later local order-book findings', () => {
  const header = snapshot('include/order_book.hpp', [
    '#include <deque>',
    '#include <map>',
    '#include <unordered_map>',
    'namespace devseek_case {',
    'enum class Side { Buy, Sell };',
    'struct OrderEntry { std::string id; std::int64_t quantity; };',
    'using LevelMap = std::map<double, std::deque<OrderEntry>>;',
    'class OrderBook {',
    '  LevelMap bids_;',
    '  LevelMap asks_;',
    '  std::unordered_map<std::string, std::pair<Side, double>> order_location_;',
    '};',
    '}',
  ].join('\n'));
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <stdexcept>',
    'namespace devseek_case {',
    'static void validate_order(const Order& order,',
    '                           const std::unordered_map<std::string, std::pair<Side, double>>& location) {',
    '  if (order.id.empty()) throw std::invalid_argument("id");',
    '  if (location.find(order.id) != location.end()) throw std::invalid_argument("duplicate");',
    '  if (!std::isfinite(order.price) || order.price <= 0.0) throw std::invalid_argument("price");',
    '  if (order.quantity <= 0) throw std::invalid_argument("quantity");',
    '}',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  validate_order(order, order_location_);',
    '  std::vector<Trade> trades;',
    '  LevelMap* opposing_side = (order.side == Side::Buy) ? &asks_ : &bids_;',
    '  auto it = opposing_side->begin();',
    '  while (it != opposing_side->end()) {',
    '    trades.push_back({order.id, it->second.front().id, it->first, 1});',
    '    break;',
    '  }',
    '  return trades;',
    '}',
    'bool OrderBook::cancel(const std::string& id) {',
    '  order_location_.erase(id);',
    '  return true;',
    '}',
    '}',
  ].join('\n'));
  const rejection = 'submit 拒绝空 id、重复 id、非有限正价格、数量 <= 0。';
  const usedIds = 'submit 拒绝重复或已使用 id。';
  const price = '买单与最低卖价撮合，卖单与最高买价撮合；只在买价 >= 卖价时成交。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [
      {
        requirement_id: 'R1',
        requirement_quote: rejection,
        status: 'satisfied',
        evidence: 'Scenario invalid input: empty id and NaN price both throw std::invalid_argument through validate_order, distinct from a valid empty trade result.',
      },
      {
        requirement_id: 'R2',
        requirement_quote: usedIds,
        status: 'satisfied',
        evidence: 'Scenario already-used id: submit A, cancel A, then submit A again throws std::invalid_argument through a caller-observable failure channel.',
      },
      {
        requirement_id: 'R3',
        requirement_quote: price,
        status: 'satisfied',
        evidence: 'Trace two price levels: submit b1@10 then b2@11; incoming sell first matches b2. Same-price orders preserve FIFO.',
      },
    ],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The order book is correct.',
    overall_confidence_score: 0.95,
  }), [header, source], [rejection, usedIds, price].join('\n'));

  assert.equal(decision.status, 'failed');
  const titles = decision.findings.map(item => item.title);
  assert.doesNotMatch(titles.join('\n'), /Expose invalid submit rejection/);
  assert.match(titles.join('\n'), /Preserve used order identifiers/);
  assert.match(titles.join('\n'), /Match incoming sells against the highest bid first/);
});

test('strict review parser falls back to local source checks for non-json reviewer output', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    'namespace devseek_case {',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  std::vector<Trade> trades;',
    '  if (!valid(order)) return {};',
    '  if (orders_.find(order.id) != orders_.end()) return trades;',
    '  return trades;',
    '}',
    '}',
  ].join('\n'));
  const prompt = 'submit rejects empty id, duplicate or already-used id, non-finite price, and quantity <= 0.';
  const decision = parseIndependentReviewResponse({
    text: 'I need to inspect the source before I can answer.',
    toolCount: 0,
  }, [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.explanation, /严格 JSON/);
  assert.match(decision.findings[0].title, /Expose invalid submit rejection/);
});

test('strict review parser normalizes fenced report-style coverage JSON', () => {
  const source = snapshot('src/cache.cpp', 'int value = 1;\n');
  const prompt = 'Keep value initialized.';
  const body = {
    reviewer: 'devseek-independent-review',
    requirements_coverage: [{
      requirement_id: 'R1',
      requirement_text: prompt,
      status: 'covered',
      evidence: {
        file: 'src/cache.cpp',
        line_range: '1-1',
        behavior: 'value is initialized before use',
      },
    }],
    test_evidence: { exit_code: 0, compiler_warnings: 0 },
    conclusion: 'All requirements are covered by the implementation.',
  };

  const decision = parseIndependentReviewResponse({
    text: `\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``,
    toolCount: 0,
  }, [source], prompt);

  assert.equal(decision.status, 'passed');
});

test('strict review parser rejects report-style coverage when final source self-initializes remaining quantity', () => {
  const header = snapshot('include/order_book.hpp', [
    '#include <cstdint>',
    '#include <string>',
    '#include <unordered_map>',
    '#include <vector>',
    'namespace devseek_case {',
    'enum class Side { Buy, Sell };',
    'struct Order { std::string id; Side side; double price; std::int64_t quantity; };',
    'struct Trade { std::string incomingId; std::string restingId; double price; std::int64_t quantity; };',
    'class OrderBook {',
    '  struct OrderNode { Order order; std::int64_t remaining_qty = 0; };',
    '  std::unordered_map<std::string, OrderNode> orders_;',
    '};',
    '}',
  ].join('\n'));
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    'namespace devseek_case {',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  OrderNode node{std::move(order), node.order.quantity};',
    '  orders_[node.order.id] = std::move(node);',
    '  return {};',
    '}',
    '}',
  ].join('\n'));
  const prompt = '支持部分成交；未成交余量进入订单簿；remaining 对未知或已完成/取消订单返回 0。';
  const body = {
    reviewer: 'devseek-independent-review',
    requirements_coverage: [
      {
        requirement_id: 'R1',
        requirement_text: '支持部分成交',
        status: 'covered',
        evidence: {
          file: 'src/order_book.cpp',
          line_range: '3-6',
          behavior: 'partial fill state is tracked with remaining_qty',
        },
      },
      {
        requirement_id: 'R2',
        requirement_text: '未成交余量进入订单簿',
        status: 'covered',
        evidence: {
          file: 'src/order_book.cpp',
          line_range: '4-5',
          behavior: 'unmatched remaining quantity enters the book',
        },
      },
    ],
    test_evidence: { exit_code: 0, compiler_warnings: 0 },
    conclusion: 'All requirements are covered.',
  };

  const decision = parseIndependentReviewResponse({
    text: `\`\`\`\n${JSON.stringify(body, null, 2)}\n\`\`\``,
    toolCount: 0,
  }, [header, source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.explanation, /源码执行路径不一致/);
  assert.match(decision.findings[0].title, /Initialize remaining quantity/);
  assert.equal(decision.findings[0].path, 'src/order_book.cpp');
  assert.equal(decision.findings[0].line, 4);
});

test('strict review parser requires concrete traces for ordering requirements marked satisfied', () => {
  const source = snapshot('src/order_book.cpp', 'std::map<double, Order> bids;\nmatch(best_bid);\n');
  const prompt = 'Follow price priority and same-price FIFO order.';
  const verdict = evidence => parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence,
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The ordering requirement is satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(verdict('src/order_book.cpp implements the ordering requirement.').status, 'indeterminate');
  assert.equal(verdict('Trace two price levels: submit b1@10 then b2@11, incoming sell first matches b2; same-price b3 then b4 preserves FIFO at lines 1-2.').status, 'passed');
});

test('strict review parser requires caller-observable failure evidence for rejection requirements marked satisfied', () => {
  const source = snapshot('src/order_book.cpp', 'if (!valid(order)) return {};\nthrow std::invalid_argument("bad order");\n');
  const prompt = 'submit rejects empty id, duplicate or already-used id, non-finite price, and quantity <= 0.';
  const verdict = evidence => parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence,
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The rejection requirement is satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(verdict('src/order_book.cpp validates duplicate ids and invalid prices before insertion.').status, 'indeterminate');
  assert.equal(verdict('Scenario duplicate id: submit id A, then submit id A again; line 2 throws std::invalid_argument, a caller-observable failure distinct from an empty valid no-trade result. NaN price follows the same exception path.').status, 'passed');
  assert.equal(verdict('Scenario duplicate id: submit id A, then submit id A again; line 1 returns an empty trades vector.').status, 'indeterminate');
  assert.equal(verdict('Scenario duplicate id: submit id A, then submit id A again; line 1 returns an empty trades vector and leaves the book unchanged, so rejection is caller-observable.').status, 'indeterminate');
});

test('strict review parser cross-checks rejection claims against final C++ source', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    'namespace devseek_case {',
    'static bool isValidOrder(const Order& order) {',
    '  if (order.id.empty()) return false;',
    '  if (order.quantity <= 0) return false;',
    '  if (!std::isfinite(order.price) || order.price <= 0.0) return false;',
    '  return true;',
    '}',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  std::vector<Trade> trades;',
    '  if (!isValidOrder(order)) { return trades; }',
    '  if (order_map_.find(order.id) != order_map_.end()) { return trades; }',
    '  return trades;',
    '}',
    'bool OrderBook::cancel(const std::string& id) {',
    '  auto it = order_map_.find(id);',
    '  if (it == order_map_.end()) return false;',
    '  order_map_.erase(it);',
    '  return true;',
    '}',
    '}',
  ].join('\n'));
  const prompt = 'submit 拒绝空 id、重复或已使用 id、非有限正价格、数量 <= 0。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'Scenario duplicate id: submit id A twice and NaN price both throw std::invalid_argument through a caller-observable rejection branch distinct from valid success.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'All rejection paths are satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.equal(decision.findings[0].requirementId, 'R1');
  assert.match(decision.findings[0].observedBehavior, /empty trade vector/);
  assert.match(decision.findings[0].expectedBehavior, /std::invalid_argument/);
});

test('strict review parser cross-checks PIMPL active-index rejection claims', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <unordered_map>',
    'namespace devseek_case {',
    'class OrderBook::Impl {',
    'public:',
    '  std::unordered_map<std::string, OrderLocation> index_;',
    '  bool hasOrder(const std::string& id) const { return index_.find(id) != index_.end(); }',
    '};',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  std::vector<Trade> trades;',
    '  if (order.id.empty()) return trades;',
    '  if (pimpl_->hasOrder(order.id)) return trades;',
    '  if (!std::isfinite(order.price) || order.price <= 0.0) return trades;',
    '  if (order.quantity <= 0) return trades;',
    '  return trades;',
    '}',
    '}',
  ].join('\n'));
  const prompt = 'submit 拒绝空 id、重复或已使用 id、非有限正价格、数量 <= 0。';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'Scenario duplicate id: submit id A twice and NaN price both throw std::invalid_argument through a caller-observable rejection branch distinct from valid success.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'All rejection paths are satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.findings[0].title, /Expose invalid submit rejection/);
  assert.match(decision.findings[0].observedBehavior, /empty trade vector/);
});

test('strict review parser cross-checks already-used id permanence against final source', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    'namespace devseek_case {',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  if (order_map_.find(order.id) != order_map_.end()) throw std::invalid_argument("duplicate");',
    '  return {};',
    '}',
    'void OrderBook::consume(const std::string& id) {',
    '  order_map_.erase(id);',
    '}',
    '}',
  ].join('\n'));
  const prompt = 'Reject duplicate or already-used ids.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'Scenario already-used id: submit A, complete A, then submit A again throws invalid_argument through a caller-observable failure channel.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The id rejection invariant is satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.findings[0].title, /Preserve used order identifiers/);
  assert.match(decision.findings[0].counterexample, /submit A again/);
});

test('strict review parser cross-checks PIMPL active-index used-id permanence', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <unordered_map>',
    'namespace devseek_case {',
    'class OrderBook::Impl {',
    'public:',
    '  std::unordered_map<std::string, OrderLocation> index_;',
    '  bool hasOrder(const std::string& id) const { return index_.find(id) != index_.end(); }',
    '  void removeOrder(const std::string& id) {',
    '    auto it = index_.find(id);',
    '    if (it == index_.end()) return;',
    '    index_.erase(it);',
    '  }',
    '};',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  if (pimpl_->hasOrder(order.id)) throw std::invalid_argument("duplicate");',
    '  return {};',
    '}',
    'bool OrderBook::cancel(const std::string& id) {',
    '  if (!pimpl_->hasOrder(id)) return false;',
    '  pimpl_->removeOrder(id);',
    '  return true;',
    '}',
    '}',
  ].join('\n'));
  const prompt = 'Reject duplicate or already-used ids.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'Scenario already-used id: submit A, complete A, then submit A again throws invalid_argument through a caller-observable failure channel.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The id rejection invariant is satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.findings[0].title, /Preserve used order identifiers/);
  assert.match(decision.findings[0].counterexample, /active-order index erases A/);
});

test('strict review parser cross-checks entries_ active-index used-id permanence', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <unordered_map>',
    'namespace devseek_case {',
    'class OrderBook::Impl {',
    'public:',
    '  std::unordered_map<std::string, OrderLocation> entries_;',
    '};',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  if (pimpl_->entries_.find(order.id) != pimpl_->entries_.end()) {',
    '    throw std::invalid_argument("duplicate");',
    '  }',
    '  return {};',
    '}',
    'void OrderBook::complete(const std::string& id) {',
    '  pimpl_->entries_.erase(id);',
    '}',
    '}',
  ].join('\n'));
  const prompt = 'Reject duplicate or already-used ids.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [{
      requirement_id: 'R1',
      requirement_quote: prompt,
      status: 'satisfied',
      evidence: 'Scenario already-used id: submit A, complete A, then submit A again throws invalid_argument through a caller-observable failure channel.',
    }],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The id rejection invariant is satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.findings[0].title, /Preserve used order identifiers/);
  assert.equal(decision.findings[0].line, 15);
});

test('strict review parser cross-checks stale remaining after partial fill', () => {
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <list>',
    '#include <map>',
    '#include <unordered_map>',
    'namespace devseek_case {',
    'struct OrderEntry { std::string id; double price; int quantity; };',
    'class OrderBook {',
    '  std::map<double, std::list<OrderEntry>> bids_;',
    '  std::unordered_map<std::string, OrderEntry> orders_;',
    'public:',
    '  int remaining(const std::string& id) const {',
    '    auto it = orders_.find(id);',
    '    return it == orders_.end() ? 0 : it->second.quantity;',
    '  }',
    '  std::vector<Trade> matchSell(Order& order) {',
    '    std::vector<Trade> trades;',
    '    auto levelIt = bids_.begin();',
    '    auto& level = levelIt->second;',
    '    auto entryIt = level.begin();',
    '    int fill = std::min(order.quantity, entryIt->quantity);',
    '    entryIt->quantity -= fill;',
    '    order.quantity -= fill;',
    '    trades.push_back({entryIt->id, order.id, fill, entryIt->price});',
    '    if (entryIt->quantity == 0) {',
    '      orders_.erase(entryIt->id);',
    '      entryIt = level.erase(entryIt);',
    '    } else {',
    '      ++entryIt;',
    '    }',
    '    return trades;',
    '  }',
    '};',
    '}',
  ].join('\n'));
  const prompt = [
    '成交价使用更早进入簿中的 resting order 价格，遵循价格优先、同价时间优先；支持部分成交。',
    '未成交余量进入订单簿；cancel 仅能取消仍有余量的活动订单一次。',
    'bestBid/bestAsk 无订单时 nullopt；remaining 对未知或已完成/取消订单返回 0。',
  ].join('\n');
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [
      {
        requirement_id: 'R1',
        requirement_quote: '成交价使用更早进入簿中的 resting order 价格，遵循价格优先、同价时间优先；支持部分成交。',
        status: 'satisfied',
        evidence: 'Trace two price levels and a partial fill: submit b1@9 quantity 2, then sell s1@9 quantity 1; first match uses the resting price and leaves b1 partially filled.',
      },
      {
        requirement_id: 'R2',
        requirement_quote: '未成交余量进入订单簿；cancel 仅能取消仍有余量的活动订单一次。',
        status: 'satisfied',
        evidence: 'Scenario b1@9 quantity 2 then sell s1@9 quantity 1 leaves one unmatched unit active before cancel.',
      },
      {
        requirement_id: 'R3',
        requirement_quote: 'bestBid/bestAsk 无订单时 nullopt；remaining 对未知或已完成/取消订单返回 0。',
        status: 'satisfied',
        evidence: 'Trace empty book then submit b1@9 and partially match one unit; bestBid and remaining are read after each state transition.',
      },
    ],
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'The partial-fill and remaining invariants are satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.findings[0].title, /Synchronize remaining quantity/);
  assert.match(decision.findings[0].counterexample, /remaining\("b1"\)/);
});

test('strict review parser keeps provider-transcript-polluted review indeterminate', () => {
  const header = snapshot('include/order_book.hpp', [
    '#include <cstdint>',
    '#include <optional>',
    '#include <string>',
    '#include <vector>',
    'namespace devseek_case {',
    'enum class Side { Buy, Sell };',
    'struct Order { std::string id; Side side; double price; std::int64_t quantity; };',
    'struct Trade { std::string incomingId; std::string restingId; double price; std::int64_t quantity; };',
    'class OrderBook {',
    ' public:',
    '  std::vector<Trade> submit(Order order);',
    '  std::optional<double> bestBid() const;',
    '};',
    '}',
  ].join('\n'));
  const source = snapshot('src/order_book.cpp', [
    '#include "order_book.hpp"',
    '#include <stdexcept>',
    'namespace devseek_case {',
    'std::vector<Trade> OrderBook::submit(Order order) {',
    '  if (order.id.empty()) throw std::invalid_argument("id");',
    '  return {Trade{order.id, "resting", 11.0, 1}};',
    '}',
    'std::optional<double> OrderBook::bestBid() const { return 11.0; }',
    '}',
  ].join('\n'));
  const prompt = 'submit 拒绝空 id；返回的 Trade 按实际撮合顺序，quantity 为本次成交量。';
  const decision = parseIndependentReviewResponse({
    text: '[DevSeek 已执行工具请求摘要]\n[工具结果 Round 7]\nread_file output...\n[task_complete: summary="done"]',
    toolCount: 0,
  }, [header, source], prompt);

  assert.equal(decision.status, 'indeterminate');
  assert.equal('hostClearable' in decision, false);
});

test('strict review parser rejects self-negating and unreachable pseudo-findings', () => {
  const source = snapshot('src/order_book.cpp', 'int value = 0;');
  const prompt = 'Keep iterators valid.';
  const result = item => parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [item],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'A claimed iterator defect needs repair.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(result(finding(source, prompt, {
    title: 'Iterator concern',
    observed_behavior: 'The next loop obtains a fresh iterator, so this is correct. No defect.',
  })).status, 'indeterminate');
  assert.equal(result(finding(source, prompt, {
    title: 'Impossible stale state',
    counterexample: 'This would require inconsistent state, which should never happen. There is no reachable path in the supplied source.',
  })).status, 'indeterminate');
  assert.equal(result(finding(source, prompt, {
    title: 'Low confidence guess',
    confidence_score: 0.2,
  })).status, 'indeterminate');
});

test('strict review parser rejects findings that reverse rejection or restrictive semantics', () => {
  const source = snapshot('src/order_book.cpp', 'used_ids.insert(id);');
  const usedIdPrompt = 'Reject duplicate or already-used ids.';
  const result = (prompt, item) => parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [item],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'A requirement is violated.',
    overall_confidence_score: 0.99,
  }), [source], prompt);

  assert.equal(result(usedIdPrompt, finding(source, usedIdPrompt, {
    title: 'Allow reuse after cancellation',
    observed_behavior: 'The used id remains rejected after cancellation.',
    expected_behavior: 'Completed or cancelled identifiers should be reused and accepted.',
    counterexample: 'Cancel id A and submit A again; rejection occurs although reuse should be allowed.',
  })).status, 'indeterminate');
  assert.equal(result(usedIdPrompt, finding(source, usedIdPrompt, {
    title: 'Preserve used identifiers',
    observed_behavior: 'Erasing the set accepts an already-used id after cancellation.',
    expected_behavior: 'Already-used ids must remain rejected after cancellation.',
    counterexample: 'Submit and cancel id A, then submit A again; the second submission is accepted instead of rejected.',
  })).status, 'failed');

  const cancelPrompt = 'cancel only succeeds for active orders with remaining quantity greater than zero.';
  assert.equal(result(cancelPrompt, finding(source, cancelPrompt, {
    title: 'Cancel exhausted orders',
    observed_behavior: 'The method returns false for an exhausted order.',
    expected_behavior: 'Cancellation should still succeed even when remaining quantity is zero.',
    counterexample: 'Fully fill id A, then cancel A; false is returned although zero-remaining cancellation should succeed.',
  })).status, 'indeterminate');
});

test('strict review parser preserves a concrete caller-observable rejection defect', () => {
  const source = snapshot('src/order_book.cpp', 'if (!valid(order)) return {};');
  const prompt = 'submit rejects invalid orders.';
  const decision = parseIndependentReviewResponse(response({
    requirement_checks: [requirementCheck('R1', prompt, 'violated')],
    findings: [finding(source, prompt)],
    overall_correctness: 'patch is incorrect',
    overall_explanation: 'Invalid input has no caller-observable rejection channel.',
    overall_confidence_score: 0.99,
  }), [source], prompt);

  assert.equal(decision.status, 'failed');
  assert.match(decision.findings[0].counterexample, /cannot distinguish rejection/);
});

test('strict review parser requires complete ordered checks and exact requirement quotes', () => {
  const source = snapshot('src/cache.cpp', 'int cache = 0;');
  const prompt = 'Behavior requirements:\n- Keep the cache initialized.\n- Reject negative capacity.';
  const validChecks = [
    requirementCheck('R1', 'Keep the cache initialized.'),
    requirementCheck('R2', 'Reject negative capacity.'),
  ];
  const verdict = checks => parseIndependentReviewResponse(response({
    requirement_checks: checks,
    findings: [],
    overall_correctness: 'patch is correct',
    overall_explanation: 'Both requirements are satisfied.',
    overall_confidence_score: 0.95,
  }), [source], prompt);

  assert.equal(verdict(validChecks).status, 'passed');
  assert.equal(verdict(validChecks.slice(0, 1)).status, 'indeterminate');
  assert.equal(verdict([
    validChecks[0],
    requirementCheck('R2', 'Allow negative capacity.'),
  ]).status, 'indeterminate');
});

test('independent reviewer receives original requirements and final line-numbered source only', async () => {
  const workspace = path.join(tempRoot, 'workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/order_book.cpp'), 'return empty_trades;\nused_ids.erase(id);\n');
  const invocations = [];
  const reviewer = new IndependentRequirementReviewer(async messages => {
    invocations.push(messages);
    return response({
      requirement_checks: [requirementCheck('R1', 'Reject duplicate or already-used ids.')],
      findings: [],
      overall_correctness: 'patch is correct',
      overall_explanation: 'No blocking finding.',
      overall_confidence_score: 0.9,
    });
  });

  const decision = await reviewer.review({
    userPrompt: 'Reject duplicate or already-used ids.',
    workspaceRoot: workspace,
    sourcePaths: ['src/order_book.cpp'],
    validationSummary: 'public tests passed',
  });

  assert.equal(decision.status, 'passed');
  assert.equal(invocations.length, 1);
  assert.match(invocations[0][0].content, /fresh|independent|read-only/i);
  assert.match(invocations[0][0].content, /continues after completion or cancellation/);
  assert.match(invocations[0][0].content, /legitimate success can also produce is not rejection/);
  assert.match(invocations[0][0].content, /normal success result can be empty\/no-op/);
  assert.match(invocations[0][0].content, /container traversal direction/);
  assert.match(invocations[0][0].content, /comparator semantics/);
  assert.match(invocations[0][0].content, /exactly one requirement_check for every inventory ID/);
  assert.match(invocations[0][0].content, /every supplied source file/);
  assert.match(invocations[0][0].content, /integer from 0 through 3 only/);
  assert.match(invocations[0][1].content, /Reject duplicate or already-used ids/);
  assert.match(invocations[0][1].content, /\[R1\] Reject duplicate or already-used ids/);
  assert.match(invocations[0][1].content, /1: return empty_trades/);
  assert.match(invocations[0][1].content, /2: used_ids\.erase/);
});

test('independent reviewer retries malformed output and rejects outside-workspace snapshots', async () => {
  const workspace = path.join(tempRoot, 'retry-workspace');
  mkdirSync(path.join(workspace, 'src'), { recursive: true });
  writeFileSync(path.join(workspace, 'src/a.cpp'), 'int a = 1;\n');
  let calls = 0;
  const invocations = [];
  const reviewer = new IndependentRequirementReviewer(async (messages) => {
    invocations.push(messages);
    calls++;
    return { text: 'not json', toolCount: 0 };
  });

  assert.equal((await reviewer.review({
    userPrompt: 'Implement a.',
    workspaceRoot: workspace,
    sourcePaths: ['src/a.cpp'],
  })).status, 'indeterminate');
  assert.equal(calls, 2);
  assert.match(invocations[1].at(-1).content, /previous review was rejected/i);

  calls = 0;
  assert.equal((await reviewer.review({
    userPrompt: 'Read outside.',
    workspaceRoot: workspace,
    sourcePaths: ['/etc/hosts'],
  })).status, 'indeterminate');
  assert.equal(calls, 0);
});
