# 桌面客户端模型调用日志 API

## 1. 接口与认证

- 完整本地 URL：`http://127.0.0.1:3000/api/desktop/usage-logs`。部署时将 origin 换成已有 UToken 服务端地址。
- 方法：仅 `GET`。没有新增 POST/PUT/PATCH/DELETE 能力。
- 复用历史接口的原认证链：`middleware.DesktopBalanceAuth()` → `controller.ConversationAuth`。没有修改这两个实现。
- 桌面 Bearer：发送现有、尚未过期或撤销的桌面 `access_token`；查询不消费该凭证。
- Cookie：Electron 已经通过 `/api/desktop-auth/session` 兑换网页会话后，发送原 `session` Cookie 和匹配的 `New-Api-User` 请求头。新签发的桌面 Bearer 有效期为 90 天；兑换 Cookie 后仍继续有效，直到原到期时间或主动撤销。Cookie 沿用现有 30 天有效期。已有 Token 不批量续期；已兑换并删除的旧 Token 需要重新授权获取。
- 普通模型 `sk-...` Key、其原始 Key 和系统管理 access token 均不能作为新的日志凭证。
- 只使用认证上下文中的用户 ID。即使登录账号是管理员/root，也只查询本人记录。桌面 Bearer 路径不会信任 `New-Api-User` 指定其他账号；Cookie 路径仍校验该请求头必须与登录会话一致。
- 成功和查询错误响应设置 `Cache-Control: no-store`，认证失败沿用现有认证响应格式。

## 2. 查询参数与边界

| 参数 | 类型 | 默认值/规则 |
|---|---|---|
| `p` | 整数 | 默认 1，必须 >=1 |
| `page_size` | 整数 | 默认 20，范围 1–100 |
| `ps` / `size` | 整数 | 兼容原项目页大小别名；三种页大小参数只能使用一种 |
| `start_timestamp` | Unix 秒整数 | 默认 0，不设下界；非零时包含该时刻 |
| `end_timestamp` | Unix 秒整数 | 默认 0，不设上界；非零时包含该时刻，必须 >= start_timestamp |
| `model_name` | 字符串 | 默认不限，最多 256 字节；无 `%` 时精确匹配，有 `%` 时复用原日志通配符规则 |

- 起始偏移 `(p-1)*page_size` 必须 <=9999，依据既有日志搜索预算限制深分页。page_size=20 时最大 p=500。`total` 仍为全部符合条件记录的真实数量，不截断或伪造总数。
- 通配符规则沿用原 `applyExplicitLogTextFilter`：不允许连续 `%%`，最多两个 `%`，移除 `%` 后至少两个字节；`_` 等字符按原转义规则处理。
- 时间为服务端保存的 Unix 秒，不是毫秒；负数、解析溢出、反向时间范围均返回 400。当前原普通用户日志控制器/查询未设置按天数计算的服务端时间窗口，本接口没有取消或虚构额外窗口限制。
- 仅支持上述参数；重复参数、冲突页大小别名、非法 URL 编码，以及 `user_id`、`username`、`type`、`channel` 等其他参数返回 400。它们不能改变查询身份或日志类型。
- 排序：SQLite/MySQL/PostgreSQL 使用 `created_at DESC, id DESC`，同秒记录按 ID 稳定倒序。独立分页查询之间如发生新日志插入，offset 分页可能移动位置，与原分页协议一致。

## 3. 查询范围及字段对应

固定读取已有 `LOG_DB.logs`，`user_id` 等于认证用户，类型为源码中的 `model.LogTypeConsume`（2）或 `model.LogTypeError`（5），且 `model_name` 非空。保留模型失败行，不包含充值、管理、系统、退款、登录、素材 API 审计（8/9）和其他账号的日志。

DTO 保留已有普通用户可见的原始列，并新增 `consumption` 展示对象：

| 返回字段 | 原 Log 字段/含义 |
|---|---|
| `id` | `Id`，保存的数据库 ID；不采用原 `/api/log/self` 的展示序号重排 |
| `created_at` | `CreatedAt`，Unix 秒 |
| `model_name` | `ModelName`，原模型名，不提供另一个 `model` 别名 |
| `type` | `Type`，原记录类型，2 消费、5 模型错误 |
| `prompt_tokens` | `PromptTokens`，原输入 Token 数 |
| `completion_tokens` | `CompletionTokens`，原输出 Token 数 |
| `quota` | `Quota`，原钱包额度整数，不换算金额 |
| `subscription_quota` | `SubscriptionQuota`，原订阅扣减额度整数，独立于钱包 quota |
| `token_name` | `TokenName`，原 API Key 名称，绝不返回 Key 值 |
| `request_id` | `RequestId`，原请求标识；缺失时空字符串 |
| `http_status` | `HttpStatus`，原列值；历史未记录的 0 原样返回，不虚构成功 |
| `use_time` | `UseTime`，原耗时，秒 |
| `is_stream` | `IsStream`，原流式标记 |
| `cache_hit` | `CacheHit`，原响应缓存命中标记 |
| `task_settle` | `TaskSettle`，原异步任务差额结算标记 |

