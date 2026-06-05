安装 Go 依赖
```
运行前需要在 web/default 和 web/classic 下面创建 dist/index.html，写入<!DOCTYPE html><html><body></body></html>

go mod download
```


配置开发环境
New API 支持通过 .env 文件配置环境变量。创建 .env 文件（可从 .env.example 复制）：
```
cp .env.example .env
```


编辑 .env 文件，根据需要修改配置。以下是开发环境中常用的配置：
```
PORT=3000
SQL_DSN=root:password@tcp(localhost:3306)/new-api   # 如使用MySQL，取消注释并修改
# REDIS_CONN_STRING=redis://localhost:6379         # 如使用Redis，取消注释并修改
```


运行后端服务
```
# 直接运行
go run main.go
# 或者编译后运行
go build -o new-api
./new-api
```


新版前端 (default)
```
cd web/default
bun install   # 使用 bun 安装新版前端依赖

# 修改 rsbuild.config.ts 在 host: '0.0.0.0' 下面添加 port: 8000 防止端口冲突
bun run dev

# 使用 bun 构建新版前端资源
bun run build
```


## 生产环境部署

编译项目
```
# 1. 构建前端静态资源
cd web/default
bun install
bun run build
cd ../..

# 2. 将前端资源嵌入 Go 二进制
go build -o new-api
```

启动服务
```
# 启动（后台运行，日志写入 new-api.log）
./deploy/start.sh

# 停止服务
./deploy/stop.sh

# 重启服务
./deploy/stop.sh && ./deploy/start.sh

# 查看日志
tail -f new-api.log
```

检查运行状态
```
# 查看进程
ps aux | grep new-api

# 查看 PID
cat new-api.pid

# 确认端口监听
lsof -i :3000
```