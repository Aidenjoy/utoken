# 剩余20项：缺口分类与周五首发影响（2026-11-18）

## 口径与结论

这里固定沿用上轮报告的20个“渠道 × 协议”条目，不因同适配器共用实现而重复计为20套开发，也不临时拆分原来合并的图片 generations/edits 条目。实际模型/别名见主矩阵；协议来自项目路由和适配器映射，不代表真实上游已经验收。

分类依据：**缺功能**＝会员入口或计量合同尚未完整接通；**已有实现待验收**＝该协议会员实现完整，仍需明确 mock/真实证据状态；**与已测项共用链路**＝不需要新扣减算法，补准入和独立验证即可。普通 Key 的既有实现不算会员实现。

初次分类为18项缺功能、2项共用链路。追加桥接后为14项缺功能、4项已有实现待手工验收、2项共用链路。接续开发再补 Seedream 按张计数合同后当前为：**13项缺功能、5项已有实现待手工验收（mock通过，R13/R14/R15/R17/R18）、2项与已测项共用链路（R19/R20）**。全矩阵30项中17项合同 mock通过，13项缺功能；真实通过数为0。R01—R12（Ark视频）与 R16（GPT Image）经官方文档核实无可执行单请求输出硬上限，保持禁售，证据见主验收文档「阻塞证据」两节。

## 先判断火山文本

渠道32 / 火山方舟-codingplan（类型45）的 Chat 与 Responses 已复用现有 `volcengine.Adaptor`：

- 请求转换：`ConvertOpenAIRequest` / `ConvertOpenAIResponsesRequest`；URL 仍由 `arkAPIBase` 与适配器选择，覆盖 Agent Plan 等版本基址。
- 响应：`volcengine.Adaptor.DoResponse` 委托 `openai.Adaptor.DoResponse`，已有归一化前原始用量钩子；无需再实现一套计费。
- 会员预留：`service.PrepareMembershipText` / `PrepareMembershipResponses`，位于最终参数覆盖之后、`DoRequest` 之前。
- 会员结算：`service.FinishMembershipRequest` → `model.FinishMembership`，双维度原子额度，幂等且不走钱包。
- 原先缺的是 `MembershipTextChannelSupported` 的类型45准入、目录模型白名单及后台候选渠道列表；已做最小修改，未重写价格/钱包算法。
- 新增 mock 覆盖目录9个模型 × Chat/Responses × 普通/流式；核对实际发送的上限、Kimi温度转换、原始输入/输出、差额释放、耗尽上游零新增调用和钱包不变。共用链路通过不代表实际渠道32真实通过。

复现：

```bash
GOCACHE=/private/tmp/yun-token-go-cache go test ./controller -run '^TestMembershipHTTPVolcCatalogueText$' -count=1 -timeout=120s
GOCACHE=/private/tmp/yun-token-go-cache go test -race ./model ./controller ./service -run '^TestMembership' -count=1 -timeout=120s
```

证据：`/private/tmp/yun-token-volc-text.log`、`/private/tmp/yun-token-volc-text-race.log`。真实上游、支付均未调用。

## 逐项清单

表中的“无会员入口”指当前新请求会被拒绝，不会执行后列出的拟复用函数。Sora 的已测完成次数合同不能直接充当 Seedance 的总Token合同。

