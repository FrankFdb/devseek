#!/usr/bin/env bash
# ================================================================
# Iter 1 验证脚本 — 检验 bridge server 是否正常工作
# 用法：bash scripts/verify-bridge.sh
# ================================================================
set -e

PORT=${BRIDGE_PORT:-3721}
BASE="http://127.0.0.1:${PORT}"

echo "=================================================="
echo " DeepSeek NetAI Bridge — 功能验证"
echo " 目标地址: ${BASE}"
echo "=================================================="

# ---------- 1. ping ----------
echo ""
echo "[1/4] 测试 GET /ping ..."
PING=$(curl -sf "${BASE}/ping")
echo "  响应: ${PING}"
echo "${PING}" | grep -q '"ok":true' && echo "  ✅ /ping OK" || { echo "  ❌ /ping 失败"; exit 1; }

# ---------- 2. status ----------
echo ""
echo "[2/4] 测试 GET /status ..."
STATUS=$(curl -sf "${BASE}/status")
echo "  响应: ${STATUS}"
echo "  ✅ /status OK"

# ---------- 3. 非流式 chat ----------
echo ""
echo "[3/4] 测试 POST /chat (stream=false) ..."
echo "  正在向 DeepSeek 发送消息，浏览器会弹出..."
echo "  （如果是第一次运行，需要先手动登录）"
CHAT=$(curl -sf -X POST "${BASE}/chat" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"请只回复数字：1+1等于几？","stream":false,"newSession":true}')
echo "  响应: ${CHAT}"
echo "${CHAT}" | grep -q '"content"' && echo "  ✅ /chat (non-stream) OK" || { echo "  ❌ /chat 失败: ${CHAT}"; exit 1; }

# ---------- 4. 流式 chat ----------
echo ""
echo "[4/4] 测试 POST /chat (stream=true) ..."
echo "  SSE 输出（按 Ctrl+C 中止）:"
curl -s -X POST "${BASE}/chat" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"prompt":"用一句话介绍你自己","stream":true}' \
  --no-buffer | head -20

echo ""
echo "=================================================="
echo " 所有测试通过 ✅"
echo "=================================================="
