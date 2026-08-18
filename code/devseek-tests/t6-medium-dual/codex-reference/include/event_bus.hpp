#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace devseek_case {
using SubscriptionId = std::uint64_t;
using Handler = std::function<void(const std::string&)>;
struct PublishReport { std::size_t invoked = 0; std::vector<std::string> failures; };
class EventBus {
 public:
  SubscriptionId subscribe(const std::string& event, Handler handler);
  bool unsubscribe(SubscriptionId id);
  PublishReport publish(const std::string& event, const std::string& payload);
 private:
  struct Subscription { SubscriptionId id; Handler handler; };
  struct SnapshotItem { SubscriptionId id; Handler handler; };
  std::unordered_map<std::string, std::vector<Subscription>> subscriptions_;
  std::unordered_map<SubscriptionId, bool> activeSubscriptions_;
  SubscriptionId nextId_ = 1;
};
}  // namespace devseek_case