| 项 | 渠道 | 实际对外协议 | 适配器与实际调用路径 | 分类 | 会员结算入口：现状及缺口 | 首发影响 |
|---|---|---|---|---|---|
| R01 | 2 / qd1 | `POST /api/v3/contents/generations/tasks；GET 列表/单任务；DELETE 单任务` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R02 | 2 / qd1 | `POST /v1/videos；GET /v1/videos/:task_id（含统一视频别名）` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R03 | 5 / qd2 | `POST /api/v3/contents/generations/tasks；GET 列表/单任务；DELETE 单任务` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R04 | 5 / qd2 | `POST /v1/videos；GET /v1/videos/:task_id（含统一视频别名）` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R05 | 9 / qd5 | `POST /api/v3/contents/generations/tasks；GET 列表/单任务；DELETE 单任务` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R06 | 9 / qd5 | `POST /v1/videos；GET /v1/videos/:task_id（含统一视频别名）` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R07 | 14 / qd8 | `POST /api/v3/contents/generations/tasks；GET 列表/单任务；DELETE 单任务` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R08 | 14 / qd8 | `POST /v1/videos；GET /v1/videos/:task_id（含统一视频别名）` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R09 | 33 / qd13 | `POST /api/v3/contents/generations/tasks；GET 列表/单任务；DELETE 单任务` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R10 | 33 / qd13 | `POST /v1/videos；GET /v1/videos/:task_id（含统一视频别名）` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R11 | 38 / qd17 | `POST /api/v3/contents/generations/tasks；GET 列表/单任务；DELETE 单任务` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R12 | 38 / qd17 | `POST /v1/videos；GET /v1/videos/:task_id（含统一视频别名）` | `arknative.TaskAdaptor`；`RelayTaskSubmit` → `ParseVolcTaskResult` → `ApplyUpstreamTaskResult` | 缺功能 | 无会员入口；需原始可空 usage 总量合同、可执行的预留上限、任务原订阅绑定及终态结算/取消。已有 `CompleteMembershipTask` 只接受成功视频次数，不能把价格换算或总量拆成输入/输出。 | 视频会员首发阻断；纯文本候选可不包含它，后续再接入 |
| R13 | 11 / hs | `POST /v1/images/generations` | `volcengine.Adaptor.ConvertImageRequest` → `ImageHelper` → `OpenaiImageHandler` | 已有实现待手工验收（mock通过） | `PrepareMembershipSeedream` 最终 payload 键白名单+n=1 预留1张 → 原始 `ObserveMembershipSeedream` 取 usage.generated_images → `FinishMembershipRequest`。官方按张计费、无 input_tokens、无输出 Token 硬上限，故按张计量并保留 output_tokens 证据；组图/图层拆分/参考图/工具/流式上游前拒绝，缺用量/不一致 pending。实际实例严格执行待手工验收。 | Seedream 图片会员代码不再阻断；进入首发仍需用户实测单图边界与真实 usage |
| R14 | 23 / gemini-nanobanana | `POST /v1beta/models/*:generateContent` / `streamGenerateContent` | `gemini.Adaptor` → `GeminiTextGenerationHandler/StreamHandler` | 已有实现待手工验收（mock通过） | `GeminiHelper` → `PrepareMembershipGemini` → `ObserveMembershipGemini` → `FinishMembershipRequest`；受限文生图，输入/候选输出/思考原始分项，输出总上限；参考图仍拒绝。 | Gemini 图片会员首发阻断；纯文本可后补 |
| R15 | 23 / gemini-nanobanana | `POST /v1/images/generations` | `gemini.Adaptor.ConvertImageRequest` → `GeminiNanoBananaImageHandler` | 已有实现待手工验收（mock通过） | `ImageHelper` → `PrepareMembershipGemini` → `GeminiNanoBananaImageHandler` 原始 `ObserveMembershipGemini` → `FinishMembershipRequest`；显式 max_tokens、非流式单张文生图；缺分项 pending，不用1400占位值。 | 同 R14；协议转换还需独立 mock |
| R16 | 24 / gpt-image2 | `POST /v1/images/generations`、`POST /v1/images/edits` | `openai.Adaptor` → `ImageHelper` → `OpenaiImageHandler` / stream / JSON-as-stream | 缺功能 | DALL-E计次已测，但新 GPT Image 模型尚无会员合同；需原始 input/output usage、可执行输出上限、图像输入边界以及编辑/流式终态。`normalizeOpenAIUsage` 的回填不作为证据。 | GPT Image 会员首发阻断；不得用普通 Key 调通替代 |
| R17 | 21 / xixiapi | `POST /v1/chat/completions` → 原生 Messages | `claude.Adaptor.ConvertOpenAIRequest` → `ClaudeHandler/StreamHandler` | 已有实现待手工验收（mock通过） | `TextHelper` 最终转换请求 → `PrepareMembershipClaude` → `ObserveMembershipClaude` → `FinishMembershipRequest`；6模型普通/流式、缓存输入、耗尽零调用、钱包隔离和不完整终态待核对已通过。 | 若首发使用原生 Messages，可后补；若客户端只会 Chat，则阻断该客户端的 Claude 首发 |
| R18 | 26 / xixiapi | `POST /v1/chat/completions` → Gemini generateContent | `gemini.Adaptor.ConvertOpenAIRequest` → `GeminiChatHandler/StreamHandler` | 已有实现待手工验收（mock通过） | `TextHelper` 最终转换请求 → `PrepareMembershipGemini` → `ObserveMembershipGemini` → `FinishMembershipRequest`；显式关闭思考、原始输入/输出、普通/流式、耗尽零调用和钱包隔离已通过。 | 若首发使用原生 Gemini，可后补；只会 Chat 的客户端则阻断 |
| R19 | 32 / 火山方舟-codingplan | `POST /v1/chat/completions` | `volcengine.Adaptor` → `openai.Adaptor` → `OpenaiHandler/OaiStreamHandler` | 与已测项共用链路 | 已接通：`PrepareMembershipText` → 原始 `ObserveMembershipUsage` → `FinishMembershipRequest` → `FinishMembership`；最小准入修改及9模型普通/流式 mock通过。 | 代码不再阻断；进入周五候选仍需你实测输出上限、真实扣减、耗尽和普通 Key |
| R20 | 32 / 火山方舟-codingplan | `POST /v1/responses` | `volcengine.Adaptor` → `OaiResponsesHandler/StreamHandler` | 与已测项共用链路 | 已接通：`PrepareMembershipResponses` → 原始 `ObserveMembershipResponses` → `FinishMembershipRequest` → `FinishMembership`；无远程上下文/工具，9模型普通/流式 mock通过。 | 同 R19；Chat 实测不能代替 Responses 实测 |

