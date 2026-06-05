#!/bin/bash
# ------------------------------------------------------------------
# New API 生产环境停止脚本
# 用法: ./deploy/stop.sh
# ------------------------------------------------------------------
set -e

APP_NAME="new-api"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_FILE="$APP_DIR/$APP_NAME.pid"

# ---- 检查 PID 文件 ------------------------------------------------
if [ ! -f "$PID_FILE" ]; then
  echo "[ERROR] 找不到 PID 文件，$APP_NAME 可能未在运行"
  exit 1
fi

PID=$(cat "$PID_FILE")

# ---- 检查进程是否存在 ----------------------------------------------
if ! kill -0 "$PID" 2>/dev/null; then
  echo "[WARN] PID $PID 对应的进程不存在，清理 PID 文件"
  rm -f "$PID_FILE"
  exit 0
fi

# ---- 优雅停止 (SIGTERM) ------------------------------------------
echo "[INFO] 停止 $APP_NAME (PID: $PID) ..."
kill "$PID"

# 等待最多 10 秒
for i in $(seq 1 10); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "[OK] $APP_NAME 已停止"
    rm -f "$PID_FILE"
    exit 0
  fi
  sleep 1
done

# ---- 强制停止 (SIGKILL) -------------------------------------------
echo "[WARN] 优雅停止超时，强制终止..."
kill -9 "$PID" 2>/dev/null || true
sleep 1
rm -f "$PID_FILE"
echo "[OK] $APP_NAME 已强制停止"
