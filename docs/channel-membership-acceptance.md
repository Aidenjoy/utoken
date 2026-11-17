# 按渠道额度会员：阶段一至三验收

## 本轮交付边界

- 复用套餐、余额购买、订单、用户订阅、Key 和消费日志；阶段三新增个人菜单“渠道会员” `/memberships`，复用后台订阅管理和 Key 管理。
- `meter_type=quota`（以及历史空值）保持旧计费；`meter_type=channel` 使用渠道快照。
- 文本支持 OpenAI / Azure 的 GPT-4o、GPT-4.1 系列白名单与公开模型名映射；图片新增 OpenAI DALL-E 2 / 3 按实际返回张数计量。具体支持范围以 `MembershipTextModelSupported` 和 `MembershipImageModelSupported` 为准，尚未真实验收。
- 文本只接受 `/v1/chat/completions`，纯文本单输出，显式提供一个正的 `max_tokens` 或 `max_completion_tokens`。图片只接受非流式 `/v1/images/generations`，按最终请求 `n` 预留。工具、多模态、透传、Responses 转换等尚未纳入本计量合同，会员 Key 在发送上游前拒绝。
- 会员订单已接入既有 Epay 路径，固定下单权益快照；其他第三方会员支付入口保持拒绝。余额购买和 Epay 签名回调均仅用 mock 验证，未执行真实支付、充值、余额扣减或付费上游调用。用户明确要求本轮所有资金相关验证只使用 mock。
- 未连接当前 `.env` 的数据库执行任何迁移、购买或调用；没有删除业务数据或重启运行服务。

## 现有 HTTP 接口

管理员创建套餐仍使用 `POST /api/subscription/admin/plans`，请求中的 `plan` 增加：

```json
{
  "meter_type": "channel",
  "total_amount": 0,
  "quota_reset_period": "never",
  "channel_quotas": [
    {
      "channel_id": 123,
      "profile": "openai_chat_text_v1",
      "unit": "input_output_tokens",
      "models": ["gpt-4o-mini"],
      "input_limit": 1000000,
      "output_limit": 200000
    }
  ]
}
```

价格、有效期、启用状态等沿用原字段。渠道必须启用、类型为 OpenAI（文本也可 Azure）、声明配置中的公开模型，映射后的模型必须属于本轮支持清单。其他模型或计量单位不能加入此版本可售配置。修改套餐不改变已开通快照；套餐不能原地切换计量类型。

1. 登录后 `POST /api/subscription/balance/pay`，请求 `{"plan_id":123}`。
2. `GET /api/subscription/self` 获取订阅 ID 和 `channel_quotas`：上限、已用、预留；可用量为 `limit-used-reserved`，有效期取订阅 `end_time`。
3. `POST /api/token/` 创建 Key，保留既有 `name`、模型权限、IP 等字段，并提供 `key_type=language`、`user_subscription_id`、`channel_id`、`expired_time=-1`。使用既有 Key 查询接口取得密钥。
4. 调 `/v1/chat/completions`，例如文本消息和 `max_tokens=128`。多个绑定同一订阅及渠道的 Key 共用快照，不能改绑，也不扣钱包、旧订阅或企业池。

页面已适配：个人菜单 → 渠道会员 → 选套餐 → 购买 → 查看分渠道余额 → 选择渠道创建会员 Key。后台订阅管理可配置文本双额度或图片张数。页面闭环已通过隔离浏览器 mock；真实渠道未验收，不应据此公开售卖。

## 额度与未知结果

