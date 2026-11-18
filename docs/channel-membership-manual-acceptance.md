# 候选会员版本手工验收

本文件由用户手工执行。本轮开发自动化只使用本地 mock，不执行下面任何真实渠道或支付请求。真实调用可能收费；候选范围仅按手工验收通过的“渠道 × 协议 × 模型”开放。

## 版本与自动复现

- 已有提交：887cdd3c（权益/余额购买/Key）；2aced761（文本双额度）；095a0f9c（DALL-E、Azure、Epay 签名 mock）；c84227ca（菜单/页面）。
- 本轮提交：d4161638（Sora 异步事务）；1c3e71ce（公开接口隐藏额度）；84be16f2（会员页面、视频 Key 选择及后台额度展示）。
- 后端：`GOCACHE=/private/tmp/yun-token-go-cache go test -race ./model ./controller ./service -run '^TestMembership' -count=1 -timeout=120s`。
- 前端：`cd web/default && bun run typecheck && bun run build`。
- 页面 mock：`NODE_PATH=/private/tmp/yun-token-membership-ui/node_modules node web/default/scripts/test-channel-membership-ui.mjs`（在仓库根目录运行；需本机 Chrome、临时目录 playwright-core 及 5188 静态预览；脚本截获全部 API、阻断外网）。
- 既有素材库 controller 回归失败单独记录在主验收文档，不宣称完整 controller 包全绿。

## 准备

1. 使用你控制的测试部署、独立数据副本、专用账户及专用上游 Key，不覆盖现有业务库。先保留数据库备份；不要清表、删订单或删除账本。
2. 核对后端版本、前端版本、数据库地址、支付模式和渠道 ID。应用启动可能迁移结构，先在独立副本验证。配置文件和密钥不要提交到仓库。
3. 从“订阅管理”创建短有效期渠道套餐。后台分别设置输入、输出 Token 额度；图片/视频按对应单位。用户套餐页、购买弹窗、我的会员只展示权益和可用状态，不展示额度数字。管理员视图可看明细。
4. 从渠道矩阵选择本次待验的具体模型和协议。当前本机在售清单与已 mock 的模型不相同；不能把未实现的实际模型直接售卖。

## Epay（先沙箱）

1. 专用账户进入“渠道会员”下单，记录 trade_no、plan_id、订单权益快照。未付款时应无新订阅/权益。
2. 在沙箱完成付款，检查订单只从 pending 变为 success 一次，并且同一事务生成一期订阅及每渠道唯一权益。
3. 在付款前修改套餐额度；付款后确认发放的是下单快照，而非修改后的值。核对价格和支付金额。
4. 重放同一笔合法签名成功通知至少两次：只有一份订阅和每渠道一份额度。错误签名、错误金额、失败/取消支付均不得开通。保留所有通知/订单记录。
5. 余额购买与 Epay 分开记录结果，不能用余额 mock 代替网关验收。线上支付尚未手工通过时不要启用公开销售。

## 首发渠道真实扣减（由用户执行）

1. 购买一期，记录 user_subscription_id；在后台记录该渠道 input/output 或 quantity 的上限、已用、预留。
2. 用户创建会员 Key：绑定该期订阅和该渠道，多个 Key 必须共用一份权益。创建普通 Key 作为对照。
3. 文本：用会员 Key 发短文本 `/v1/chat/completions`，显式设置输出上限；再跑一次带 usage 的完整流式请求。分别记录原始上游输入/输出用量、请求账本、后台已用量增量，三者一致；预留差额归还，钱包不变。
4. 图片：DALL-E 单张调用，确认按真实返回张数扣减而非占位 Token。注意：官方 SDK 已标注 dall-e-2/3 于 2026-05-12 退役，本机当前在售清单也无 DALL-E；该合同验收须先确认实例仍在售，否则记为「无实例可验」，不得用其他图片模型冒充。视频：提交时只预留，终态后才扣；任务绑定原订阅，重复查询/补录不重复扣，到期后仍可查询原任务并结算。
5. 断流、缺失 usage、网络结果不明：预留不得无条件清零，必须有 pending 及证据。不要靠超时或直接改数据库退款。
6. 若上游不支持严格输出上限、用量缺失或只给总量，停止该合同验收，标为未通过，改用明确的实际单位合同后再验。

