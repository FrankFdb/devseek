#pragma once

#include "event_bus.hpp"
#include "inventory.hpp"
#include "job_scheduler.hpp"
#include "retry_executor.hpp"

#include <functional>
#include <map>
#include <string>
#include <unordered_map>
#include <vector>

namespace devseek_case {

struct DeploymentJob {
  JobSpec plan;
  std::vector<ItemRequest> resources;
  RetryPolicy retry;
};

enum class DeploymentState { Pending, Succeeded, Failed, Blocked };

struct DeploymentResult {
  std::vector<std::string> plan;
  std::map<std::string, DeploymentState> states;
  std::map<std::string, std::size_t> attempts;
  std::vector<std::string> eventFailures;
};

using DeploymentOperation =
    std::function<AttemptDecision(const std::string& jobId, std::size_t attempt)>;

class DeploymentCoordinator {
 public:
  void addJob(DeploymentJob job);
  std::vector<std::string> preview() const;

  DeploymentResult execute(InventoryService& inventory,
                           const RetryExecutor& retries,
                           Sleeper& sleeper,
                           EventBus& events,
                           const DeploymentOperation& operation) const;

 private:
  JobScheduler scheduler_;
  std::unordered_map<std::string, DeploymentJob> jobs_;
};

}  // namespace devseek_case
