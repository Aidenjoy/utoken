# 云大师 Agent 接入契约

版本：2026-11-18，适用于本次设备授权实现。基于 new-api 的 utoken 服务端；具体联调结果见 `agent-verification.md`。`agent-openapi.json` 可导入 Apifox，浏览器批准与撤销仍需真实会话及页面 CSRF。

## 1. 凭证及兼容性

| 凭证 | 用途 | 请求头 | 生命周期 |
|---|---|---|---|
| 设备访问令牌 `udv_...` | 受限用户资料、日志及本客户端模型 key 管理 | `Authorization: Bearer <access_token>` | 30 天，到期重新授权，无 refresh_token |
| 原有系统访问令牌 | 原有管理 API | `Authorization: Bearer <系统访问令牌>`，同时 `New-Api-User: <用户数字ID>` | 沿用原有行为 |
| 模型调用 key | `/v1/...` 模型中继 | `Authorization: Bearer <完整key>` | 受模型 key 与设备授权的共同限制 |

- 设备令牌从授权记录解析用户 ID，不强制 `New-Api-User`；如果提供，该值必须与授权账号一致。
- 原有系统访问令牌仍兼容不带 `Bearer ` 的值；新客户端统一使用上表格式。不要假定大小写随意的前缀也兼容原系统令牌。
- 原有 `/api/desktop-auth/*` 是桌面授权码＋PKCE 登录，不是此设备流，不变更其凭证或语义。
- 模型 key 的返回值不保证自带 `sk-`。原样作为 Bearer 值使用；不要对返回值重复添加前缀。
- `client_id` 目前只注册 `yundashi-agent`。这是公开客户端标识，不是密钥；不在桌面程序中配置 client_secret。

## 2. 设备授权流程

### 申请设备码

`POST /oauth/device/code`，`Content-Type: application/x-www-form-urlencoded`，无需管理凭证。

| 参数 | 必填 | 说明 |
|---|---|---|
| `client_id` | 是 | `yundashi-agent` |
| `scope` | 否 | 空格分隔；默认 `token:manage user:read log:read`，未知权限拒绝 |
| `device_name` | 否 | 用户可识别的设备备注，最多 100 个 Unicode 字符，不允许换行或 NUL；不是设备认证依据 |

成功 HTTP 200，直接返回 OAuth JSON，不包装 success/data：

```json
{
  "device_code": "<高熵随机值>",
  "user_code": "ABCD-2345",
  "verification_uri": "https://<平台域名>/oauth/device",
  "verification_uri_complete": "https://<平台域名>/oauth/device?user_code=ABCD-2345",
  "expires_in": 600,
  "interval": 5
}
```

客户端展示短码，并在系统浏览器打开 `verification_uri_complete`。不要向用户展示 device_code；不要记录 device_code 或 access_token。授权页要求确认短码与客户端一致。

未登录时在新标签页完成现有登录（含第三方登录），原授权页自动刷新继续，无需复制验证码。授权页采用服务端 HTML，两套主题均可访问。

### 批准或拒绝

`GET /oauth/device?user_code=...` 显示账号、设备名、权限和批准/拒绝按钮。

`POST /oauth/device` 只接受浏览器会话及页面生成的 CSRF 字段：`user_code`、`csrf_token`、`decision=approve|deny`。管理 bearer 无法代替浏览器会话批准。一个请求只能决策一次。

### 轮询兑换

`POST /oauth/device/token`，`Content-Type: application/x-www-form-urlencoded`。

```text
grant_type=urn:ietf:params:oauth:grant-type:device_code
client_id=yundashi-agent
device_code=<申请时返回的值>
```

首次轮询等待至少 5 秒；后续按 interval 等待。成功 HTTP 200：

```json
{
  "access_token": "udv_<随机值>",
  "token_type": "Bearer",
  "expires_in": 2592000,
  "scope": "token:manage user:read log:read",
  "user_id": 123,
  "username": "example"
}
```

同一设备码只能兑换一次。成功响应丢失时重新发起授权，不重放已消费的 device_code。现有账号系统令牌不会被覆盖。

| HTTP | `error` | 客户端处理 |
|---|---|---|
| 400 | `authorization_pending` | 保持当前等待间隔继续轮询 |
| 400 | `slow_down` | 当前及后续轮询间隔均增加 5 秒 |
| 400 | `access_denied` | 停止轮询，提示拒绝或账号不可用 |
| 400 | `expired_token` | 停止轮询；用户再次操作时重新申请 |
| 400 | `invalid_grant` | 无效、不匹配或已消费，停止轮询 |
| 400 | `invalid_client` / `invalid_scope` / `invalid_request` / `unsupported_grant_type` | 修正请求 |
| 429 | 可能无 JSON | 遵循退避，不立即重试 |
| 500 | `server_error` | 服务端故障；网络超时应降低轮询频率 |