- 模型映射、系统提示、禁用字段和参数覆盖完成后，检查最终上游 JSON，再原子预留输入、输出。
- 输入采用最终文本的 UTF-8 字节数加消息格式余量作为保守上界；这是预留估算，不是实际输入 Token。首次 profile 限定已知文本模型，后续 tokenizer/profile 须单独验收。
- 输出按最终实际发送的输出上限预留，重新执行项目共享的最大 Token 边界检查；不接受两个互相歧义的输出上限。
- 在网络调用前持久化 `dispatched`。只有尚未发送的 `prepared` 请求可自动释放全部预留。
- 只使用原始响应中显式存在且一致的 `prompt_tokens`、`completion_tokens`、`total_tokens`。不使用适配器回填、费率转换或总量拆分后的值。原始用量证据单独保存为 `provider_usage`。
- 完整流式结束须有 `[DONE]`、原始分项用量、无流处理错误。断流、网络错误、缺失/不一致用量或超出预留的响应，记录 `pending`，保留预留。
- 请求账本 `subscription_channel_requests` 的 `request_id` 为幂等键；对账后可通过模型层 `FinishMembership` 重复提交同一结算，冲突的终态会拒绝。尚未提供管理对账页面/API，不应手工清零预留。
- 服务中断遗留的 `prepared` / `dispatched` 也必须核对，不能按超时无条件退款。终态结算不检查当前到期状态，避免原订阅到期后丢失已受理工作。
- 会员订阅禁止物理删除，后台可使用现有失效操作；旧额度重置和周期重置不会清空会员额度。

## 验收矩阵

| 模型/接口与适配器 | 单位 | 预留点 | 结算点 | 当前测试/开放状态 | 阻塞项 |
|---|---|---|---|---|---|
| mock OpenAI / GPT-4o mini，`/v1/chat/completions` 非流式 | 真实输入/输出 Token | `TextHelper` 最终 JSON 后、`DoRequest` 前 | TextHelper defer，读取原始响应证据 | mock 闭环通过 | 真实在售渠道实例未验收 |
| 同模型流式 | 同上 | 同上，强制请求上游 usage | 原始用量 + 完整 `[DONE]` 后 | 完整结束及截断测试通过 | 真实代理断连测试待补 |
| Claude `/v1/messages`、Gemini `models/*` | 待逐适配器核对缓存与分项语义 | 阶段三 | 阶段三 | 会员拒绝；普通 Key 保持原逻辑 | 分项归一、缓存与计量真实性 |
| `/v1/completions`、Responses/compact、聊天转 Responses | 待核对 | 阶段三 | 阶段三 | 会员拒绝 | 输出边界及转换路径 |
| `/v1/videos`、remix、Kling、Ark `/api/v3/contents/generations/tasks` | 待核对总 Token、点数、秒或次数 | `relay/relay_task.go` 提交前，需关联任务及原订阅 | `service/task_polling.go` 统一终态处理 | 会员拒绝，未声明支持 | 取消/失败/补录/重复轮询/到期后查询与结算 |
| `/v1/audio/transcriptions`、`translations` | 待核对真实音频用量/时长 | `relay/audio_handler.go` 最终请求前 | 音频适配器及 `service/quota.go` | 会员拒绝 | 排除音频文件时长推算 Token 的伪分项 |
| `/v1/audio/speech` | 待核对真实输出用量/时长 | 同上 | 同上 | 会员拒绝 | TTS 计量合同及可靠终态 |
| `/v1/realtime` | 待核对会话输入/输出 | 会话前及会话中 | 实时 usage 事件 | 会员拒绝 | 替换原钱包检查、会话中耗尽处理 |
| OpenAI DALL-E 2 / 3 generations | 图片张数 | 图片转换及参数覆盖完成后，上游发送前 | 原始 `data` 有效图片条目数 | DALL-E 2 / 3 mock 通过：张数边界、实际返回结算；DALL-E 2 另含差额释放、缺失结果待核对、耗尽零调用 | 真实图片渠道待验收 |
| 图片 edits、Ark 图片、其他图片适配器 | 待核对 Token/张数/次数 | 尚未接入 | 尚未接入 | 会员拒绝 | 每适配器单位、预留与可信返回 |
| embeddings、rerank、moderations | 待核对 Token/次数 | 对应 helper 最终请求前 | 各适配器 | 会员拒绝 | 单输出/总量合同 |
| Suno、Midjourney、swap、其他任务接口 | 待逐平台核对 | 任务提交前 | 任务终态 | 会员拒绝 | 任务归属、计量合同及重放 |
| Ark AK/SK、素材等辅助接口 | 非生成计量待定义 | 尚未接入 | 尚未接入 | 会员 AK/SK 鉴权拒绝 | 阶段三决定可用接口及任务查询权限 |

