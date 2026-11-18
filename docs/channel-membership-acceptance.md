# 按渠道额度会员：阶段一至三验收

## 当前产品口径（2026-11-18，覆盖此前的用户展示要求）

- 对外仍是一个会员套餐，仅展示名称、价格、有效期、渠道/模型和可用状态，不展示内部 Token 上限、已用、预留或剩余量；其他会员计量额度也统一保留在后台。
- 后台输入/输出 Token 额度继续独立配置和查看，实际调用仍按可信输入/输出用量分别扣减；未修改预留、结算、购买权益快照或任何存量数据。
- `/api/subscription/plans` 与 `/api/subscription/self` 对会员权益做响应投影，不返回具体额度字段；保留创建 Key 所需订阅/渠道绑定，并提供 `available` 状态。管理员接口继续返回完整配置与台账。
- 普通 quota 套餐保持原展示及接口行为。模型调用本身的标准 usage 响应和历史请求用量日志不属于套餐额度展示，本次未更改。
- 额度不足对用户提示“套餐额度不足”。本次验证全部使用本地 mock；不连接真实模型、不执行真实资金操作、不迁移或删除业务数据。

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
2. `GET /api/subscription/self` 获取订阅 ID、渠道/模型和 `available` 状态；具体额度仅后台可见，有效期取订阅 `end_time`。
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
| remix、Kling、Ark `/api/v3/contents/generations/tasks` | 待核对总 Token、点数、秒或次数 | `relay/relay_task.go` 提交前，需关联任务及原订阅 | `service/task_polling.go` 统一终态处理 | 会员拒绝，未声明支持 | 取消/失败/补录/重复轮询/到期后查询与结算 |
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
| Sora 视频 | `sora-2` / `sora-2-pro` 共用成功视频次数合同，提交预留、终态原子结算、失败/取消回执返还预留、到期查询、未知结果 pending 已通过 mock | 真实渠道未验收；其他平台的原始用量合同与接入仍待完成 |
| 转写/合成/实时语音 | 未支持接口鉴权拒绝；实时计费边界额外拒绝钱包回退 | 可信单位、可执行预留上限、实时会话中预算与耗尽处理 |
| Claude/Gemini/Responses/其他接口 | 未支持路径拒绝并保持普通 Key 原逻辑 | 按适配器核对真实用量、最终请求预留和结算 |
| 正式支付 | Epay 签名与订单事务 mock | 实际启用状态及真实沙箱未验证；按用户限制不进行真实资金操作 |

截至周五 **2026-11-20**，当前可确认开放售卖的真实渠道清单为 **空**。mock 通过的候选仅为上述文本与图片合同；不能把 mock 结果或普通 Key 可用替代真实会员验收。阶段三仍在进行，未完成视频、语音及全部在售接口覆盖。


## 视频增量验收（2026-11-17）

### 共用机制与计量边界

- 新合同 `sora_completed_video_v1`，单位 `completed_videos`。每个成功的单视频资源扣一次；失败或取消的可信终态回执结算为零并返还预留。时长、金额、点数不换算成 Token。
- 共用原有渠道额度账本；适配器通过 `MembershipTaskMeter` 只提供原始终态判定。不同渠道不会复制购买、预留、并发控制和结算逻辑。
- 当前实现覆盖 OpenAI / Sora 类型的 Sora 适配器，模型 `sora-2` / `sora-2-pro`。只接受 JSON 文生视频 `POST /v1/videos`，最终请求只允许 model/prompt/seconds/size；时长限定 4/8/12 秒。不包含 remix、图片输入、批量任务、Ark、Kling 等其他协议。
- 公共 task_id 在发送前生成并作为会员请求幂等 ID。提交前原子预留一次；上游接受后，任务保存原会员请求绑定和上游 ID。会员视频跳过钱包价格预扣、提交即扣费和旧轮询 Token 换算。
- 终态处理入口复用 `ApplyUpstreamTaskResult`。适配器核对回执中的任务 ID 和可选模型，再由数据库事务同时更新任务终态、真实回执和会员账本。重复轮询/补录不重复扣；冲突终态拒绝覆盖。
- 失败 HTTP、断连、未知状态、任务 ID 不匹配均不能证明视频失败，保留预留并记录 pending。不得按超时自动退款，提交失败不重试生成。
- 订阅到期或渠道停用后，绑定该订阅的 Key 仍能查询已受理任务；新提交拒绝。其他订阅即使属于同一用户、同一渠道也无权读该任务。
- 已有内容代理入口的会员鉴权允许到期后读取自身任务；本轮仅验证内容路由鉴权，用固定 mock 字节响应替代下载，没有真实下载模型产物。
- 没有新增取消 API。上游 `cancelled` 终态回执通过统一终态入口返还预留；旧的本地取消和钱包退款函数拒绝会员任务，避免未经上游确认就释放额度。
- 界面沿用“渠道会员”入口，后台可配置成功视频次数，用户可看上限/已用/预留/可用并选择模型创建视频会员 Key。普通视频 Key 仍保留创建时自动匹配渠道，会员 Key 固定权益渠道。

