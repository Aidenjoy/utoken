# 渠道会员开发接续提示词（2026-11-18）

以下整段可直接交给其他 AI。用户要求：完成当前火山文本上限修正后暂停，由其他客户端接续。

---

你接手 `/Users/xinyang/2026/yun-token` 的 `yunb` 分支，继续阶段三「按渠道额度的会员订阅」。用户已明确授权直接开发，不采用二段式，不必逐项确认。先读全局 `/Users/xinyang/.codex/memories/PROFILE.md`、`ACTIVE.md`、仓库 `AGENTS.md`；只检查本阶段相关链路，保留已有实现和所有用户本地改动。

## 不可违反的边界

1. 只使用本地 mock。禁止真实模型调用（包括可能花 Token、余额或钱的普通/流式/视频/图片/音频请求），禁止真实支付/支付沙箱/充值/购买/回调。购买、支付、旧钱包回归都只能在合成账户、独立测试库与本地 mock 中做。真实渠道及支付由用户手工验收。
2. 禁止删除任何业务数据、订单、任务、账本、数据库或测试库；不要使用清表、DROP、reset/clean、覆盖式还原。不要启动主应用对现有业务库自动迁移。
3. 保留 `.env`，不要打印或提交密钥。它已按用户要求指向本机 MySQL `127.0.0.1:3306/utoken` 与 Redis `127.0.0.1:6379/0`；这是业务环境，不能当可写测试 fixture。凭证留在本地文件，不要复制进提示词/文档。
4. 不调用真实上游来“确认模型可用”，也不把普通 Key 成功当会员扣减通过。缺外部证据明确阻塞并继续独立工作，禁止编造通过结果。
5. Go 用 `common.Marshal/Unmarshal/DecodeJson`；数据库兼容 SQLite/MySQL/PostgreSQL，锁用 `lockForUpdate(tx)`。遵循 AGENTS 的计费溢出边界及既有 KeyType/模型权限。
6. 不擅自处理 Desktop/Electron 相关改动；不要 `git add .`。分段仅提交自己本阶段的文件。

## 业务规则与用户变更

- 一次买一期，付款成功后开通，到期手动再买；同一期订阅同渠道的多个 Key 共用额度。
- 每渠道一份额度快照，绑定订阅+渠道，会员 Key 不切渠道、不回退钱包；普通 Key、旧订阅、钱包、企业额度走旧逻辑。
- 内部必须分别配置输入/输出 Token，按原始可信用量扣减。用户只看套餐权益/可用状态，不展示具体 Token 数或额度数字；管理员能看配置和明细。
- 只有总 Token/次数/时长/字符的上游按真实支持的单位，不能把日志占位、费率换算、总量拆分当真实输入/输出。
- 预留在模型映射、系统提示、参数覆盖完成之后、发送上游之前；原子检查、幂等结算。任一维度不足，上游调用为0。
- 结果不明、断流、缺用量保留 pending 与证据，不无条件退款。视频已受理任务到期后允许查询，终态仍结算原订阅。
- 5小时窗口、周额度、自动续费不在本次范围。

## 先读的文档

- `docs/channel-membership-acceptance.md`：完整历史测试证据；以末尾最新合同章节为准，早期“未实现”是历史状态。
- `docs/channel-membership-channel-matrix.md`：实际启用渠道×协议矩阵。
- `docs/channel-membership-remaining-20.md`：固定原20项编号、实际协议、适配器、会员入口及首发影响。
- `docs/channel-membership-manual-acceptance.md`：给用户执行的真实验收步骤；AI不要执行其中的真实调用。

## 已提交成果

基础：
- `887cdd3c`：渠道额度、余额购买、会员 Key、旧计费隔离。
- `2aced761`：文本双维度预留、原始用量结算、断流待核对。
- `095a0f9c`：DALL-E/Azure/Epay mock。
- `c84227ca`：菜单及基础页面。