- 没有返回 `total_tokens`：现表没有该列，本次不重新计算历史 Token。
- 没有新增推算的 `status`：只保留 type 与已有 http_status；不会把失败行或未知状态改成成功。
- 不从钱包余额或日志 quota 推算收费来源，不合并钱包与订阅额度，不重新结算/扣费/退款。任务结算行继续保留原有口径，不应把其完整 Token 用量与预扣记录重复汇总。
- 不返回完整 `Log`：排除 user_id/username/IP、content/other、渠道配置、token_id、上游请求 ID/Token、倍率/单价/表达式、管理员调试信息和协议快照。与普通用户脱敏相比采用更窄的字段白名单，避免未知 other 扩展字段泄露。

### 消耗展示对象 `consumption`

2026-11-23 补充：桌面展示与 Web「用户使用记录」对齐。原 `quota`、`subscription_quota` 保持原值，客户端直接展示以下换算后的字段，**不要再次除 quotaPerUnit 或再次乘汇率**。

| 字段 | 用途 |
|---|---|
| `consumption.wallet_amount` | 钱包展示数值；订阅记录按 Web 规则显示为 0 |
| `consumption.wallet_unit` | USD / CNY / CUSTOM / TOKENS，遵循站点展示设置 |
| `consumption.wallet_symbol` | 钱包货币符号，如 `$`、`¥`、`€`；TOKENS 为空 |
| `consumption.subscription_points` | 套餐展示点数；钱包记录为 0 |
| `consumption.subscription_unit` | 固定 `points`，表示点数，不是货币 |

- 记录归类复用 Web `getLogCharges` 的确切规则：`subscription_quota > 0` 或已保存的 `other.billing_source == "subscription"`，则钱包展示为 0，订阅原值取非零 subscription_quota，否则回退历史 quota；其他记录取钱包 quota。即使两列均非零，也保持 Web 的订阅优先展示语义，不额外推算混合扣费。
- 历史 billing_source 只在服务端从原 other 中读取这一属性；原 other/管理员信息仍不返回。
- 数值换算遵循 Web `formatLogQuota` / `formatSubscriptionPoints`：USD 为原值 ÷ QuotaPerUnit；CNY 再乘 USDExchangeRate；CUSTOM 再乘配置汇率；TOKENS 展示模式直接使用原值。套餐也沿用 Web 当前的全局展示换算，但单位始终是 points、无货币符号。
- 这里返回数值和单位，不固定中文/英文文案或千分位。钱包可按 Web 的大额最多4位、小额最多6位小数展示，点数最多6位。这里只做展示换算，不修改存储、不重新计费。

例如假设 QuotaPerUnit=500000、展示 USD：钱包 quota=125000 显示 `$0.25`；套餐 subscription_quota=500000 显示 `1 points`，而不是 `$1`。若站点为 CNY 且汇率7.3，同一原始套餐值依现有 Web 规则显示 `7.3 points`。

## 4. 成功响应示例

以下全部为合成数据：

```json
{
  "success": true,
  "message": "",
  "data": {
    "page": 1,
    "page_size": 20,
    "total": 1,
    "items": [
      {
        "id": 4101,
        "created_at": 1700000000,
        "model_name": "example-model",
        "type": 2,
        "prompt_tokens": 11,
        "completion_tokens": 7,
        "quota": 125000,
        "subscription_quota": 0,
        "token_name": "example-key-name",
        "request_id": "example-request-id",
        "http_status": 200,
        "use_time": 2,
        "is_stream": true,
        "cache_hit": false,
        "task_settle": false,
        "user_input": "请介绍一下这个模型。",
        "user_input_truncated": false,
        "consumption": {
          "wallet_amount": 0.25,
          "wallet_unit": "USD",
          "wallet_symbol": "$",
          "subscription_points": 0,
          "subscription_unit": "points"
        }
      }
    ]
  }
}
```

