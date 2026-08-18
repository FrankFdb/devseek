#include "job_scheduler.hpp"
#include <algorithm>
#include <queue>
#include <stdexcept>
#include <unordered_set>

namespace devseek_case {

namespace {

// 验证作业ID是否为空
void validateJobId(const std::string& id) {
  if (id.empty()) {
    throw std::invalid_argument("job id cannot be empty");
  }
}

// 验证作业ID是否重复
void validateNoDuplicate(const std::unordered_map<std::string, JobSpec>& jobs,
                         const std::string& id) {
  if (jobs.find(id) != jobs.end()) {
    throw std::invalid_argument("duplicate job id: " + id);
  }
}

// 检测依赖环并返回拓扑排序结果
std::vector<std::string> topologicalSort(
    const std::unordered_map<std::string, JobSpec>& jobs) {
  // 构建依赖图和入度表
  std::unordered_map<std::string, std::unordered_set<std::string>> graph;
  std::unordered_map<std::string, int> inDegree;
  std::unordered_set<std::string> allIds;

  // 收集所有作业ID和依赖ID，同时检测未知依赖
  for (const auto& entry : jobs) {
    const std::string& id = entry.first;
    const JobSpec& job = entry.second;
    allIds.insert(id);
    inDegree[id] = 0;  // 确保每个作业在入度表中

    for (const std::string& dep : job.dependencies) {
      if (jobs.find(dep) == jobs.end()) {
        throw std::invalid_argument("unknown dependency: " + dep +
                                    " for job: " + id);
      }
      graph[dep].insert(id);  // dep -> id
    }
  }

  // 计算入度
  for (const auto& entry : graph) {
    for (const std::string& successor : entry.second) {
      inDegree[successor]++;
    }
  }

  // 拓扑排序：按优先级和ID字典序选择
  struct JobNode {
    std::string id;
    int priority;
  };

  // 自定义比较器：优先级高优先，优先级相同则ID字典序小优先
  auto cmp = [](const JobNode& a, const JobNode& b) {
    if (a.priority != b.priority) {
      return a.priority < b.priority;  // 高优先级优先（max-heap行为）
    }
    return a.id > b.id;  // 字典序小优先
  };

  std::priority_queue<JobNode, std::vector<JobNode>, decltype(cmp)> ready(cmp);

  // 初始化：将所有入度为0的作业加入就绪队列
  for (const auto& entry : inDegree) {
    if (entry.second == 0) {
      auto it = jobs.find(entry.first);
      ready.push({entry.first, it->second.priority});
    }
  }

  std::vector<std::string> result;
  std::unordered_set<std::string> visited;

  while (!ready.empty()) {
    JobNode node = ready.top();
    ready.pop();

    // 避免重复处理（理论上不会发生）
    if (visited.find(node.id) != visited.end()) {
      continue;
    }

    result.push_back(node.id);
    visited.insert(node.id);

    // 减少后继节点的入度
    auto it = graph.find(node.id);
    if (it != graph.end()) {
      for (const std::string& successor : it->second) {
        inDegree[successor]--;
        if (inDegree[successor] == 0) {
          auto jobIt = jobs.find(successor);
          ready.push({successor, jobIt->second.priority});
        }
      }
    }
  }

  // 检测环：如果访问的节点数不等于总节点数，说明存在环
  if (visited.size() != jobs.size()) {
    throw std::logic_error("dependency cycle detected");
  }

  return result;
}

}  // namespace

void JobScheduler::addJob(JobSpec job) {
  validateJobId(job.id);
  validateNoDuplicate(jobs_, job.id);
  jobs_[job.id] = std::move(job);
}

std::vector<std::string> JobScheduler::buildPlan() const {
  // 如果没有作业，返回空向量
  if (jobs_.empty()) {
    return {};
  }

  // 执行拓扑排序（包含未知依赖和环检测）
  return topologicalSort(jobs_);
}

}  // namespace devseek_case