阶段三：
- `d4161638`：Sora异步任务会员事务、原订阅归属、终态/到期查询。
- `1c3e71ce`：用户公开接口隐藏数字额度。
- `84be16f2`：会员页面、后台明细、视频 Key 模型选择。
- `305e9c0b`：只读目录盘点工具、实际渠道矩阵、手工验收。
- `62db9556`：短请求 Whisper时长与TTS字符合同。
- `9f9cff3a`：受限 realtime 会话内额度与断开结算。
- `52afbb0c`：实际 OpenAI/xAI目录文本、xAI原始分项防旧拆分。
- `7252f700`：WebSocket fixture完成同步，修正测试竞争。
- `c19e0a7c`：原生 Claude Messages 与原始缓存输入。
- `40b75105`：受限原生 Responses 与 Chat共用文本额度。
- `0e727479`：原生 Gemini纯文本。
- `2b2abec4`：火山文本最小准入及9目录模型 mock，剩余20项分类。
- `72b305e2`：Claude/Gemini Chat转换复用原生计量与最终请求上限。
- `fe0119e1`：Gemini原生文生图，原始输入/候选输出/思考用量。
- `2853cd78`：Gemini Images兼容入口复用原生图片额度与原始用量。
- 火山总输出上限修正为本交接文档同一提交，查 `git log -1 -- docs/channel-membership-handoff.md` 获取提交号；不能继续使用仅限制可见回答的 `max_tokens` 来承诺思考总量受限。

## 当前准确进度

实际目录30个渠道×协议条目中：**16条受限合同 mock通过，14条缺功能，真实通过0条**。不要称阶段三全部完成。

已经 mock 的实际实例：
- 渠道19/20（OpenAI）、25（xAI）、39（OpenAI兼容）、32（火山）：Chat + 原生 Responses，共10条。
- 渠道21（Claude）：原生 Messages + Chat转换，共2条。
- 渠道26（Gemini）：原生 generateContent/streamGenerateContent + Chat转换，共2条。
- 渠道23（Gemini图片）：原生 generateContent/streamGenerateContent + 非流式 Images generations，共2条。

这16条不是所有模型能力全开放：严格限定纯文本/文生图、单候选、显式上限等合同；工具、多媒体输入、远程上下文、批量等未验能力继续拒绝。真实实例与公开别名/映射仍需用户实测。

原剩余20项当前分类：14缺功能、4已有实现待手工验收（R14/R15/R17/R18，mock通过）、2共用链路（R19/R20，mock通过）。

## 当前渠道刚完成的修正

火山 Chat：`relay/channel/volcengine/adaptor.go` 在会员模式把客户端 `max_tokens` 移到 `max_completion_tokens`（如果已有后者则保持）；`service.PrepareMembershipText` 对最终火山请求要求总输出上限，拒绝被覆盖回 `max_tokens` 的请求。普通 Key 不改变。9模型×Chat/Responses×普通/流式 mock检查最终上限字段。

原因：官方 Ark 文档说明 `max_tokens` 可只限回答，`max_completion_tokens` 才控制回答+思考。当前修改仅证明发送正确合同；实际转售实例是否支持/严格执行，仍必须用户手工确认。

## 剩余14条：不要误当14套独立开发

1. **R01—R12，6个Ark视频渠道×2协议**：ID 2/5/9/14/33/38，类型59。
   - 官方：POST `/api/v3/contents/generations/tasks`、GET列表/单任务、DELETE单任务。
   - 兼容：POST `/v1/videos` 与查询（还有统一视频别名）。
   - `relay/channel/task/arknative/adaptor.go` → `relay/relay_task.go` → `relay/channel/task/taskcommon/volc.go` → `service/task_polling.go` 的 `ApplyUpstreamTaskResult`。
   - 当前没有可售会员合同，鉴权拒绝。需要原始可空、可追溯总量（不是 lenient parser 的0、不用费率缩放、不能 total-completion 拆输入），可靠预留边界，以及原订阅task关联、终态/取消/补录幂等。
   - 已有 `MembershipTaskMeter`、`PrepareMembershipTask`、`ApplyMembershipTaskResult`、`model.CompleteMembershipTask` 只覆盖Sora成功视频次数，不能直接套为Seedance总Token。
   - **具体阻塞**：现有Ark创建参数只有duration/resolution等，尚未有证据表明可执行硬Token上限；官方定价页把像素×帧率×时长公式明确标为估算。不能把这个估算当真实计量或不超扣保证。继续查官方协议/实际转售约定，若仍无可靠边界则禁止加入可售套餐并记录阻塞，别伪造mock上限字段。