无日志：`data.total=0`，`data.items=[]`，仍返回 HTTP 200。

## 5. 错误响应

| HTTP | 场景 | 示例 |
|---|---|---|
| 401 | 缺失、无效、过期、撤销的桌面凭证 | `{"error":"invalid_token"}`，沿用桌面认证 |
| 401 | Cookie 路径缺失/不匹配的用户头 | 原 Cookie 鉴权的 `success=false,message=...` 响应 |
| 400 | 非法页码、页大小、深分页或冲突别名 | `{"success":false,"message":"invalid_pagination"}` |
| 400 | 非法时间/溢出/反向时间 | `{"success":false,"message":"invalid_time_range"}` |
| 400 | 不支持/重复参数、非法模型模式或 URL 编码 | `{"success":false,"message":"invalid_query"}` |
| 500 | 日志数据库查询失败 | `{"success":false,"message":"usage_logs_unavailable"}` |
| 500 | 桌面身份数据库校验失败 | `{"error":"server_error"}`，沿用原认证 |

不会在响应中返回 SQL、连接信息、原始日志正文或凭证。Cookie 账号状态等其他鉴权分支保持项目原响应语义，本次不统一改写旧认证。

## 6. 本地 curl / Apifox

只向本地或隔离测试站点发送测试凭证，不使用生产用户。以下 shell 变量由自己设置，不要把真实凭证写入文档或提交代码。

```bash
export UTOKEN_BASE_URL='http://127.0.0.1:3000'
read -r -s UTOKEN_DESKTOP_TOKEN
curl --fail-with-body --get "$UTOKEN_BASE_URL/api/desktop/usage-logs" \
  -H "Authorization: Bearer $UTOKEN_DESKTOP_TOKEN" \
  --data-urlencode 'p=1' \
  --data-urlencode 'page_size=20'
```

增加时间及模型过滤：

```bash
curl --fail-with-body --get "$UTOKEN_BASE_URL/api/desktop/usage-logs" \
  -H "Authorization: Bearer $UTOKEN_DESKTOP_TOKEN" \
  --data-urlencode 'start_timestamp=1700000000' \
  --data-urlencode 'end_timestamp=1800000000' \
  --data-urlencode 'model_name=example-model' \
  --data-urlencode 'p=1' --data-urlencode 'page_size=20'
```

已兑换 Cookie 的客户端：使用已有隔离测试会话导出的 Cookie 文件和该账号 ID，不重新设计登录或再兑换凭证。

```bash
curl --fail-with-body "$UTOKEN_BASE_URL/api/desktop/usage-logs?p=1&page_size=20" \
  -b /tmp/utoken-test-cookies.txt \
  -H "New-Api-User: $UTOKEN_TEST_USER_ID"
```

验证错误边界：

```bash
curl -i "$UTOKEN_BASE_URL/api/desktop/usage-logs"
curl -i "$UTOKEN_BASE_URL/api/desktop/usage-logs?page_size=101" \
  -H "Authorization: Bearer $UTOKEN_DESKTOP_TOKEN"
curl -i "$UTOKEN_BASE_URL/api/desktop/usage-logs?user_id=999" \
  -H "Authorization: Bearer $UTOKEN_DESKTOP_TOKEN"
```

- Apifox 导入同目录 `desktop-usage-logs-openapi.json`，配置本地 base URL；选择桌面 HTTP Bearer，或 session Cookie + New-Api-User，二者沿用原登录产物。
- 默认无凭证请求应 401；携带有效隔离凭证时，上述非法分页/身份参数应 400。更换账号应只能看到其本人的记录。
- 当前执行环境没有连接 Apifox 工具或会话，**未执行 Apifox 操作，也未宣称人工 curl 已运行**；已执行的是下述真实路由/认证/临时数据库的自动化 HTTP 测试。

## 7. 开发检查与修改范围

新增：

1. `dto/desktop_usage.go`：安全响应 DTO 与强类型查询条件。
2. `model/desktop_usage.go`：在已有日志库上的独立只读查询。
3. `controller/desktop_usage.go`：参数校验、现有分页格式、受控错误响应。
4. `controller/desktop_usage_test.go`：临时主库/日志库、合成用户/凭证及 HTTP 测试。
5. `docs/desktop-usage-logs.md`：本文。
6. `docs/desktop-usage-logs-openapi.json`：独立 OpenAPI。

修改：`router/api-router.go` 相比本任务开始时只增加一条 GET 路由及空行。前一任务的会话同步等所有未提交文件保持不变，逐文件 SHA-256 核对。

