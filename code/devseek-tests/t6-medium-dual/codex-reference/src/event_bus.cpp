#include "event_bus.hpp"
#include <stdexcept>

namespace devseek_case {
SubscriptionId EventBus::subscribe(const std::string& event, Handler handler) {
  if (event.empty()) {
    throw std::invalid_argument("event cannot be empty");
  }
  if (!handler) {
    throw std::invalid_argument("handler cannot be null");
  }
  const auto id = nextId_++;
  subscriptions_[event].push_back({id, std::move(handler)});
  activeSubscriptions_[id] = true;
  return id;
}

bool EventBus::unsubscribe(SubscriptionId id) {
  auto it = activeSubscriptions_.find(id);
  if (it == activeSubscriptions_.end() || !it->second) {
    return false;
  }
  it->second = false;
  return true;
}

PublishReport EventBus::publish(const std::string& event, const std::string& payload) {
  PublishReport report;

  auto it = subscriptions_.find(event);
  if (it == subscriptions_.end()) {
    return report;
  }

  // Take snapshot of current subscriptions for this event
  std::vector<SnapshotItem> snapshot;
  snapshot.reserve(it->second.size());
  for (const auto& sub : it->second) {
    if (activeSubscriptions_[sub.id]) {
      snapshot.push_back({sub.id, sub.handler});
    }
  }

  // Execute snapshot
  for (const auto& item : snapshot) {
    // Check if still active at execution time
    auto activeIt = activeSubscriptions_.find(item.id);
    if (activeIt == activeSubscriptions_.end() || !activeIt->second) {
      continue;
    }
    ++report.invoked;
    try {
      item.handler(payload);
    } catch (const std::exception& e) {
      report.failures.push_back(e.what());
    } catch (...) {
      report.failures.push_back("unknown exception");
    }
  }

  return report;
}
}  // namespace devseek_case