2. **R13，渠道11/类型60 Seedream图像**：Images generations。
   - `volcengine.Adaptor.ConvertImageRequest` → `ImageHelper` → OpenAI image handler。
   - 需要按真实提供的输入/输出或总量计量，检查 sequential_image_generation 与 n/max_images实际限制，原始receipt。
   - 不能只加DALL-E白名单或按返回张数把真实Token抹掉。官方响应存在 output_tokens/total_tokens，某些型号有input_tokens；当前通用 ImageResponse DTO丢掉这些usage，尚无该具体型号严格输出Token上限证据。

3. **R16，渠道24/OpenAI gpt-image-2.5-flare/sunburst**：Images generations/edits（原矩阵合并为一项）。
   - `openai.Adaptor` → `ImageHelper` → image handler/stream/JSON-as-stream。
   - DALL-E次数合同不覆盖这些模型。要核对实际上下游模型、原始输入/输出、能执行的输出边界、参考图/编辑/流式终态。
   - 不要把GPT图片占位值、费率或未知未来型号硬编码成可靠Token上限；证据不足保持禁售/拒绝，先推进其他独立工作。

## 已有合同实现注意点

- 共享账本 `model/subscription_channel.go`、session及结算 `service/subscription_channel.go`。
- 文本 OAI/Azure/xAI/火山：最终JSON后预留，raw usage先采集，会员跳过缓存/免费模型旧扣费/重试。
- 原生 Responses：只接受自包含字符串input/instructions，显式max_output_tokens；无工具/数组媒体/远程上下文/background/compact；stream须 response.completed原始用量。
- Claude：`service/subscription_claude.go`；真实 input_tokens+cache_read+cache_creation，output原始字段。stream须message_stop；message_start output0不是最终用量。Chat只字符串消息；最终Messages预留。
- Gemini文本：`service/subscription_gemini.go`；单候选、显式maxOutputTokens、thinkingBudget=0，原始prompt/candidate/total一致，无思考/工具，否则pending。
- Gemini图片：profile `gemini_native_bounded_image_v1`，图片Key，仍配置input/output额度；文本输入，单候选，原生maxOutputTokens；输出按原始candidatesTokenCount+thoughtsTokenCount，不是总量反推。缓存输入是prompt子集，不加两次。参考图输入仍拒绝。
- Gemini Images兼容：非流式，max_tokens扩展参数变原生maxOutputTokens；n!=1、缺上限、参考图在converter下载远程文件前拒绝；Observe位于旧1400占位处理之前，缺输出pending，不扣占位数。
- 图片Key在原生Gemini的KeyType例外只对已验证membership_gemini_image生效，普通Key保持原规则。
- Sora：一任务预留一个 completed_videos，终态0/1且事务幂等；到期查询不依赖新调用资格；未知回执保留pending。
- Whisper：<=60秒canonical mono PCM WAV 16bit/16/24/48kHz，verbose_json；按原始duration毫秒结算，无原始duration pending。
- TTS：tts-1/hd，<=1024 Unicode字符、受限voice/speed、非流式PCM，完整音频响应才按实际发送字符结算，异常body pending。
- Realtime：仅受限gpt-4o-realtime-preview；先预留片段再握手，typed事件白名单、单response in-flight、会话内检查、原始response.done幂等；已知安静断开结算，in-flight/未知断开保留pending。不是任意实时协议全支持。
- Epay：合成支付回调验证签名/金额/快照/重复成功只发一次/失败不发放，无真实网关测试。

## 复现和测试证据

在仓库根目录：

```bash
GOCACHE=/private/tmp/yun-token-go-cache go test -race ./model ./controller ./service ./middleware -run '^(TestMembership|TestEnforceTokenKeyType)' -count=1 -timeout=120s
GOCACHE=/private/tmp/yun-token-go-cache go test ./controller -run '^TestMembershipHTTPVolcCatalogueText$' -count=1 -timeout=120s
```

前端：