### 实测与复现

```bash
GOCACHE=/private/tmp/yun-token-go-cache go test -race ./model ./controller ./service -run '^TestMembership' -count=1 -timeout=120s
GOCACHE=/private/tmp/yun-token-go-cache go test ./controller ./relay/channel/task/sora -run '^(TestMembershipHTTPVideo|TestRelayTaskBoundVideoKeyRetriesSameChannel|TestLockTokenBoundVideoChannelScope|TestShouldRetryTaskRelay|TestAddVideoToken|TestParseTaskResultStatusMapping)' -count=1 -timeout=120s
# 同前文独立本地数据库环境变量，追加的新视频事务测试也纳入 ^TestMembership。
cd web/default
bun run typecheck
bun run build
NODE_PATH=/private/tmp/yun-token-membership-ui/node_modules node scripts/test-channel-membership-ui.mjs
```

- mock HTTP：购买 → 视频 Key → 提交 → 预留 → 余额耗尽上游零新增调用 → 到期/渠道停用后查询 → completed/failed/cancelled 回执 → 结算 → 重复回报。另含 Sora Pro、错误任务 ID、未知 HTTP 结果不重试、跨订阅拒绝和钱包不变。
- model：终态任务与账本事务失败回滚、两个并发终态回放只扣一次、到期后结算和终态冲突拒绝。SQLite / MySQL / PostgreSQL 共用同一个测试；没有删库删表或清理测试数据。
- 本地 MySQL 8.0 全会员模型测试通过（9.493s），PostgreSQL 15 通过（8.050s）；日志 `/private/tmp/yun-token-video-mysql.log`、`/private/tmp/yun-token-video-postgres.log`。
- 会员 model/controller/service `-race` 通过；日志 `/private/tmp/yun-token-video-race.log`。普通视频 Key 相关路由/重试和 Sora 解析聚焦回归通过，日志 `/private/tmp/yun-token-video-regression.log`。
- 前端类型检查及构建通过，改动文件 lint 通过。隔离浏览器 `MOCK_UI_PASS` 新增 `videoCreated=true`，模型选择正确，手机无横向溢出，`realApiCalls=0`；日志 `/private/tmp/yun-token-video-ui.log`。

### 本轮后仍未完成

- Sora 适配器的 OpenAI 类型渠道实例尚需独立场景验收；Sora 类型已完成 mock，不代表任何真实实例可售。
- 其他视频平台应提供其真实总量/点数/时长/次数合同，再复用任务账本；不使用旧适配器的伪分项 Token。
- 主动取消 API、异常任务管理对账页面、语音各接口、其他文本协议、其他图片接口仍待开发。既有素材库失败依旧与会员回归分开记录。
- 按用户强制边界，本轮及后续均不真实请求任何模型，不执行真实充值、支付或余额扣款；真实验收未执行，可宣布真实售卖的渠道清单仍为空。

### 当前收尾状态

- 本轮视频增量保留在工作区，尚未提交；不会覆盖前两笔阶段三提交。
- 最后一次执行受限操作时，自动审批服务因使用额度限制无法完成审核；最终复验、独立 mock 预览重启及 git 提交尚未执行，不能当作通过或已提交。
- 已通过的 race、数据库及浏览器证据为上文实际日志。最后将模型层纯账本夹具的示例模型统一为 Sora 2 后未再次执行后端测试；最终交付前仍需复验。
- OpenAI 类型渠道的独立 Sora 任务场景仍待增加；当前 Sora 2 / Pro HTTP mock 均使用 Sora 类型。
- 模型真实调用和真实资金操作持续禁止；没有任何真实验收结果。