## 耗尽和权限

1. 后台用小额度专用套餐测试：任一文本维度不足时 403，“套餐额度不足”，**通过上游请求日志确认调用次数没有增加**。图片/视频用同样方法验证对应单位。
2. 同一订阅同一渠道的两个 Key 并发争抢最后一笔可用量：不能两者都成功超扣。不同渠道额度互不影响。
3. 到期拒绝新调用；视频已受理任务允许原订阅 Key 查询，其他订阅即使同用户同渠道也拒绝。
4. 用会员 Key 请求未支持的 Responses、Claude、Gemini、音频、realtime、图片编辑或其他 profile 的路径：应在上游前拒绝，不能从钱包补扣或自动切渠道。某类别后来接入后，应验证它只接受匹配的 profile。

## 普通 Key 回归与记录

1. 同一用户普通 Key 发同模型请求：沿用旧钱包/旧订阅/企业逻辑，会员额度不变。分别记录扣费来源，不仅看请求成功。
2. 用户接口 `/api/subscription/plans`、`/api/subscription/self` 不包含会员具体额度字段；后台仍可配置并查看输入、输出明细，用户创建会员 Key 正常。
3. 为每条填写：版本、渠道 ID、分组、公开/上游模型、协议、计量单位、普通/流式、预留/真实用量/结算、耗尽上游零调用证据、并发、到期、普通 Key、支付方式、结论及阻塞。
4. 真实可售清单只收录所有必测项通过的实例。开发者不会替你执行真实测试；目前没有真实通过的实例。

## 最新候选增量（2026-11-18）

- 最新代码和接续状态以 `channel-membership-handoff.md` 与主验收文档末尾为准。实际目录17/30受限合同mock通过，真实通过0；不能据此直接公开售卖。
- 火山Chat：核对最终上游字段为max_completion_tokens，严格涵盖思考与回答；只支持max_tokens或忽略硬上限的实例不得通过。Responses单独核对max_output_tokens，不用Chat成功代替。
- ClaudeChat/原生：核对缓存读/写输入分别原始采集再汇总输入，流式完整message_stop；工具/媒体仍拒绝。
- Gemini文本及Chat：仅单候选显式关闭思考的合同；不接受该参数的实例不得通过。
- Gemini原生图片/Images兼容：原生maxOutputTokens；Images兼容需显式max_tokens，非流式、单张文生图。核对输入prompt、候选输出和思考原始用量，输出为候选+思考；参考图输入仍拒绝。缺用量不得以1400 Token/图占位结算。
- Seedream图片（渠道11/类型60，`ark_seedream_image_count_v1`）：仅非流式单张文生图，n=1，最终上游报文不得含 sequential_image_generation/layer_decomposition/tools/image/stream/max_tokens。核对上游真实返回 `usage.generated_images`（官方按张计费依据），后台已用张数增量与之一致；`output_tokens/total_tokens` 应相等且作为证据保留（不是计费单位）。组图、图层拆分、参考图、联网搜索、流式必须在上游前拒绝。缺 usage 或不一致须 pending，不得按返回 data 张数或占位结算。官方已标注 doubao-seedream-5-0-260128「即将下线」，先确认在售型号；实际实例不严格执行单图或不返回 generated_images 则标为不通过。
- Ark视频（R01—R12）、GPT Image（R16）经官方文档核实无可执行单请求输出硬上限，**保持禁售**，不要尝试售卖或用普通Key成功/DALL-E/Sora合同通过冒充其会员通过。2026-11-18 已按最新官方创建 API/定价页/官方 SDK 重新核查，结论不变（Ark 新增证据：frames 仅 1.0 系列、返回 duration 为约数、最低用量表亦为估算；GPT Image 新增 complexity/xhigh/max/SVG/GIF 均非 Token 上限）。禁售守卫回归 `TestMembershipBlockedArkVideoAndGPTImageStayUnsellable`、`TestMembershipHTTPVideoKeyCannotSubmitArkNativeOrSeedance` 已在 SQLite/MySQL/PostgreSQL 通过。证据与最小可行替代方案见主验收文档「剩余13项重新核查与禁售守卫」及两节阻塞证据。