## 自动验证

```bash
GOCACHE=/private/tmp/yun-token-go-cache go test \
  ./model ./controller ./middleware ./service ./relay ./relay/channel/openai ./relay/helper \
  -count=1 -timeout=120s
```

- 新增模型测试：余额购买/快照、失败回滚、归属、双维度并发预留、幂等结算/释放、未知结果不可自动退款、到期拦截及已受理请求到期后结算、模型层模拟重复支付与权益版本。
- 新增 HTTP 测试：购买 → 创建会员 Key → 真实 TokenAuth/Distribute/Relay → mock 上游 → 双项扣减；输入/输出不足上游零调用；并发争抢；普通 Key 继续扣钱包；最终参数覆盖；缺失/不一致用量；完整与截断流式。
- SQLite、MySQL 8.0、PostgreSQL 15 均在独立测试库实际通过会员测试：购买发放、失败回滚、并发预留、幂等结算、旧订阅迁移隔离，以及旧 Token 权益加图片数量列后的零默认值兼容。MySQL / PostgreSQL 每个测试创建独立库并保留，不执行删库删表。未连接 `.env` 的业务库。
- 新增会员测试已通过 `go test -race ./model ./controller -run '^TestMembership'`。不同会员 Key 的共享额度、模型映射和普通价格为零仍扣会员额度也纳入 HTTP 验收。
- 扩大回归时，model、middleware、service、relay、OpenAI 适配器、relay/helper 的完整测试通过。controller 完整测试有一项既有失败：`TestRelayArkAssetAction_ValidationError/CreateAsset_missing_GroupId` 预期 `InvalidParameter`，实际 `ChannelBindingRequired`；已在开发前提交 `b19e4b9c` 的独立临时副本复现，未修改该无关逻辑。新增会员及订阅/计费聚焦回归通过，不能将整个 controller 包描述为全绿。

## 2026-11-20 候选上线范围

- 当前只有 mock OpenAI 文本合同通过会员闭环，**尚无可宣布对外开放的真实渠道实例**。
- 真实渠道必须同时验收会员扣减、上游输出上限、并发、断流、缺失 usage、旧 Key 回归，并完成前端展示与数据库迁移验证。普通 Key 调通不能替代这些测试。
- 未读取远程业务库中的实际在售模型清单，因此本表是源码接口覆盖清单，不能宣称已逐个核验在售渠道。后续需将实际渠道 ID/模型/适配器与本表逐项关联，补齐每个对外声明支持渠道的结果。
- 阶段三完整范围保留：页面、一个已开通网关的支付测试环境、视频、语音、图片、其他公开协议与辅助接口；周额度、五小时窗口、自动续费不在本版。


## 阶段三增量证据（2026-11-17）

### 数据与资金边界

- `.env` 保持原样；未连接配置中的远程 MySQL，未重启业务服务，未删除业务数据。
- 购买、支付、普通 Key 计费回归全部使用合成账户、独立测试库和本机 mock 上游。没有真实渠道或支付沙箱验收结果。
- Epay mock 验证：待付款无权益、支付失败无权益、错误签名拒绝、错误金额拒绝、正确回调开通、重复回调只发放一次、套餐修改或渠道停用后仍按订单快照发放；调用时仍检查渠道状态。
- 图片数量使用独立 `quantity_limit/used/reserved`，Token 字段为零；不会把图片次数换算成输入/输出 Token。每套餐每渠道只有一种计量合同，不混合图片和文本权益。
- 实时语音在鉴权之外增加预扣和结算边界拦截；尚未实现实时会员计量，不能宣称语音已接入。

### 验证命令及结果