### 2026-11-18 展示调整验证

- `GOCACHE=/private/tmp/yun-token-go-cache go test ./controller ./model -run '^TestMembership' -count=1 -timeout=120s` 通过（controller 3.343s、model 2.919s）；日志 `/private/tmp/yun-token-membership-public-tests.log`。
- 新增公开视图 HTTP 回归确认：套餐和我的订阅均不含具体额度字段、订阅/渠道绑定完整、后台仍有输入/输出额度、读取不改变原额度、耗尽仅返回 `available=false`。
- `bun run typecheck`、`bun run build`、改动前端文件 oxlint 和 `git diff --check` 通过。
- 隔离浏览器 mock 验证套餐及我的会员不显示 Token 数值，购买后仍能创建文本/图片/视频会员 Key，后台仍可配置输入/输出额度；`MOCK_UI_PASS` 且 `realApiCalls=0`。日志 `/private/tmp/yun-token-membership-public-ui.log`。
- 没有运行真实模型、支付、充值或业务数据库操作；没有重启业务服务。本轮与已有视频增量一起保留在工作区，未自动提交其他已有改动。


## 短语音增量（2026-11-18）

- `openai_whisper_duration_v1`：仅 OpenAI 类型、whisper-1、`POST /v1/audio/transcriptions`，canonical mono PCM16 WAV（16/24/48kHz、最长60秒）、`verbose_json`。最终 multipart 构造后验证实际 PCM 字节和全部 WAV 头，按保守毫秒上界预留；只以原始响应 duration 结算，缺失 duration 保留 pending。预留不是实际用量。
- `openai_tts_characters_v1`：仅 OpenAI 类型、tts-1/tts-1-hd、`POST /v1/audio/speech`，1—1024 Unicode 字符、非流式 PCM、限定声音及速度。按最终输入字符数预留；完整非空 PCM 响应才结算，不使用旧适配器的估算 Token/时长换算。
- 两类都复用 quantity 台账，无新表/新列；多个 Key 共享额度，成功返回前绕开旧音频/文本计费，不回退钱包。翻译、非规范音频、流式 TTS、其他音频模型仍拒绝。
- mock HTTP 闭环包含两个 TTS 模型、Unicode 字符、转写真实 duration、差额释放、损坏 WAV 上游零调用、缺失 duration 待核对、耗尽零上游新增调用、错误协议拒绝及钱包不变。
- 命令：`GOCACHE=/private/tmp/yun-token-go-cache go test -race ./model ./controller ./service -run '^TestMembership' -count=1 -timeout=120s`，通过；日志 `/private/tmp/yun-token-short-audio-race.log`。前端类型检查、构建和改动文件 lint 通过，日志 `/private/tmp/yun-token-short-audio-build.log`。
- 本机在售路由清单没有这些语音模型，因此本条是通用语音合同 mock 通过，不能标记任一实际在售实例真实通过。前端外部仍不展示数量，后台可配置毫秒/字符额度。


## 受限实时语音合同（2026-11-18）

