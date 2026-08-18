#include "deployment_coordinator.hpp"

#include <cassert>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

using namespace devseek_case;

class HiddenSleeper final : public Sleeper {
 public:
  void sleepFor(std::int64_t delay) override { delays.push_back(delay); }
  std::vector<std::int64_t> delays;
};

int main() {
  DeploymentCoordinator coordinator;
  coordinator.addJob({{"blocked", 20, {}}, {{"gpu", 2}}, {1, 0, 1.0, 0}});
  coordinator.addJob({{"independent", 10, {}}, {}, {2, 2, 1.0, 2}});
  coordinator.addJob({{"downstream", 100, {"blocked"}}, {}, {1, 0, 1.0, 0}});

  const auto beforeInvalid = coordinator.preview();
  bool invalid = false;
  try {
    coordinator.addJob({{"bad-resource", 1, {}}, {{"", 1}}, {1, 0, 1.0, 0}});
  } catch (const std::invalid_argument&) {
    invalid = true;
  }
  assert(invalid);
  assert(coordinator.preview() == beforeInvalid);

  invalid = false;
  try {
    coordinator.addJob({{"independent", 99, {}}, {}, {1, 0, 1.0, 0}});
  } catch (const std::invalid_argument&) {
    invalid = true;
  }
  assert(invalid);
  assert(coordinator.preview() == beforeInvalid);

  invalid = false;
  try {
    coordinator.addJob({{"bad-retry", 1, {}}, {}, {0, 0, 1.0, 0}});
  } catch (const std::invalid_argument&) {
    invalid = true;
  }
  assert(invalid);
  assert(coordinator.preview() == beforeInvalid);

  InventoryService inventory;
  inventory.setStock("gpu", 1);
  RetryExecutor retries;
  HiddenSleeper sleeper;
  EventBus events;
  std::vector<std::string> started;
  events.subscribe("job.started", [&](const std::string& payload) { started.push_back(payload); });
  events.subscribe("job.succeeded", [](const std::string&) {
    throw std::runtime_error("observer unavailable");
  });

  std::vector<std::string> calls;
  const auto result = coordinator.execute(
      inventory, retries, sleeper, events,
      [&](const std::string& id, std::size_t attempt) {
        calls.push_back(id + ":" + std::to_string(attempt));
        if (id == "independent" && attempt == 1) {
          return AttemptDecision::RetryableFailure;
        }
        return AttemptDecision::Success;
      });

  assert(result.states.at("blocked") == DeploymentState::Blocked);
  assert(result.states.at("downstream") == DeploymentState::Blocked);
  assert(result.states.at("independent") == DeploymentState::Succeeded);
  assert(result.attempts.at("blocked") == 0);
  assert(result.attempts.at("downstream") == 0);
  assert(result.attempts.at("independent") == 2);
  assert((calls == std::vector<std::string>{"independent:1", "independent:2"}));
  assert(started.size() == 1);
  assert(started.front() == "id=independent;attempt=1");
  assert((sleeper.delays == std::vector<std::int64_t>{2}));
  assert(result.eventFailures.size() == 1);
  assert(result.eventFailures.front().find("event=job.succeeded;id=independent") == 0);
  assert(inventory.available("gpu") == 1);

  DeploymentCoordinator throwing;
  throwing.addJob({{"throws", 1, {}}, {{"gpu", 1}}, {2, 1, 1.0, 1}});
  const auto thrown = throwing.execute(
      inventory, retries, sleeper, events,
      [](const std::string&, std::size_t) -> AttemptDecision {
        throw std::runtime_error("operation crashed");
      });
  assert(thrown.states.at("throws") == DeploymentState::Failed);
  assert(thrown.attempts.at("throws") == 1);
  assert(inventory.available("gpu") == 1);

  std::cout << "T6_MEDIUM_HIDDEN_PASSED\n";
  return 0;
}