- 原接口：`GET /api/log/self`、`GET /api/log/self/stat`；self/search 已废弃，token 日志接口另有其原 API Key 认证。管理员接口及协议快照权限保持原状。
- 没有直接调用 `GetUserLogs`：它会改写展示 ID、主要按 ID 排序，并只接受单一类型，无法同时满足本次原 ID/时间排序/消费+模型失败范围。新增封装复用同一 `LOG_DB`、`Log` 元数据和 `applyExplicitLogTextFilter`，没有创建第二套存储/统计。
- 没有修改 `controller/log.go`、`model/log.go`、桌面授权、认证 middleware、会话功能、任何计费代码或前端 UI。
- **数据库变化：无**。没有新增表、字段、索引、迁移、写入流程或清理策略。
- SQLite 隔离运行通过；MySQL/PostgreSQL 仅完成标准 GORM/参数绑定的代码兼容性检查，未连接真实实例进行运行时验证。

## 8. L01–L20 验收

| 编号 | 结果 | 证据/边界 |
|---|---|---|
| L01 | 隔离 HTTP 自动化通过 | 真实桌面摘要凭证查询 HTTP 200，含 no-store |
| L02 | 隔离 HTTP 自动化通过 | 缺失、过期、非法桌面凭证拒绝；Cookie 用户头不匹配拒绝 |
| L03 | 隔离 HTTP 自动化通过 | 已入测试库的模型 Key（sk- 及原值）和管理 access token 拒绝 |
| L04 | 隔离 HTTP 自动化通过 | A 得到本人消费/模型错误，原始 Token、quota、subscription_quota 保持 |
| L05 | 隔离 HTTP 自动化通过 | B 只有 B；身份/类型参数被拒绝，伪造桌面用户头不能切换账号 |
| L06 | 隔离 HTTP 自动化通过 | root 经新接口只得到 root 自己一条记录 |
| L07 | 隔离 HTTP 自动化通过 | 默认 20、显式分页、别名、空页、准确总数及同秒排序 |
| L08 | 隔离 HTTP 自动化通过 | 开始/结束边界均包含；非法范围拒绝 |
| L09 | 隔离 HTTP 自动化通过 | 模型精确/通配符筛选；注入样式字符串仅作普通值 |
| L10 | 隔离 HTTP 自动化通过 | 非数字、0、负数、溢出、>100、深分页、重复/冲突别名、非法编码拒绝 |
| L11 | 隔离 HTTP 自动化通过 | 空账号 items=[]、total=0 |
| L12 | 隔离 HTTP 自动化通过 | 关闭临时日志库连接后受控 500，主库认证仍可用，不泄露 SQL |
| L13 | 隔离 HTTP 自动化通过 | 重复 GET 后全部测试日志、桌面凭证和 Key 对象完全一致 |
| L14 | 隔离 HTTP 自动化通过 | 查询前后完整 User 对象（含钱包、used_quota）一致 |
| L15 | 隔离 HTTP 自动化通过 | 查询前后完整 UserSubscription 对象（含 AmountUsed）一致 |
| L16 | 隔离 HTTP 自动化及原回归通过 | 旧 self 接口仍保留原筛选、脱敏与展示序号行为 |
| L17 | 隔离 HTTP 自动化及原回归通过 | 旧管理员 handler 仍保持原全站范围；原路由权限未改动 |
| L18 | 隔离 HTTP 自动化通过 | 原历史认证链可查列表；原跨设备 HTTP/事务测试回归通过 |
| L19 | 原 Mock/隔离回归通过 | 桌面登录/PKCE、认证、API Key 相关测试；Electron 原 PKCE Mock 两项通过 |
| L20 | 原隔离回归通过 | model/common/service/relay 的钱包、套餐、额度及 Token 计费测试通过 |

额外断言：响应字段不含敏感原文/other/渠道/上游信息；未知 http_status=0 保持未知；新路径非 GET 不存在。没有调用模型、扣费、退款或修改凭证。

## 9. 执行命令与既有失败

```bash
GOCACHE=/tmp/utoken-history-go-cache go test ./controller ./model ./router -run 'TestDesktopUsage' -count=1
GOCACHE=/tmp/utoken-history-go-cache go test ./controller -run 'Test(DesktopUsage|DesktopLogin|Conversation|UserLogResponse)' -count=1
GOCACHE=/tmp/utoken-history-go-cache go test ./model ./controller ./middleware ./router ./common ./service ./relay/... -count=1
node --test electron/desktop-auth.test.js
```