错误示例：`{"error":"authorization_pending"}`。OAuth 与原管理 API 的错误结构不同，客户端需要分别处理。

## 3. 权限边界

| scope | 允许接口 | 数据边界 |
|---|---|---|
| `user:read` | `GET /api/user/self` | 仅 id、username、group、quota、used_quota |
| `token:manage` | `GET/POST /api/token/`、`GET/DELETE /api/token/:id`、`POST /api/token/:id/key` | 当前账号、由同一可信 client 授权创建的 key |
| `log:read` | `GET /api/log/self`、`GET /api/log/self/stat` | 当前账号的日志，包含其他客户端的调用；授权页明确告知 |

其余经过管理鉴权的接口拒绝设备令牌，包括生成系统令牌、修改账号、管理后台、批量删除、修改 key、Ark 凭证读取等。管理员授权也不扩大设备权限。

只填写相同 source 的普通模型 key 不属于可信设备授权创建的 key，不会因此进入设备令牌可管理范围。

设备管理请求失效返回 HTTP 401 + `{"success":false,"error":"invalid_token"}`；权限不足返回 HTTP 403 + `insufficient_scope`；可选用户 ID 不匹配返回 HTTP 401 + `invalid_user`。同时检查原有 handler 的 success 字段，不能只看 HTTP 2xx。

## 4. 模型 key 管理

### 创建及获取完整 key

`POST /api/token/`，JSON 请求示例：

```json
{
  "name": "Agent-MacBook",
  "expired_time": -1,
  "unlimited_quota": true,
  "remain_quota": 0,
  "source": "yundashi-agent"
}
```

- 沿用现有创建响应：`{"success":true,"message":"","data":{"id":123,"key":"<脱敏>","source":"yundashi-agent", ...}}`。
- 然后 `POST /api/token/123/key`，返回 `{"success":true,"message":"","data":{"key":"<完整key>"}}`。该接口有现有 CriticalRateLimit，避免反复读取。
- 本次不改成“创建即返回明文”，也不取消原有受控取明文能力。
- `key` 永远由服务端生成，忽略客户端传入值。
- 设备凭证创建时 source 强制为可信 client_id，grant 关联只由服务端填写；拒绝为其他用户创建及绑定会员/渠道。
- `expired_time=-1` 或晚于设备授权到期时间时，自动限制到授权到期时间。必须显式传入有效期限；不要省略后依赖零值。
- `unlimited_quota=true` 表示模型 key 自身不设余额上限，不代表账户免费或无限余额。

### 列表及删除

`GET /api/token/?source=yundashi-agent&p=1&page_size=20`。

```json
{"success":true,"message":"","data":{"page":1,"page_size":20,"total":1,"items":[{"id":123,"name":"Agent-MacBook","key":"<脱敏>","source":"yundashi-agent"}]}}
```

列表保持脱敏，source 精确匹配，列表与总数使用相同过滤。设备令牌忽略跨用户查看参数。普通管理凭证也支持可选 source 创建及列表过滤；source 使用 1–64 位字母、数字、点、下划线、连字符，首位为字母或数字。历史记录的来源为空；本次不回填猜测值，不支持修改来源。

`DELETE /api/token/123` 成功：`{"success":true,"message":""}`。仅删除目标 key，不撤销设备访问令牌，不影响其他 key。

## 5. 用户资料与系统令牌兜底

`GET /api/user/self`：设备令牌只返回下列字段；普通系统令牌维持原有完整响应。

```json
{"success":true,"message":"","data":{"id":123,"username":"example","group":"default","quota":500000,"used_quota":10000}}
```

`GET /api/user/token` 是已鉴权后的系统访问令牌生成/重置接口，不是匿名登录，不是读取现有令牌。成功 data 是字符串，重新生成会覆盖用户之前的系统访问令牌。设备令牌禁止调用。

手动兜底须提供“系统访问令牌＋用户数字 ID”；只有令牌无法通过现有 self 接口反查 ID，因为原有鉴权先要求 New-Api-User。设备授权成功响应已提供 user_id，无此问题。

## 6. 用量与额度

