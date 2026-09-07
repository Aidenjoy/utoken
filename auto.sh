#!/bin/bash
# ------------------------------------------------------------------
# New API 一键更新脚本（前端构建 + 后端编译 + 重启服务）
# 用法: ./auto.sh
# ------------------------------------------------------------------
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"

step() {
  echo ""
  echo "=================================================================="
  echo "[STEP $1/5] $2"
  echo "=================================================================="
}

step 1 "安装前端依赖 (bun install)"
cd "$APP_DIR/web/default"
bun install
echo "[OK] 前端依赖安装完成"

step 2 "构建前端 (bun run build)"
bun run build
echo "[OK] 前端构建完成"

step 3 "编译后端 (go build -o new-api)"
cd "$APP_DIR"
go build -o new-api
echo "[OK] 后端编译完成: $APP_DIR/new-api"

step 4 "停止服务 (./deploy/stop.sh)"
if ./deploy/stop.sh; then
  echo "[OK] 服务已停止"
else
  echo "[WARN] 停止脚本返回非零（服务可能本就不在运行），继续启动流程"
fi

step 5 "启动服务 (./deploy/start.sh)"
./deploy/start.sh

echo ""
echo "[OK] 更新完成：前端构建 + 后端编译 + 服务已重启"
