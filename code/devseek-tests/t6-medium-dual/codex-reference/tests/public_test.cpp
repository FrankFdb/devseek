#include "deployment_coordinator.hpp"

#include <iostream>
#include <string>
#include <vector>

using namespace devseek_case;

#define CHECK(condition)                                                        \
  do {                                                                          \
    if (!(condition)) {                                                         \
      std::cerr << "check failed: " #condition << " at line " << __LINE__      \
                << '\n';                                                        \
      return 1;                                                                 \
    }                                                                           \
  } while (false)

class RecordingSleeper final : public Sleeper {
 public:
  void sleepFor(std::int64_t milliseconds) override { delays.push_back(milliseconds); }
  std::vector<std::int64_t> delays;
};

int main() {
  DeploymentCoordinator coordinator;
  coordinator.addJob({{"docs", 6, {}}, {{"cpu", 1}}, {1, 0, 1.0, 0}});
  coordinator.addJob({{"prepare", 5, {}}, {{"cpu", 1}}, {1, 0, 1.0, 0}});
  coordinator.addJob({{"compile", 10, {"prepare"}}, {{"cpu", 2}}, {3, 5, 2.0, 20}});
  coordinator.addJob({{"deploy", 7, {"compile"}}, {{"cpu", 1}}, {2, 1, 1.0, 1}});
  coordinator.addJob({{"notify", 100, {"deploy"}}, {}, {1, 0, 1.0, 0}});

  const std::vector<std::string> expectedPlan{
      "docs", "prepare", "compile", "deploy", "notify"};
  CHECK(coordinator.preview() == expectedPlan);
  CHECK(coordinator.preview() == expectedPlan);

  InventoryService inventory;
  inventory.setStock("cpu", 2);
  RetryExecutor retries;
  RecordingSleeper sleeper;
  EventBus events;
  std::vector<std::string> observed;
  for (const auto* name : {"job.started", "job.retry", "job.succeeded",
                           "job.failed", "job.blocked"}) {
    events.subscribe(name, [&, name](const std::string& payload) {
      observed.push_back(std::string(name) + ":" + payload);
    });
  }

  const auto result = coordinator.execute(
      inventory, retries, sleeper, events,
      [](const std::string& id, std::size_t attempt) {
        if (id == "compile" && attempt == 1) return AttemptDecision::RetryableFailure;
        if (id == "deploy") return AttemptDecision::PermanentFailure;
        return AttemptDecision::Success;
      });

  CHECK(result.plan == expectedPlan);
  CHECK(result.states.at("docs") == DeploymentState::Succeeded);
  CHECK(result.states.at("prepare") == DeploymentState::Succeeded);
  CHECK(result.states.at("compile") == DeploymentState::Succeeded);
  CHECK(result.states.at("deploy") == DeploymentState::Failed);
  CHECK(result.states.at("notify") == DeploymentState::Blocked);
  CHECK(result.attempts.at("compile") == 2);
  CHECK(result.attempts.at("deploy") == 1);
  CHECK((sleeper.delays == std::vector<std::int64_t>{5}));
  CHECK(inventory.available("cpu") == 2);
  CHECK(result.eventFailures.empty());
  CHECK(!observed.empty());
  CHECK(observed.back().find("job.blocked:id=notify;reason=dependency") == 0);

  std::cout << "T6_MEDIUM_PUBLIC_PASSED\n";
  return 0;
}