- `openai_realtime_bounded_v1`，仅 OpenAI 类型 `gpt-4o-realtime-preview`、`GET /v1/realtime`，语言 Key，输入/输出 Token 分开计量。真实实例未验收。
- 建立上游连接前，原子预留该渠道剩余额度的一段会话预算（输入最多 2Mi Token、输出最多4096 Token）；可用输入不足4097或输出不足1时不上游。每次生成输出最多256 Token且不超过本会话剩余输出额度，单会话最多2分钟。
- 网关先配置空 instructions、无工具、无输入转写、无 VAD 自动生成、PCM16 输入/输出；必须收到包含这些字段的原始 `session.updated` 确认后，才开始接收和转发用户数据。不确认就断开并 pending。
- 只接受 PCM16 append/commit、用户纯文本 message 和 response.create。拒绝客户端 session 修改、工具、并发 response；网关重建允许的事件，丢弃客户端输出上限和 instructions 覆盖。单个 response.create 再查订阅有效期。
- 输入准入按文本字节/PCM字节、已确认上下文 Token 和格式余量构造保守上界；这不是实际用量。实际扣减只来自每个原始 response.done 的 input_tokens/output_tokens/total_tokens，检查一致性、生成上限、幂等 response_id 和累计预算。
- 响应完成且额度耗尽则关闭会话，安静关闭时按已确认用量结算并释放差额。断开时尚有输入或生成在途、缺失用量、冲突/超界用量均保留整段预留及已确认回执，待核对；不能把未知残留自动退款。后续可继续细化逐轮账本，以减少异常会话占用预留。
- 完全绕过旧实时钱包估算与 PostWssConsumeQuota；旧实时预扣/后结算函数仍拒绝会员作为第二层保护。普通 Key 保留原路径。
- 本地双 WebSocket mock 验证：客户端把输出上限改成99999仍只发送预算1；PCM输入+commit+response.create；真实分项用量结算、耗尽关闭、缺失用量和上游在途断开 pending、钱包不变。服务层验证重复回执不重复计量、冲突回执和 session/system 输入拒绝。
- `go test -race ./model ./controller ./service -run '^TestMembership'` 通过，日志 `/private/tmp/yun-token-realtime-race.log`；新增断开场景聚焦 `go test -race ./controller ./service -run '^TestMembership.*Realtime'`，日志 `/private/tmp/yun-token-realtime-focused.log`。前端类型检查、构建、改动文件 lint 通过。
- 这不是任意实时协议支持：服务器 VAD、自动转写、工具、可变采样格式、多个并发 response、其他实时模型和新版本事件形状均未实现，不可售；服务器必须手工验收输出上限和确认事件，不能把 mock 当真实支持。


## 实际文本模型名合同（2026-11-18）

- 启用库清单中的 OpenAI 类型 GPT-5.6 / GPT-6 / Kimi 模型名、xAI Grok-4.6 / 4.7 模型名已分别完成普通和流式本地 mock。只增加明确模型名，不放宽任意前缀、不允许搜索/工具/多模态，不绕过最终输出上限检查。
- xAI 在原始响应/原始 SSE 数据进入旧归一化之前捕获真实字段；旧适配器 total-minus-input 仍仅供旧路径使用。专项测试证明 raw completion_tokens 缺失时为 pending，而不是把推算输出扣给会员。
- 命令：`GOCACHE=/private/tmp/yun-token-go-cache go test ./controller -run '^TestMembershipHTTP(Catalog|Xai)' -count=1 -timeout=120s`，通过，日志 `/private/tmp/yun-token-catalog-text.log`。所有请求到 loopback，不使用真实渠道地址或 Key。
- 对应本机渠道19/20/39的 chat、渠道25的 chat 标记为 mock 通过/待用户手工实例验收；相同渠道的 Responses 仍未实现并在会员鉴权前置拒绝。真实可售清单仍为空。


## 原生 Claude Messages（2026-11-18）

- `anthropic_messages_text_v1`，只允许 Anthropic 类型及本机目录六个明确模型名，原生 `/v1/messages`。普通/流式纯文本均 mock 通过；模型映射、系统提示及参数覆盖之后预留，最终 max_tokens 为可执行输出上限。
- 输入使用原始 input_tokens + cache_creation_input_tokens + cache_read_input_tokens，三者均为输入；输出只取原始 output_tokens，不做比例或总量拆分。禁用请求缓存注解、工具、媒体、扩展思考和 Responses 转换。provider_usage 保存最初原始输入/缓存证据和最新原始输出证据。
- 流式必须收到原生 message_stop、明确输入和最终输出字段且无扫描错误；单独 OpenAI [DONE] 不能替代终态。截断或缺失字段保留 pending，不走钱包。
- 六个实际模型名各跑普通/流式、真实缓存输入字段、耗尽零调用、钱包不变；另测缓存注解上游前拒绝、缺失 message_stop 即使有 [DONE] 也 pending。
- 全会员 `go test -race ./model ./controller ./service -run '^TestMembership' -count=1 -timeout=120s` 已通过（controller16.956s），日志 `/private/tmp/yun-token-claude-race.log`。
- 扩大 race 发现 WebSocket 夹具在处理器尾部统计尚未结束时重置全局开关；已单独修复处理器结束同步和重复写相同开关的竞态。该问题属于新增夹具收尾，修复后的通过结果取代之前受影响的 race 结果，不归入素材库既有失败。
- 渠道21原生 Messages 为 mock 通过/待用户手工实测；同渠道的 Chat Completions 转换仍拒绝会员，不能由原生协议通过推断转换协议通过。