## 工程缺口与周五范围

- R01—R12 是同一个 Ark/Seedance 会员任务合同缺口在6个实际渠道、2种外部协议上的展开，不是12套重复开发。官方文档证实创建 API 无单请求 Token 硬上限、定价公式为估算、usage 无输入分项且有最低用量兜底，账号/接入点级上限非单请求级——**无可执行预留边界，保持禁售**（证据见主验收文档「Ark/Seedance 视频会员阻塞证据」）。终态对账可行但不足以支撑可售预留。
- R13 已补按张计数合同（mock通过，待手工验收）；R14—R15 为 Gemini 图片合同（mock通过）；R16 GPT Image 经官方 OpenAPI 规范证实无输出上限参数、2.5 无官方输出 Token 数值表，**保持禁售**（证据见主验收文档「GPT Image 会员阻塞证据」）。R17、R18 是2类转换桥接（mock通过）。不能因同适配器跳过每个实际实例/外部协议的验收。
- 建议周五 2026-11-20 的候选先限定为已 mock 通过并由用户真实验收通过的文本协议；火山文本可进入此候选。Seedream 图片可作为图片候选，但须先手工验收单图边界与真实 usage。若首发承诺会员视频（R01—R12）或 GPT Image（R16），这些禁售条目均是硬阻断，不能延后验收后仍对外声称已支持。
- R17/R18 可以在原生客户端可用时随后补；若产品前端/客户 SDK 只支持 OpenAI Chat，则不能以原生接口已通过为由宣称该客户端可用。
- Epay、真实模型及实际配置只由用户手动验收，采用 `channel-membership-manual-acceptance.md`。本轮没有真实支付、充值、模型调用，也未删除任何数据。
- 会员未知路径目前均前置拒绝；旧计费入口有第二层拒绝，AK/SK 的 `ValidateTokenByAccessKey` 也拒绝会员。当前分类不代表放开任何尚未完成的路径。

## 文本桥接复现与证据

```bash
GOCACHE=/private/tmp/yun-token-go-cache go test -race ./model ./controller ./service -run '^TestMembership' -count=1 -timeout=120s
```

2026-11-18：model/controller/service 全部通过，日志 `/private/tmp/yun-token-text-bridges-race.log`。R17/R18 现在代码不再阻断对应受限 Chat 合同；真实输出上限、原始用量与客户端兼容性仍需用户手工验收。

## Seedream 按张计数复现与证据

```bash
GOCACHE=/private/tmp/yun-token-go-cache go test ./controller -run '^TestMembershipHTTPSeedream' -count=1 -timeout=120s
GOCACHE=/private/tmp/yun-token-go-cache go test -race ./model ./controller ./service ./middleware -run '^(TestMembership|TestEnforceTokenKeyType)' -count=1 -timeout=120s
```

2026-11-18：聚焦与完整 race 均通过（model2.760s/controller36.388s/service1.881s/middleware1.776s），日志 `/private/tmp/yun-token-seedream-race.log`；前端 typecheck/oxlint/build:check 通过，日志 `/private/tmp/yun-token-seedream-build.log`。R13 代码不再阻断受限单张文生图计数合同；官方按张计费、无 input_tokens、无输出 Token 硬上限，实际实例单图边界与真实 usage.generated_images 仍需用户手工验收。

## 独立 SQL 回归与 UI 复跑（2026-11-18）

此前「新增合同主要 SQLite mock」的缺口已补齐：会员 HTTP fixture 增加可选 `MEMBERSHIP_TEST_DSN` 分支（仅测试代码，默认 SQLite 不变，每测试新建独立 loopback 库并保留、不 DROP）。model 层与 controller 全量 `^TestMembership` 在独立 MySQL8/PostgreSQL15 上均全过（各 38 个 HTTP 顶层测试、171 个独立库，0 失败/跳过），未发现方言缺陷；fixture 改动后 SQLite 完整 race 复跑全绿；浏览器 mock UI 复跑 `MOCK_UI_PASS`、realApiCalls=0。证据与复现命令见主验收文档「独立 MySQL/PostgreSQL 全量会员回归与 UI 复跑」节。SQL 通过仍属 mock 证据，真实通过数保持 0，分类与周五候选范围不变。
