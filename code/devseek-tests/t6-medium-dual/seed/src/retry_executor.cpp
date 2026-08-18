#include "retry_executor.hpp"
#include <cmath>
#include <stdexcept>
#include <limits>

namespace devseek_case {

namespace {
// 验证策略合法性
void validatePolicy(const RetryPolicy& policy) {
    if (policy.maxAttempts < 1) {
        throw std::invalid_argument("maxAttempts must be >= 1");
    }
    if (policy.initialDelayMs < 0) {
        throw std::invalid_argument("initialDelayMs must be >= 0");
    }
    if (!std::isfinite(policy.multiplier) || policy.multiplier < 1.0) {
        throw std::invalid_argument("multiplier must be finite and >= 1");
    }
    if (policy.maxDelayMs < policy.initialDelayMs) {
        throw std::invalid_argument("maxDelayMs must be >= initialDelayMs");
    }
}

// 计算第 retryIndex 次重试的延迟（retryIndex 从 0 开始）
std::int64_t calculateDelay(const RetryPolicy& policy, std::size_t retryIndex) {
    // 检查溢出：使用 long double 进行安全计算
    long double delay = static_cast<long double>(policy.initialDelayMs);
    long double multiplier = static_cast<long double>(policy.multiplier);

    // 计算 initialDelayMs * multiplier^retryIndex
    long double result = delay * std::pow(multiplier, static_cast<long double>(retryIndex));

    // 检查是否溢出或无穷
    if (!std::isfinite(result) || result > static_cast<long double>(std::numeric_limits<std::int64_t>::max())) {
        return policy.maxDelayMs;  // 溢出时直接封顶
    }

    // 四舍五入转为整数
    std::int64_t rounded = static_cast<std::int64_t>(std::llround(result));

    // 封顶到 maxDelayMs
    if (rounded > policy.maxDelayMs) {
        return policy.maxDelayMs;
    }
    return rounded;
}
}  // anonymous namespace

RetryOutcome RetryExecutor::run(const RetryPolicy& policy,
                                const std::function<AttemptDecision(std::size_t)>& operation,
                                Sleeper& sleeper) const {
    // 1. 验证策略
    validatePolicy(policy);

    // 2. 执行循环
    RetryOutcome outcome;
    outcome.success = false;
    outcome.attempts = 0;
    outcome.delays.clear();

    for (std::size_t attempt = 1; attempt <= policy.maxAttempts; ++attempt) {
        // 调用 operation，传入从 1 开始的 attempt 编号
        AttemptDecision decision = operation(attempt);
        outcome.attempts = attempt;

        if (decision == AttemptDecision::Success) {
            outcome.success = true;
            break;
        } else if (decision == AttemptDecision::PermanentFailure) {
            outcome.success = false;
            break;
        } else {  // AttemptDecision::RetryableFailure
            // 检查是否还有下一次重试机会
            if (attempt == policy.maxAttempts) {
                // 没有下一次了，循环结束
                break;
            }

            // 计算当前重试的延迟（retryIndex = attempt - 1，因为第一次失败后重试的索引为0）
            std::int64_t delayMs = calculateDelay(policy, attempt - 1);
            outcome.delays.push_back(delayMs);

            // 调用 Sleeper
            sleeper.sleepFor(delayMs);
        }
    }

    return outcome;
}
}  // namespace devseek_case
