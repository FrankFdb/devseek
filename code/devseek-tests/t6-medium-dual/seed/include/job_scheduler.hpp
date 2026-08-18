#pragma once
#include <string>
#include <unordered_map>
#include <vector>

namespace devseek_case {
struct JobSpec {
  std::string id;
  int priority = 0;
  std::vector<std::string> dependencies;
};

class JobScheduler {
 public:
  void addJob(JobSpec job);
  std::vector<std::string> buildPlan() const;

 private:
  std::unordered_map<std::string, JobSpec> jobs_;
};
}  // namespace devseek_case