`GET /api/log/self` 返回分页明细，支持 `type`、`start_timestamp`、`end_timestamp`、`token_name`、`model_name`、`group`、`request_id` 等现有筛选。时间使用 Unix 秒；token_name 按名称精确匹配，重名 key 不适合用名称区分设备。模型筛选沿用现有显式文本匹配规则，不要把它当任意 SQL 模式。

`GET /api/log/self/stat` 返回 `data.quota`、`data.rpm`、`data.tpm`：quota 是指定时间范围内消费额度汇总；rpm/tpm 是最近 60 秒的请求/输入输出 token 统计，不随指定历史窗口变化。此接口没有按天/模型分组的序列，客户端不得将它误当趋势接口。

分页统一使用 p（从 1 开始）、page_size（建议 1–100，服务端最大 100）；不要传零/负数。日志总数受现有查询上限影响，不保证适合作为全历史导出总数。

`GET /api/status` 是公开配置接口，返回 data 中的 system_name、quota_per_unit、quota_display_type、usd_exchange_rate、custom_currency_symbol、custom_currency_exchange_rate 等。announcements 只在公告模块启用时返回；announcements_enabled 只表示开关。

- USD 展示：`quota / quota_per_unit`。
- CNY 展示：在 USD 值上乘 `usd_exchange_rate`。
- CUSTOM 展示：在 USD 值上乘 `custom_currency_exchange_rate`。
- TOKENS 展示：按平台额度单位展示，不能当成模型 tokenizer 统计的真实输入/输出 token 数。
- 默认 quota_per_unit 为 500000，客户端以实际状态接口为准，不写死汇率或单位。
- 常规余额计费同时受账户余额和 key 额度约束；key 无限额度只取消 key 侧限制。本次不修改既有订阅、企业代付等计费机制，也不为设备 key 绑定会员。

`/api/status` 能证明 API 配置接口可达，不能证明数据库、所有渠道或模型服务正常；基础存活探测还可使用 `/healthz`，模型可用性仍需真实调用。

充值链接本次不新增公开配置字段，也不假定 status 已返回充值 URL。生产域名、充值路径及可用模型清单由平台运营提供给客户端配置，待 S5 确认后联调。

## 7. 控制台撤销与数据存储

- 个人资料 → 安全 → “管理 Agent 设备授权”，打开 `/oauth/device/grants`。
- 授权列表分页，包含设备名、状态、到期时间。撤销为浏览器 POST，要求当前用户会话及授权记录专属 CSRF。
- 撤销在同一事务更新授权状态、停用该设备创建的全部模型 key、追加审计；不影响同账号其他设备或普通 key。
- 设备管理 API 每次验证数据库授权；中继对设备 key 也检查授权真源。已在执行中的请求不强制中断，新请求拒绝已撤销授权。
- 过期也拒绝设备凭证与对应模型 key；到期重新授权会创建独立记录，不自动复活旧 key。
- 新表 device_grant_info 与 device_grant_flow；状态更新与流程记录同事务。凭证只存 SHA-256 摘要，不进 Redis。
- tokens 新增 source 与 device_grant_id；旧记录兼容为空/零。按本仓库规则由 GORM 管理主键，未引入雪花 ID 或租户字段。
- 迁移同时接入普通与快速启动路径。支持 SQLite/MySQL/PostgreSQL 的 GORM 条件更新，不依赖数据库专有锁语法。
- 授权审计记录保留；本次不增加后台清理任务，运营需根据实际增长制定保留策略。

## 8. 部署与限流

- ServerAddress 必须配置成本站公开 HTTPS origin，不含路径、query 或 fragment；只允许 localhost/127.0.0.1/::1 使用 HTTP 进行本地联调。不使用未校验的 Host 头拼装授权地址。
- 会话 cookie 密钥须在多副本间一致，设备授权记录存共享主数据库；不依赖单进程内存存储授权。
- 同源浏览器操作使用现有会话；桌面管理调用使用 Bearer，不依赖浏览器 cookie。
- 设备码申请固定每 IP 10 次/分钟；授权页查看和决策共享每 IP 60 次/分钟；轮询固定每 IP 120 次/分钟，并有数据库内每设备 5 秒起步的动态间隔。
- 还受平台可配置的 GlobalAPIRateLimit 与既有 key 读取 CriticalRateLimit 约束；429 可能为空响应体。
- 本次不修改 agent 用户组、渠道倍率、初始赠额、充值配置或生产账号；这些属于 S5 运营交付。
- S6 的客户端头统计、专属通知协议未纳入本次；公告继续复用已有 status 能力。
