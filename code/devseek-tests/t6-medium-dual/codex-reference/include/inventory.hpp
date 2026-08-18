#pragma once
#include <string>
#include <unordered_map>
#include <vector>
#include <set>

namespace devseek_case {
struct ItemRequest { std::string sku; int quantity = 0; };

// 用于幂等性检查的规范化预留请求（已聚合、排序）
struct NormalizedReservation {
  std::set<std::pair<std::string, int>> items;  // 排序后的(sku, quantity)
  bool operator==(const NormalizedReservation& other) const {
    return items == other.items;
  }
};

class InventoryService {
 public:
  void setStock(const std::string& sku, int quantity);
  bool reserve(const std::string& reservationId, const std::vector<ItemRequest>& items);
  bool release(const std::string& reservationId);
  int available(const std::string& sku) const;

 private:
  // 规范化请求：按sku排序并聚合数量，用于幂等性比较
  NormalizedReservation normalizeItems(const std::vector<ItemRequest>& items) const;

  std::unordered_map<std::string, int> stock_;  // sku -> 当前库存
  // reservationId -> NormalizedReservation（已提交的预留请求）
  std::unordered_map<std::string, NormalizedReservation> reservations_;
  // reservationId -> 本次预留实际扣减的库存快照（用于release恢复）
  std::unordered_map<std::string, std::unordered_map<std::string, int>> reservationSnapshots_;
};
}  // namespace devseek_case