```bash
cd /Users/xinyang/2026/yun-token/web/default
bun run build:check
bunx oxlint -c .oxlintrc.json src/features/subscriptions/types.ts src/features/subscriptions/components/membership-key-dialog.tsx
```

最近证据：
- 文本桥接完整race `/private/tmp/yun-token-text-bridges-race.log` 全绿。
- 原生图片race `/private/tmp/yun-token-gemini-image-race.log` 全绿；额外缺用量测试 `/private/tmp/yun-token-gemini-image-pending.log`。
- 图片兼容完整race `/private/tmp/yun-token-gemini-image-bridge-race.log` 全绿（model2.715s/controller35.191s/service1.765s/middleware1.762s）。
- 前端 `/private/tmp/yun-token-gemini-image-build.log`、`/private/tmp/yun-token-gemini-image-typecheck.log` 通过。
- 当前火山总上限聚焦 `/private/tmp/yun-token-volc-total-cap.log` 通过；完整race `/private/tmp/yun-token-volc-total-cap-race.log`，最终结果见本提示词末尾的暂停记录。
- 既有素材库回归 `TestRelayArkAssetAction_ValidationError/CreateAsset_missing_GroupId` 在改动前基线 `b19e4b9c` 已复现：期望InvalidParameter，实际ChannelBindingRequired。单独记录，不把它算新增失败，不宣称整个controller包全绿。

数据库实测：先前独立MySQL8与PostgreSQL15购买、迁移、并发预留、幂等、旧订阅隔离通过，见主验收文档。本次新媒体/桥接HTTP合同主要SQLite mock；不要宣称新增合同已在所有SQL上重跑。既有容器：`yun-token-membership-mysql-20261117` loopback13376、`yun-token-membership-postgres-20261117` loopback15476。fixture只从显式 `MEMBERSHIP_TEST_DSN` 读独立实例、每测试新建库并保留，绝不传 `.env`业务DSN，不DROP。

## 必须保留的其他本地工作

暂停时存在与本次会员无关的本地改动：

- tracked：`controller/user.go`、`model/main.go`、`router/api-router.go`、`electron/README.md`、`electron/main.js`、`electron/package.json`。
- untracked：`controller/desktop_auth.go`、`controller/desktop_auth_test.go`、`model/desktop_auth.go`、`electron/desktop-auth.js`、`electron/desktop-auth.test.js`。

它们是用户/其他线程工作，不要还原、删除、暂存或混进会员提交。以接手时git status为准。

## 建议接续顺序与完成标准

1. 核对分支、工作区、文档及最新提交，复现现有会员mock。不要重复重写已通过功能。
2. 对剩余3类工程缺口查清真实协议与可执行额度边界；可靠时实施小合同和本地mock，无法可靠时明确具体阻塞并禁售，继续独立可做项。
3. 每完成一类分段提交，更新原矩阵每行的真实状态和复现命令。仅凭同适配器不能宣称不同渠道真实通过。
4. 补齐支持合同的UI配置/创建对应Key路径；保留用户端不显示额度数字，后台输入/输出分别配置。
5. 用mock验证重复支付、开通回滚、并发不超扣、断流pending、任务重复终态、到期拒绝、普通Key旧计费，必要时独立SQL再回归。
6. 更新用户手工验收步骤和周五2026-11-20候选范围。没有用户真实验收结果时实际可售通过清单为空；可以给mock候选清单，但不能标成真实通过。
7. 汇报准确剩余项与提交号，禁止把安全拒绝/记录阻塞写成“已实现全部模型”。

用户希望持续推进，不要每一项等确认；但如果用户要求暂停必须立即在当前安全提交点停止。当前这一客户端已被要求暂停，其他AI只有在用户让其接续后才继续执行。

## 暂停时的最终记录

- 当前火山总上限聚焦及完整race全部通过：model3.134s/controller37.582s/service1.835s/middleware1.730s；日志 `/private/tmp/yun-token-volc-total-cap-race.log`。
- 本客户端完成当前火山修正后已按用户要求暂停，不会在后台继续其他渠道开发。接续从已提交的安全点开始，保留前述未提交Desktop/Electron工作。
- 未进行真实模型/支付调用，未删除任何数据，未修改.env。剩余14项仍是未完成，不能在交接时抹掉或宣称完成。