- 新接口测试及聚焦回归通过；`go vet ./controller ./model ./dto ./router`、`git diff --check` 均通过。已有 25 个非 router 未提交文件的 SHA-256 完全一致，router 相对任务开始时仅新增指定 GET。
- 完整 Go 范围的 controller 包存在上一任务已确认的既有失败：`TestRelayArkAssetAction_ValidationError/CreateAsset_missing_GroupId`，期望 `InvalidParameter`，实际 `ChannelBindingRequired`。没有改动该模块，也没有把完整回归标为全部通过。
- 完整范围其余包通过；仅跳过上述已知失败子用例后，controller 全部其余回归通过：

```bash
GOCACHE=/tmp/utoken-history-go-cache go test ./controller \
  -skip '^TestRelayArkAssetAction_ValidationError$/^CreateAsset_missing_GroupId$' -count=1
```

- 未使用真实付费模型、生产数据或生产数据库；现有 Mock 需要本机临时端口，因此在允许 localhost 监听的隔离执行环境运行。
- 尚未执行：Apifox GUI、真实桌面 GUI 操作、MySQL/PostgreSQL 运行时验收。后端本地/隔离完成标准由自动化证据支持，不能替代这些人工/异构数据库验收。
- 回滚只需移除新 GET 路由及上述新增文件；没有数据库变更，也不会丢失已有日志、余额、套餐或会话记录。不要撤销前一任务的未提交修改。

## 10. 消耗展示调整验证

- 保留原日志字段、认证和分页；只增加展示 DTO、读取历史 billing_source 所需的内部 other 字段，后者 `json:"-"` 不输出。
- 新展示对应 `web/default/src/features/usage-logs/lib/format.ts:getLogCharges`、`web/default/src/lib/format.ts:formatSubscriptionPoints` 及 `web/default/src/lib/currency.ts` 的换算口径；没有修改 Web UI 或计费代码。
- 已有桌面日志、登录、会话及脱敏聚焦回归通过。额外使用 `/tmp` 临时程序和纯内存 SQLite，实际调用 HTTP handler 验证 USD、CNY、CUSTOM、TOKENS 下的钱包/订阅/历史订阅回退，并验证原始数据库值不变；没有新增仓库单元测试。

## 11. 对应请求的用户输入

日志项新增：

```json
{
  "request_id": "example-request-id",
  "user_input": "请介绍一下这个模型。",
  "user_input_truncated": false
}
```

- `user_input`：可空字符串，取该次模型请求里最后一条 `role=user` 的文本，不是整个历史上下文。最长 4096 个 Unicode 字符。
- `user_input_truncated`：超过上述长度时为 true；未截断或输入不可用时为 false。客户端可将 true 显示为“输入预览已截断”。
- 复用已有 `log_bodies.request_data`，按本页已完成用户隔离的日志 request_id 批量读取。日志库与主库可以分离，不跨库 JOIN、不逐条查询；流式读取快照行，不累计保留整页完整请求体。
- 支持已保存的 OpenAI/Claude messages、Responses 的字符串 input 或带 user 角色的消息数组、Gemini contents 中明确 user 角色的 text parts，以及独立字符串 prompt/input。消息数组只读取 text/input_text 文本块，不读取图片、文件地址、工具结果或其他扩展参数。
- 不返回 system/developer/assistant/tool 消息、response_data、完整 request_data；原管理员协议快照接口的权限没有改动。
- 原请求未留快照、快照还在异步写入、快照截断导致 JSON 不完整、内容只有媒体、格式不支持或不存在明确用户文本时，`user_input=null`。不能从会话更新时间或相邻日志猜测，不能补造历史输入。真实的空字符串用户文本则返回 `""`。
- 当前请求日志与 conversation_id 没有持久化关联，因此本次按准确的 request_id 对应本次调用输入，不提供虚构的会话 ID 或整段对话关联。
- 快照读取失败仅记录不含正文的服务端故障日志，本次日志接口仍返回 200 和原日志数据，输入为 null；不触发模型、扣费、退款或新增快照写入。
- 没有新增表、改变旧日志写入、增加请求采集范围或修改前端。

验证：原桌面日志、登录、会话及日志隐私/协议权限相关回归通过；额外使用临时内存 SQLite 和合成请求，验证最后用户输入、系统/助手/媒体排除、主流请求结构、Unicode 截断、账号隔离和快照库故障降级。没有使用真实生产对话或付费模型。
