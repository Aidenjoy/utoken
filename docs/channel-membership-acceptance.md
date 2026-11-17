# 按渠道额度会员：阶段一、二验收

## 本轮交付边界

- 复用套餐、余额购买、订单、用户订阅、Key 和消费日志；未改动现有前端页面。
- `meter_type=quota`（以及历史空值）保持旧计费；`meter_type=channel` 使用渠道快照。
- 首个实现是 OpenAI 渠道的纯文本 `gpt-4o-mini` / `gpt-4o-mini-2024-07-18`，支持公开模型名映射。
- 只接受 `/v1/chat/completions`，纯文本单输出，显式提供一个正的 `max_tokens` 或 `max_completion_tokens`。工具、多模态、透传、Responses 转换等尚未纳入本计量合同，会员 Key 在发送上游前拒绝。
- 线上会员支付下单暂时拒绝，余额购买可用。旧套餐线上支付继续使用既有网关；新订单保存权益快照。模型层已验证模拟支付通知的快照与重复开通幂等，尚未验证支付网关签名和真实测试环境。
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

价格、有效期、启用状态等沿用原字段。渠道必须启用、类型为 OpenAI、声明配置中的公开模型，映射后的模型必须属于本轮支持清单。其他模型或计量单位不能加入此版本可售配置。修改套餐不改变已开通快照；套餐不能原地切换计量类型。

1. 登录后 `POST /api/subscription/balance/pay`，请求 `{"plan_id":123}`。
2. `GET /api/subscription/self` 获取订阅 ID 和 `channel_quotas`：上限、已用、预留；可用量为 `limit-used-reserved`，有效期取订阅 `end_time`。
3. `POST /api/token/` 创建 Key，保留既有 `name`、模型权限、IP 等字段，并提供 `key_type=language`、`user_subscription_id`、`channel_id`、`expired_time=-1`。使用既有 Key 查询接口取得密钥。
4. 调 `/v1/chat/completions`，例如文本消息和 `max_tokens=128`。多个绑定同一订阅及渠道的 Key 共用快照，不能改绑，也不扣钱包、旧订阅或企业池。

创建/修改页面及购买弹窗尚未适配新字段，**当前不能据此宣布页面购买功能已交付，也不应将新套餐公开销售**。阶段三须先完成页面和真实渠道验收。

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
| 图片 generations/edits、Ark 图片、其他图片适配器 | 待核对 Token/张数/次数 | 图片转换完成、上游前 | 图片适配器原始 usage | 会员拒绝 | 每适配器单位、预留与可信返回 |
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
- SQLite 已实际运行。MySQL/PostgreSQL 使用 GORM 条件更新及项目 `lockForUpdate`，**尚无独立测试实例的运行结果**，上线前必须补测，不能把代码兼容性检查当作数据库验收。
- 新增会员测试已通过 `go test -race ./model ./controller -run '^TestMembership'`。不同会员 Key 的共享额度、模型映射和普通价格为零仍扣会员额度也纳入 HTTP 验收。
- 扩大回归时，model、middleware、service、relay、OpenAI 适配器、relay/helper 的完整测试通过。controller 完整测试有一项既有失败：`TestRelayArkAssetAction_ValidationError/CreateAsset_missing_GroupId` 预期 `InvalidParameter`，实际 `ChannelBindingRequired`；已在开发前提交 `b19e4b9c` 的独立临时副本复现，未修改该无关逻辑。新增会员及订阅/计费聚焦回归通过，不能将整个 controller 包描述为全绿。

## 2026-11-20 候选上线范围

- 当前只有 mock OpenAI 文本合同通过会员闭环，**尚无可宣布对外开放的真实渠道实例**。
- 真实渠道必须同时验收会员扣减、上游输出上限、并发、断流、缺失 usage、旧 Key 回归，并完成前端展示与数据库迁移验证。普通 Key 调通不能替代这些测试。
- 未读取远程业务库中的实际在售模型清单，因此本表是源码接口覆盖清单，不能宣称已逐个核验在售渠道。后续需将实际渠道 ID/模型/适配器与本表逐项关联，补齐每个对外声明支持渠道的结果。
- 阶段三完整范围保留：页面、一个已开通网关的支付测试环境、视频、语音、图片、其他公开协议与辅助接口；周额度、五小时窗口、自动续费不在本版。
