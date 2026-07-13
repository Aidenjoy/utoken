# 代理角色功能

## 需求背景

系统需要支持「代理」角色：代理可以发展自己的客户，管理自己分组下的用户，查看他们的 token 使用情况。但代理不能给用户充值，也不能看到其他分组的用户。超管管理所有客户。

## 角色定义

| 角色 | 数值 | 说明 |
|------|------|------|
| Guest | 0 | 游客 |
| CommonUser | 1 | 普通用户 |
| **AgentUser** | **5** | **代理（新增）** |
| AdminUser | 10 | 管理员 |
| RootUser | 100 | 超级管理员 |

代理的能力边界：
- 只能管理自己分组下的用户
- 可以查看 token 使用情况（日志）
- 不能给用户充值（add_quota）
- 不能提升/降级用户角色（promote/demote）
- 不能管理 OAuth 绑定、重置 Passkey、重置 2FA
- 侧边栏只显示「用户管理」，其他管理菜单不可见

---

## 后端改动

### 1. 新增角色常量

**文件**: `common/constants.go`

在 `RoleCommonUser = 1` 和 `RoleAdminUser = 10` 之间新增 `RoleAgentUser = 5`，并更新 `IsValidateRole` 函数。

### 2. 新增 AgentAuth 中间件

**文件**: `middleware/auth.go`

新增 `AgentAuth()` 中间件，允许 role >= 5 的用户通过（代理、管理员、超管都能通过）。复用已有的 `authHelper(c, common.RoleAgentUser)` 机制。

### 3. 路由拆分

**文件**: `router/api-router.go`

将原 `adminRoute` 拆为两组：

**agentRoute**（`AgentAuth()` 中间件，role >= 5）:
- `GET /api/user/` → GetAllUsers
- `GET /api/user/search` → SearchUsers
- `GET /api/user/:id` → GetUser
- `POST /api/user/` → CreateUser
- `POST /api/user/manage` → ManageUser
- `PUT /api/user/` → UpdateUser
- `DELETE /api/user/:id` → DeleteUser

**adminRoute**（保持 `AdminAuth()`，仅 role >= 10）:
- `GET /api/user/topup` → GetAllTopUps
- `POST /api/user/topup/complete` → AdminCompleteTopUp
- `DELETE /api/user/:id/reset_passkey` → AdminResetPasskey
- `GET /api/user/2fa/stats` → Admin2FAStats
- `DELETE /api/user/:id/2fa` → AdminDisable2FA
- OAuth 绑定相关路由

日志路由也做了调整：
- `GET /api/log/`、`GET /api/log/stat`、`GET /api/log/search` 改用 `AgentAuth()`
- `DELETE /api/log/` 保持 `RootAuth()`

### 4. 用户管理接口加分组过滤

**文件**: `controller/user.go`

在以下函数开头加判断：如果是代理（role == 5），强制按自己的分组过滤。代理的分组从 gin context 获取 `c.GetString("group")`（authHelper 已设置）。

| 函数 | 代理行为 |
|------|----------|
| GetAllUsers | 走 SearchUsers 逻辑，强制 group = 代理分组 |
| SearchUsers | 如果是代理，强制覆盖 group 为自己的分组 |
| GetUser | 获取目标用户后，检查 group 是否等于代理分组，不等则拒绝 |
| CreateUser | 代理创建用户时，强制新用户 group = 代理分组 |
| UpdateUser | 检查目标用户 group 是否在代理分组内 |
| ManageUser | 检查目标用户 group；禁止 add_quota、promote、demote |
| DeleteUser | 检查目标用户 group |

`canManageTargetRole(myRole, targetRole)` 函数无需修改，已有逻辑 `myRole > targetRole` 天然支持：
- 代理(5) > 普通用户(1) → 可管理
- 代理(5) > 代理(5) → 不可管理
- 代理(5) > 管理员(10) → 不可管理

### 5. 注册时自动归入代理分组

**文件**: `controller/user.go` Register 函数

当 `affCode` 非空时，查出 `inviterId` 后，再查邀请人的 role 和 group。如果邀请人是代理（role == 5），将新用户的 group 设为邀请人的 group。

### 6. 日志接口加分组过滤

**文件**: `controller/log.go`

- GetAllLogs: 如果是代理，强制 `group = c.GetString("group")`
- GetLogsStat: 同上

日志 model 层已支持 group 参数过滤，只需在 controller 层强制设置即可。

### 7. 权限和侧边栏配置

**文件**: `controller/user.go`

- `calculateUserPermissions`: 新增 agent 分支，`sidebar_settings = true`，`sidebar_modules` 中 admin 区域只开启 `user: true`，其余全 false
- `generateDefaultSidebarConfig`: 新增 agent 分支，admin 区域只开启 `user: true`

---

## 前端改动

### 8. 新增 AGENT 角色常量

**文件**: `web/default/src/lib/roles.ts`

ROLE 对象新增 `AGENT: 5`，ROLE_LABEL_KEYS 新增 Agent 标签。

**文件**: `web/default/src/features/users/constants.ts`

USER_ROLE 新增 `AGENT: 5`，USER_ROLES 和 getUserRoleOptions 同步更新。

### 9. 侧边栏显示控制

**文件**: `web/default/src/hooks/use-sidebar-view.ts`

`isAdmin` 判断从 `role >= ROLE.ADMIN` 改为 `role >= ROLE.AGENT`，使代理能看到 admin 分组。

**文件**: `web/default/src/hooks/use-sidebar-data.ts`

给 admin 分组的菜单项加 `requiredRole` 限制：

| 菜单项 | requiredRole | 代理可见 |
|--------|-------------|---------|
| Channels | ROLE.ADMIN | 否 |
| Models | ROLE.ADMIN | 否 |
| Users | ROLE.AGENT | 是 |
| Redemption Codes | ROLE.ADMIN | 否 |
| Subscriptions | ROLE.ADMIN | 否 |
| System Info | ROLE.SUPER_ADMIN | 否 |
| System Settings | ROLE.ADMIN | 否 |

Usage Logs 在 general 分组中，所有用户可见，代理也能看到。

### 10. 用户操作按钮控制

**文件**: `web/default/src/features/users/components/data-table-row-actions.tsx`

代理隐藏以下按钮：
- Promote / Demote
- Manage Bindings
- Manage Subscriptions
- Reset Passkey
- Reset 2FA

通过判断 `myRole === ROLE.AGENT` 来控制显隐。

**文件**: `web/default/src/features/users/components/users-mutate-drawer.tsx`

代理编辑/创建用户时：
- 隐藏角色选择器（创建时）
- 隐藏分组选择器（编辑时，分组强制为代理自己的分组）
- 隐藏「Adjust Quota」充值按钮和 UserQuotaDialog

### 11. 用户列表路由守卫

**文件**: `web/default/src/routes/_authenticated/users/index.tsx`

- 路由守卫从 `role < ROLE.ADMIN` 改为 `role < ROLE.AGENT`
- role 搜索枚举加入 `'5'`

---

## 验证步骤

1. 超管创建代理用户，设置分组为 "agent001"
2. 用代理的邀请码注册新用户，验证新用户自动归入 "agent001" 分组
3. 代理登录后，验证只能看到 "agent001" 分组的用户
4. 代理查看用户列表，确认看不到充值按钮
5. 代理查看使用日志，确认只显示自己分组的日志
6. 代理尝试修改其他分组用户，确认被拒绝
7. 超管登录验证仍能看到所有用户