```bash
GOCACHE=/private/tmp/yun-token-go-cache go test -race ./model ./controller -run '^TestMembership' -count=1 -timeout=120s
GOCACHE=/private/tmp/yun-token-go-cache go test ./service -run '^TestMembership' -count=1 -timeout=120s
# 外部数据库凭证只来自独立本地测试实例；不要替换成业务库 DSN。
MEMBERSHIP_TEST_DIALECT=mysql MEMBERSHIP_TEST_DSN='<local independent mysql DSN>' GOCACHE=/private/tmp/yun-token-go-cache go test ./model -run '^TestMembership' -count=1 -timeout=120s
MEMBERSHIP_TEST_DIALECT=postgres MEMBERSHIP_TEST_DSN='<local independent postgres DSN>' GOCACHE=/private/tmp/yun-token-go-cache go test ./model -run '^TestMembership' -count=1 -timeout=120s
cd web/default
bun run typecheck
bun run build
# playwright-core 安装在临时目录，没有新增项目依赖。
NODE_PATH=/private/tmp/yun-token-membership-ui/node_modules node scripts/test-channel-membership-ui.mjs
```

- 本轮 model / controller / service 会员 `-race` 通过；实时语音预扣与后结算的禁用钱包回退测试通过。日志 `/private/tmp/yun-token-member-final.log`。
- MySQL 通过（3.892s）、PostgreSQL 通过（3.700s）；日志分别为 `/private/tmp/yun-token-membership-mysql.log`、`/private/tmp/yun-token-membership-postgres.log`。
- 前端类型检查及构建通过。隔离浏览器 mock 返回 `MOCK_UI_PASS`：购买、文本 Key、图片 Key、后台保存均成功，手机无横向溢出，`realApiCalls=0`。
- UI mock 拦截所有 API 并阻断外部请求；真实后端不参与。截图保留在 `/private/tmp/yun-token-membership-{balances,admin,zh,mobile}.png`。
- 既有素材库 controller 回归失败与本次新增回归分开记录，见上文；不声明完整 controller 包全绿。未调用 Apifox，本轮 HTTP 验证使用真实路由链测试和隔离浏览器 mock。

### 可交互 mock 预览

```bash
node web/default/scripts/preview-channel-membership-mock.mjs
# 浏览器打开 http://127.0.0.1:5189/memberships
```

该服务只监听回环地址，直接响应模拟 API，不代理业务接口、不读取 `.env`；页面有 MOCK 标识，模拟变更追加保存在 `/private/tmp/yun-token-membership-mock-journal.jsonl`，重启重放且不删除记录。仅用于展示页面操作，扣减正确性以 Go 回归为准。

### 未完成的完整开发范围

| 范围 | 已有证据 | 仍需实现或验收 |
|---|---|---|
| OpenAI / Azure 文本 | 两种适配器普通/流式 mock、GPT-4.1 mini 映射、额度不足零调用 | 其他白名单模型逐项 mock、真实渠道会员用量与输出边界验收 |
| DALL-E 图片 | DALL-E 2 / 3 张数边界及结算；DALL-E 2 差额释放/缺失结果/耗尽拦截 | 各真实图片渠道验收 |
| 视频 | 查明 `RelayTaskSubmit` 预扣与 `ApplyUpstreamTaskResult` 终态路径，会员目前拒绝 | 任务绑定原订阅、异步预留、成功/失败/取消、重复轮询、补录、到期查询；Kling 点数不得使用旧转换 Token，Ark 总量不得拆成输入/输出 |
| 转写/合成/实时语音 | 未支持接口鉴权拒绝；实时计费边界额外拒绝钱包回退 | 可信单位、可执行预留上限、实时会话中预算与耗尽处理 |
| Claude/Gemini/Responses/其他接口 | 未支持路径拒绝并保持普通 Key 原逻辑 | 按适配器核对真实用量、最终请求预留和结算 |
| 正式支付 | Epay 签名与订单事务 mock | 实际启用状态及真实沙箱未验证；按用户限制不进行真实资金操作 |

截至周五 **2026-11-20**，当前可确认开放售卖的真实渠道清单为 **空**。mock 通过的候选仅为上述文本与图片合同；不能把 mock 结果或普通 Key 可用替代真实会员验收。阶段三仍在进行，未完成视频、语音及全部在售接口覆盖。
