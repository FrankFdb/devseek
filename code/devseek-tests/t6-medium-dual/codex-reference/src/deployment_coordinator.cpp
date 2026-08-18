#include "deployment_coordinator.hpp"

#include <cmath>
#include <stdexcept>
#include <utility>

namespace devseek_case {
namespace {

void validateJob(const DeploymentJob& job) {
  if (job.plan.id.empty()) throw std::invalid_argument("deployment job id cannot be empty");
  for (const auto& resource : job.resources) {
    if (resource.sku.empty()) throw std::invalid_argument("resource sku cannot be empty");
    if (resource.quantity <= 0) {
      throw std::invalid_argument("resource quantity must be positive");
    }
  }

  const auto& retry = job.retry;
  if (retry.maxAttempts == 0) throw std::invalid_argument("maxAttempts must be positive");
  if (retry.initialDelayMs < 0) throw std::invalid_argument("initialDelayMs cannot be negative");
  if (!std::isfinite(retry.multiplier) || retry.multiplier < 1.0) {
    throw std::invalid_argument("multiplier must be finite and at least one");
  }
  if (retry.maxDelayMs < retry.initialDelayMs) {
    throw std::invalid_argument("maxDelayMs cannot be less than initialDelayMs");
  }
}

void publish(EventBus& events,
             DeploymentResult& result,
             const std::string& event,
             const std::string& jobId,
             const std::string& payload) {
  const auto report = events.publish(event, payload);
  for (const auto& failure : report.failures) {
    result.eventFailures.push_back(
        "event=" + event + ";id=" + jobId + ";error=" + failure);
  }
}

bool dependenciesSucceeded(const DeploymentJob& job, const DeploymentResult& result) {
  for (const auto& dependency : job.plan.dependencies) {
    const auto found = result.states.find(dependency);
    if (found == result.states.end() || found->second != DeploymentState::Succeeded) {
      return false;
    }
  }
  return true;
}

class Reservation final {
 public:
  Reservation(InventoryService& inventory,
              std::string id,
              const std::vector<ItemRequest>& resources)
      : inventory_(inventory), id_(std::move(id)), required_(!resources.empty()) {
    acquired_ = !required_ || inventory_.reserve(id_, resources);
  }

  Reservation(const Reservation&) = delete;
  Reservation& operator=(const Reservation&) = delete;

  ~Reservation() {
    if (required_ && acquired_) inventory_.release(id_);
  }

  bool acquired() const { return acquired_; }

 private:
  InventoryService& inventory_;
  std::string id_;
  bool required_ = false;
  bool acquired_ = false;
};

}  // namespace

void DeploymentCoordinator::addJob(DeploymentJob job) {
  validateJob(job);
  if (jobs_.find(job.plan.id) != jobs_.end()) {
    throw std::invalid_argument("duplicate deployment job id: " + job.plan.id);
  }

  auto nextScheduler = scheduler_;
  auto nextJobs = jobs_;
  nextScheduler.addJob(job.plan);
  nextJobs.emplace(job.plan.id, std::move(job));
  scheduler_ = std::move(nextScheduler);
  jobs_ = std::move(nextJobs);
}

std::vector<std::string> DeploymentCoordinator::preview() const {
  return scheduler_.buildPlan();
}

DeploymentResult DeploymentCoordinator::execute(InventoryService& inventory,
                                                const RetryExecutor& retries,
                                                Sleeper& sleeper,
                                                EventBus& events,
                                                const DeploymentOperation& operation) const {
  if (!operation) throw std::invalid_argument("deployment operation is required");

  DeploymentResult result;
  result.plan = preview();
  for (const auto& id : result.plan) {
    result.states.emplace(id, DeploymentState::Pending);
    result.attempts.emplace(id, 0);
  }

  for (const auto& id : result.plan) {
    const auto& job = jobs_.at(id);
    if (!dependenciesSucceeded(job, result)) {
      result.states[id] = DeploymentState::Blocked;
      publish(events, result, "job.blocked", id, "id=" + id + ";reason=dependency");
      continue;
    }

    Reservation reservation(inventory, "deployment:" + id, job.resources);
    if (!reservation.acquired()) {
      result.states[id] = DeploymentState::Blocked;
      publish(events, result, "job.blocked", id, "id=" + id + ";reason=resource");
      continue;
    }

    publish(events, result, "job.started", id, "id=" + id + ";attempt=1");
    const auto outcome = retries.run(
        job.retry,
        [&](std::size_t attempt) {
          result.attempts[id] = attempt;
          if (attempt > 1) {
            publish(events, result, "job.retry", id,
                    "id=" + id + ";attempt=" + std::to_string(attempt));
          }
          try {
            return operation(id, attempt);
          } catch (...) {
            return AttemptDecision::PermanentFailure;
          }
        },
        sleeper);

    result.states[id] = outcome.success ? DeploymentState::Succeeded
                                        : DeploymentState::Failed;
    const auto terminalEvent = outcome.success ? "job.succeeded" : "job.failed";
    publish(events, result, terminalEvent, id,
            "id=" + id + ";attempts=" + std::to_string(outcome.attempts));
  }
  return result;
}

}  // namespace devseek_case
