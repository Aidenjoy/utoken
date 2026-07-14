# 统计数据与统计日志

## 需求背景

代理角色需要一个独立于「使用日志」的统计入口，用于查看自己分组下的整体消费概况和详细日志记录。管理员也需要一个更简洁的统计看板。因此新增两个页面：「统计数据」和「统计日志」，两者对管理员和代理都开放，代理只能看到自己分组的数据。

---

## 新增页面

### 统计数据（/statistics）

**文件**: `web/default/src/features/statistics/index.tsx`

功能概述：
- 汇总卡片：总消费额度、请求次数、Token 总量
- 按模型分组的明细表格：请求次数、Token 用量、消费额度、占比百分比
- 时间范围筛选：24 小时 / 7 天 / 30 天
- 用户名筛选

数据来源：`GET /api/data/`（`getAllQuotaDates`），代理访问时后端按分组过滤。

### 统计日志（/statistics-logs）

**文件**: `web/default/src/features/statistics-logs/index.tsx`

功能概述：
- 与「使用日志」页面视觉风格一致（StatusBadge、Avatar、ModelBadge）
- 时间列显示时间戳 + 日志类型彩色标签（如"登录"为 teal 色、"消费"为绿色）
- 渠道列用彩色标签显示渠道编号
- 用户列用头像 + 用户名显示
- 令牌列用带钥匙图标的标签显示
- 模型列用 ModelBadge 显示（自动识别厂商图标）
- 耗时列根据快慢显示绿/黄/红色
- 统计标签栏：消费额度、RPM、TPM
- 筛选条件：用户名、模型、令牌、日志类型
- 分页

数据来源：`GET /api/log/`（`getAllLogs`）+ `GET /api/log/stat`（`getLogStats`），代理访问时后端按分组过滤。

---

## 后端改动

### 1. 路由权限调整

**文件**: `router/api-router.go`

以下路由从 `AdminAuth()` 改为 `AgentAuth()`（role >= 5 可访问）：

| 路由 | 说明 |
|------|------|
| `GET /api/log/` | 获取所有日志（代理按分组过滤） |
| `GET /api/log/stat` | 获取日志统计（代理按分组过滤） |
| `GET /api/log/search` | 搜索日志 |
| `GET /api/data/` | 获取配额数据 |
| `GET /api/data/users` | 按用户获取配额数据 |
| `GET /api/data/flow` | 获取流量配额数据 |
| `GET /api/group/` | 获取分组列表（用户编辑器需要） |

**文件**: `router/authz-router.go`

| 路由 | 说明 |
|------|------|
| `GET /api/authz/catalog` | 获取权限目录（用户编辑器需要） |

### 2. 日志分组过滤

**文件**: `controller/log.go`

- `GetAllLogs`：如果是代理（role == 5），强制 `group = c.GetString("group")`
- `GetLogsStat`：同上

代理只能看到自己分组下的日志记录，管理员和超管能看到所有日志。

### 3. 日志记录函数补全 Group 字段

**文件**: `model/log.go`

以下 5 个函数原来没有设置 `Group` 字段，导致代理按分组过滤时看不到这些类型的日志。全部补上：

| 函数 | 修改方式 |
|------|----------|
| `RecordLog` | 改用 `GetUsernameAndGroupById(userId)` 获取 group |
| `RecordLogWithAdminInfo` | 同上 |
| `RecordOperationAuditLog` | 同上 |
| `RecordTopupLog` | 同上 |
| `RecordLoginLog` | 新增 `group string` 参数，由调用方传入 |

以下 3 个函数原本已正确设置 Group，无需修改：
- `RecordConsumeLog` — 从参数获取
- `RecordErrorLog` — 从参数获取
- `RecordTaskBillingLog` — 从参数获取

### 4. 新增 GetUsernameAndGroupById 函数

**文件**: `model/user.go`

```go
func GetUsernameAndGroupById(id int) (username string, group string)
```

一次查询同时获取用户名和分组，优先从 Redis 缓存读取，缓存未命中时单次 DB 查询。用于日志记录函数，替代原来只查用户名的 `GetUsernameById`。

### 5. RecordLoginLog 调用方更新

**文件**: `controller/user.go`

`recordLoginAudit` 函数中调用 `RecordLoginLog` 时传入 `user.Group`。

---

## 前端改动

### 6. 前端路由定义

**文件**: `web/default/src/routes/_authenticated/statistics/index.tsx`

统计数据页面路由，`beforeLoad` 检查 `role >= ROLE.AGENT`。

**文件**: `web/default/src/routes/_authenticated/statistics-logs/index.tsx`

统计日志页面路由，`beforeLoad` 检查 `role >= ROLE.AGENT`，搜索参数支持 page、pageSize、username、model、token、type、startTime、endTime。

### 7. 侧边栏配置

**文件**: `web/default/src/hooks/use-sidebar-config.ts`

`DEFAULT_SIDEBAR_MODULES.admin` 新增 `log: true`，使统计日志菜单项可见。

**文件**: `web/default/src/hooks/use-sidebar-data.ts`

| 菜单项 | URL | requiredRole | 代理可见 |
|--------|-----|-------------|---------|
| Statistics Data | /statistics | ROLE.AGENT | 是 |
| Statistics Logs | /statistics-logs | ROLE.AGENT | 是 |

### 8. 统计日志页面防无限请求

**文件**: `web/default/src/features/statistics-logs/index.tsx`

时间范围计算用 `useMemo` 缓存，依赖 `[search.startTime, search.endTime]`，避免每次渲染重新计算导致 `useQuery` 的 `queryKey` 不停变化触发无限重取。两个 `useQuery` 均设置 `staleTime: 30 * 1000`。

---

## 验证步骤

1. 管理员登录，侧边栏看到「统计数据」和「统计日志」
2. 代理登录，侧边栏同样看到这两个菜单
3. 管理员查看统计日志，能看到所有分组的日志
4. 代理查看统计日志，只能看到自己分组的日志
5. 代理查看统计日志，能看到渠道、用户、模型等完整字段
6. 代理筛选日志类型（如"登录"），只显示登录类型的日志
7. 代理点击用户管理，不再报 "Unauthorized, insufficient privileges"
8. 统计日志页面不会疯狂发请求导致 429
9. 新产生的登录日志，代理能看到（Group 字段已补全）
