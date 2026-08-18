#pragma once
#include <cstddef>
#include <cstdint>
#include <functional>
#include <vector>

namespace devseek_case {
enum class AttemptDecision { Success, RetryableFailure, PermanentFailure };
struct RetryPolicy {
  std::size_t maxAttempts = 1;
  std::int64_t initialDelayMs = 0;
  double multiplier = 1.0;
  std::int64_t maxDelayMs = 0;
};
struct RetryOutcome { bool success; std::size_t attempts; std::vector<std::int64_t> delays; };
class Sleeper { public: virtual ~Sleeper() = default; virtual void sleepFor(std::int64_t milliseconds) = 0; };
class RetryExecutor {
 public:
  RetryOutcome run(const RetryPolicy& policy,
                   const std::function<AttemptDecision(std::size_t)>& operation,
                   Sleeper& sleeper) const;
};
}  // namespace devseek_case
