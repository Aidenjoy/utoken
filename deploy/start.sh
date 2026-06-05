#!/bin/bash
# ------------------------------------------------------------------
# New API 生产环境启动脚本
# 用法: ./deploy/start.sh
# ------------------------------------------------------------------
set -e

# ---- 配置 --------------------------------------------------------
APP_NAME="new-api"
APP_BIN="./new-api"                  # 编译产物路径（项目根目录）
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"  # 项目根目录
PID_FILE="$APP_DIR/$APP_NAME.pid"
LOG_FILE="$APP_DIR/$APP_NAME.log"

cd "$APP_DIR"

# ---- 检查是否已运行 ------------------------------------------------
if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if kill -0 "$PID" 2>/dev/null; then
    echo "[ERROR] $APP_NAME 已在运行 (PID: $PID)"
    exit 1
  else
    echo "[WARN] 残留 PID 文件已清理"
    rm -f "$PID_FILE"
  fi
fi

# ---- 检查二进制文件 ------------------------------------------------
if [ ! -f "$APP_BIN" ]; then
  echo "[ERROR] 找不到 $APP_BIN，请先执行编译：go build -o new-api"
  exit 1
fi

# ---- 启动 --------------------------------------------------------
echo "[INFO] 启动 $APP_NAME ..."
nohup "$APP_BIN" >> "$LOG_FILE" 2>&1 &
PID=$!
echo $PID > "$PID_FILE"

sleep 1

if kill -0 "$PID" 2>/dev/null; then
  echo "[OK] $APP_NAME 启动成功 (PID: $PID)"
  echo "[INFO] 日志文件: $LOG_FILE"
else
  echo "[ERROR] $APP_NAME 启动失败，请查看日志: $LOG_FILE"
  rm -f "$PID_FILE"
  exit 1
fi
