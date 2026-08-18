#!/usr/bin/env bash
set -euo pipefail
workspace="${1:?workspace path required}"
binary="${2:?output binary required}"
g++ -std=c++17 -Wall -Wextra -Wpedantic -Werror \
  -I"$workspace/include" \
  "$workspace"/src/*.cpp hidden_test.cpp -o "$binary"
"$binary"
