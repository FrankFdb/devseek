#include "deployment_coordinator.hpp"

#include <stdexcept>
#include <utility>

namespace devseek_case {

void DeploymentCoordinator::addJob(DeploymentJob job) {
  scheduler_.addJob(job.plan);
  jobs_.emplace(job.plan.id, std::move(job));
}

std::vector<std::string> DeploymentCoordinator::preview() const {
  return scheduler_.buildPlan();
}

DeploymentResult DeploymentCoordinator::execute(InventoryService&,
                                                const RetryExecutor&,
                                                Sleeper&,
                                                EventBus&,
                                                const DeploymentOperation&) const {
  DeploymentResult result;
  result.plan = preview();
  for (const auto& id : result.plan) {
    result.states[id] = DeploymentState::Pending;
    result.attempts[id] = 0;
  }
  return result;
}

}  // namespace devseek_case