## 原生 Responses 短文本（2026-11-18）

- 沿用 `openai_chat_text_v1` 的同一渠道双 Token 台账，让同一会员 Key 在已验收的 Chat/Responses 短文本路径共享额度，而不是再买一份协议额度。
- 只接受 `/v1/responses`，自包含字符串 input 和 instructions、显式 max_output_tokens，store=false/省略。拒绝数组、多模态、工具、previous_response_id、conversation、compact、background 等无法在本合同内计算完整输入边界的路径。会员系统提示在转换前处理，最终参数覆盖后预留。
- 只取原生 input_tokens、output_tokens、total_tokens，检查一致性；流式必须有 response.completed 的完整原始用量且无扫描错误。单独 [DONE] 不是原生终态。Incomplete/failed 等未知结算条件保留 pending。
- 实际 OpenAI/xAI 目录十个模型名分别验证普通和流式、最终输出上限、远程上下文上游前拒绝、原始分项、耗尽上游零新增调用、钱包不变；日志 `/private/tmp/yun-token-responses-tests.log`。
- 本机渠道19/20/25/39的 Responses 现在是 mock 通过、实际实例待用户手工验收；没有执行任何真实请求。此前文档中“所有 Responses 未实现”的描述由本节限定范围取代，其他 Responses 能力仍拒绝。


## Gemini 原生纯文本（2026-11-18）

- `gemini_native_plain_text_v1`，Gemini类型，目录 `gemini-3.8-flash` 的 generateContent / streamGenerateContent。仅纯文本、单候选、显式 maxOutputTokens 与 thinkingBudget=0；没有缓存远程上下文、工具、文件或媒体，也不进行 Chat/Responses 转换。
- 系统指令及覆盖完成后的最终 JSON 原子预留输入/输出；跳过为旧价格选择的 thinking 模型别名逻辑，避免计量模型被价格后缀重写。要求最终配置仍为关闭思考，否则上游前拒绝。
- 只读取原始 promptTokenCount / candidatesTokenCount / totalTokenCount；缓存输入是 prompt 子集，不重复相加。若原始 thoughts/tool Token 非零、字段缺失、总量不一致则 pending，不以总量拆分输出。
- 普通/流式必须有终态候选 STOP/MAX_TOKENS 和同批原始用量；模型会员检查、候选数2上游前拒绝、真实缓存子集、耗尽零新增调用、钱包不变、缺失用量/意外思考待核对的 mock 已通过。日志 `/private/tmp/yun-token-gemini-tests.log`，完整会员 race 日志 `/private/tmp/yun-token-gemini-race.log`。
- 此处证明的是请求合同 mock；该实际未来模型是否接受 thinkingBudget=0、是否严格执行输出总上限，必须由用户真实手工确认，拒绝该参数或出现额外思考时不得公开售卖。渠道26原生协议标为 mock 通过/待手工实测；其 Chat 转换、渠道23图片仍未实现。

## 火山文本与 Claude/Gemini Chat 桥接（2026-11-18）

- 火山最小准入提交 `2b2abec4`：9模型 × Chat/Responses × 普通/流式 mock；全会员 race通过。
- Claude/Gemini Chat 复用各自原生最终请求预留与原始用量采集；Claude空工具数组可用，实际工具不允许。Chat仅字符串文本、单输出、明确输出上限，系统提示先进入转换。Gemini显式关闭思考，参数覆盖后再次校验。Claude流式须message_stop，Gemini须终态候选和原始分项，缺少证据不释放预留、不扣钱包。
- `GOCACHE=/private/tmp/yun-token-go-cache go test -race ./model ./controller ./service -run '^TestMembership' -count=1 -timeout=120s` 通过；model 2.735s、controller 33.635s、service 1.880s。日志 `/private/tmp/yun-token-text-bridges-race.log`。
- 当前实际目录合同14/30 mock通过，16项缺功能；具体协议/适配器/入口及首发影响见 `channel-membership-remaining-20.md`。所有真实调用和支付仍由用户手工执行。
