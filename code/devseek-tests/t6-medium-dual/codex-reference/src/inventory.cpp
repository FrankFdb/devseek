#include "inventory.hpp"
#include <stdexcept>
#include <algorithm>
#include <unordered_map>
#include <set>

namespace devseek_case {

NormalizedReservation InventoryService::normalizeItems(const std::vector<ItemRequest>& items) const {
  // 按sku聚合数量
  std::unordered_map<std::string, int> aggregated;
  for (const auto& item : items) {
    aggregated[item.sku] += item.quantity;
  }
  // 转为排序的set用于幂等比较
  NormalizedReservation result;
  for (const auto& pair : aggregated) {
    result.items.insert(pair);
  }
  return result;
}

void InventoryService::setStock(const std::string& sku, int quantity) {
  if (sku.empty()) {
    throw std::invalid_argument("setStock: sku cannot be empty");
  }
  if (quantity < 0) {
    throw std::invalid_argument("setStock: quantity cannot be negative");
  }
  stock_[sku] = quantity;
}

bool InventoryService::reserve(const std::string& reservationId, const std::vector<ItemRequest>& items) {
  // 1. 参数校验
  if (reservationId.empty()) {
    throw std::invalid_argument("reserve: reservationId cannot be empty");
  }
  if (items.empty()) {
    throw std::invalid_argument("reserve: items list cannot be empty");
  }
  for (const auto& item : items) {
    if (item.sku.empty()) {
      throw std::invalid_argument("reserve: sku cannot be empty");
    }
    if (item.quantity <= 0) {
      throw std::invalid_argument("reserve: quantity must be positive");
    }
  }

  // 2. 规范化请求（聚合重复sku）
  auto normalized = normalizeItems(items);

  // 3. 幂等性检查：同一reservationId相同请求返回true
  auto it = reservations_.find(reservationId);
  if (it != reservations_.end()) {
    if (it->second == normalized) {
      return true;  // 幂等：相同请求返回true
    } else {
      throw std::invalid_argument("reserve: reservationId already used with different request");
    }
  }

  // 4. 原子性检查：先验证所有sku存在且库存充足，任一失败则整个批次失败
  // 先做快照，用于回滚
  std::unordered_map<std::string, int> snapshot;
  for (const auto& pair : normalized.items) {
    const std::string& sku = pair.first;
    int required = pair.second;
    auto stockIt = stock_.find(sku);
    if (stockIt == stock_.end()) {
      return false;  // sku不存在
    }
    if (stockIt->second < required) {
      return false;  // 库存不足
    }
    snapshot[sku] = stockIt->second;  // 记录扣减前库存
  }

  // 5. 原子性执行：扣减库存
  for (const auto& pair : normalized.items) {
    const std::string& sku = pair.first;
    int required = pair.second;
    stock_[sku] -= required;
  }

  // 6. 记录预留（用于幂等和release）
  reservations_[reservationId] = normalized;
  reservationSnapshots_[reservationId] = snapshot;  // 保存扣减前快照

  return true;
}

bool InventoryService::release(const std::string& reservationId) {
  if (reservationId.empty()) {
    return false;  // 按规范：空id返回false
  }

  // 检查预留是否存在
  auto it = reservationSnapshots_.find(reservationId);
  if (it == reservationSnapshots_.end()) {
    return false;  // 未知或已释放
  }

  // 恢复库存到快照状态（扣减前）
  for (const auto& pair : it->second) {
    const std::string& sku = pair.first;
    int snapshotQuantity = pair.second;
    stock_[sku] = snapshotQuantity;
  }

  // 清理预留记录
  reservations_.erase(reservationId);
  reservationSnapshots_.erase(reservationId);

  return true;
}

int InventoryService::available(const std::string& sku) const {
  if (sku.empty()) {
    throw std::invalid_argument("available: sku cannot be empty");
  }
  auto it = stock_.find(sku);
  if (it == stock_.end()) {
    throw std::out_of_range("available: sku not found");
  }
  return it->second;
}

}  // namespace devseek_case
