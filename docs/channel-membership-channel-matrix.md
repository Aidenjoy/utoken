# 本机渠道 × 协议会员覆盖清单（2026-11-18）

来源：只读查询本机 `.env` 指定的 MySQL。口径为 `channels.status=1` 且 `abilities.enabled=1`，与启用模型路由来源一致，覆盖所有分组的并集；具体用户可见性仍受分组、模型权限和价格配置影响。没有读取密钥、地址或调用上游。

状态含义：未实现＝此模型/协议还没有会员计量合同；已实现待测＝有代码但尚无通过证据；mock 通过＝本地模拟合同通过；待手工实测＝候选版本 mock 已通过，真实实例由用户验收。**普通 Key 可调用不等于会员可用。**

| 渠道 ID / 名称 | 模型 | 对外协议路径 | 会员状态 | 当前保护 / 阻塞 |
|---|---|---|---|---|
| 2 / qd1 | doubao-seedance-2.0, doubao-seedance-2.0-fast, doubao-seedance-2.0-mini, doubao-seedance-2.5 | `POST /api/v3/contents/generations/tasks、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 2 / qd1 | doubao-seedance-2.0, doubao-seedance-2.0-fast, doubao-seedance-2.0-mini, doubao-seedance-2.5 | `POST /v1/videos、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 5 / qd2 | doubao-seedance-2.0, doubao-seedance-2.0-fast, doubao-seedance-2.0-mini, doubao-seedance-2.5 | `POST /api/v3/contents/generations/tasks、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 5 / qd2 | doubao-seedance-2.0, doubao-seedance-2.0-fast, doubao-seedance-2.0-mini, doubao-seedance-2.5 | `POST /v1/videos、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 9 / qd5 | doubao-seedance-2.0 | `POST /api/v3/contents/generations/tasks、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 9 / qd5 | doubao-seedance-2.0 | `POST /v1/videos、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 11 / hs | doubao-seedream-5-0, doubao-seedream-5-0-pro | `POST /v1/images/generations` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 14 / qd8 | doubao-seedance-2.0 | `POST /api/v3/contents/generations/tasks、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 14 / qd8 | doubao-seedance-2.0 | `POST /v1/videos、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 19 / kuantum | gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-6-astra, gpt-6-luna, gpt-6-sol | `POST /v1/chat/completions` | mock 通过；待用户手工实测该实例 | 逐模型名已验证普通/流式、原始分项、耗尽零调用、钱包不变；必须再手工验证该上游输出上限与真实用量 |
| 19 / kuantum | gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-6-astra, gpt-6-luna, gpt-6-sol | `POST /v1/responses` | mock 通过；待用户手工实测该实例 | 无工具自包含短文本、显式 max_output_tokens；拒绝远程上下文、compact、工具和转换路径 |
| 20 / xixiapi | gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-6-astra, gpt-6-luna, gpt-6-sol, gpt-6.1-sol | `POST /v1/chat/completions` | mock 通过；待用户手工实测该实例 | 逐模型名已验证普通/流式、原始分项、耗尽零调用、钱包不变；必须再手工验证该上游输出上限与真实用量 |
| 20 / xixiapi | gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra, gpt-6-astra, gpt-6-luna, gpt-6-sol, gpt-6.1-sol | `POST /v1/responses` | mock 通过；待用户手工实测该实例 | 无工具自包含短文本、显式 max_output_tokens；拒绝远程上下文、compact、工具和转换路径 |
| 21 / xixiapi | claude-fable-5, claude-fable-5-1, claude-opus-5, claude-opus-5-5, claude-sonnet-5, claude-sonnet-5-5 | `POST /v1/messages` | mock 通过；待用户手工实测该实例 | 原生纯文本、真实缓存输入相加、输出上限、message_stop；工具/图片/缓存注解仍不支持 |
| 21 / xixiapi | claude-fable-5, claude-fable-5-1, claude-opus-5, claude-opus-5-5, claude-sonnet-5, claude-sonnet-5-5 | `POST /v1/chat/completions` | mock 通过；待用户手工实测该实例 | 复用原生计量，最终转换请求预留；仅字符串文本、单输出、明确输出上限，缺失终态或用量保留待核对 |
| 23 / gemini-nanobanana | gemini-3-pro-image, gemini-3.1-flash-image | `POST /v1beta/models/*:generateContent（含 stream）` | mock 通过；待用户手工实测该实例 | 有限文生图：显式 maxOutputTokens、单候选，输入/候选/思考原始分项；参考图、工具、远程上下文拒绝 |
| 23 / gemini-nanobanana | gemini-3-pro-image, gemini-3.1-flash-image | `POST /v1/images/generations` | mock 通过；待用户手工实测该实例 | 非流式单张文生图，显式 max_tokens 转为原生总输出上限；原始分项结算，参考图/批量拒绝 |
| 24 / gpt-image2 | gpt-image-2.5-flare, gpt-image-2.5-sunburst | `POST /v1/images/generations、/v1/images/edits` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 25 / xixiapi | grok-4.6, grok-4.7 | `POST /v1/chat/completions` | mock 通过；待用户手工实测该实例 | 原始输入/输出缺一则 pending；旧 xAI 总量拆分不可用作真实输出 |
| 25 / xixiapi | grok-4.6, grok-4.7 | `POST /v1/responses` | mock 通过；待用户手工实测该实例 | 无工具自包含短文本、显式 max_output_tokens；拒绝远程上下文、compact、工具和转换路径 |
| 26 / xixiapi | gemini-3.8-flash, gemini-4-argon | `POST /v1beta/models/*:generateContent（含 stream）` | mock 通过；待用户手工实测该实例 | 单文本候选、显式输出上限与 thinkingBudget=0；不接受关闭思考参数的上游不得售卖 |
| 26 / xixiapi | gemini-3.8-flash, gemini-4-argon | `POST /v1/chat/completions` | mock 通过；待用户手工实测该实例 | 复用原生计量，最终转换请求预留；仅字符串文本、单输出、明确输出上限，缺失终态或用量保留待核对 |
| 32 / 火山方舟-codingplan | deepseek-v4-flash, deepseek-v4-pro, deepseek-v4.1-flash, doubao-seed-2.1-lite, doubao-seed-2.1-pro, glm-5.3, glm-5.3-flash, kimi-k3, kimi-k3.1-pro | `POST /v1/chat/completions` | mock 通过；待用户手工实测该实例 | 共用已测 OpenAI 计量；补类型/模型准入和独立9模型验证，无新扣减算法 |
| 32 / 火山方舟-codingplan | deepseek-v4-flash, deepseek-v4-pro, deepseek-v4.1-flash, doubao-seed-2.1-lite, doubao-seed-2.1-pro, glm-5.3, glm-5.3-flash, kimi-k3, kimi-k3.1-pro | `POST /v1/responses` | mock 通过；待用户手工实测该实例 | 共用已测 OpenAI 计量；补类型/模型准入和独立9模型验证，无新扣减算法 |
| 33 / qd13 | doubao-seedance-2.5 | `POST /api/v3/contents/generations/tasks、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 33 / qd13 | doubao-seedance-2.5 | `POST /v1/videos、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 38 / qd17 | doubao-seedance-2.0-test | `POST /api/v3/contents/generations/tasks、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 38 / qd17 | doubao-seedance-2.0-test | `POST /v1/videos、GET 单任务` | 未实现（这些实际模型尚未进入已验收合同） | 不可加入当前可售会员配置；不支持路径由会员鉴权拒绝，不回退钱包 |
| 39 / baidu | kimi-k3.1-pro | `POST /v1/chat/completions` | mock 通过；待用户手工实测该实例 | 逐模型名已验证普通/流式、原始分项、耗尽零调用、钱包不变；必须再手工验证该上游输出上限与真实用量 |
| 39 / baidu | kimi-k3.1-pro | `POST /v1/responses` | mock 通过；待用户手工实测该实例 | 无工具自包含短文本、显式 max_output_tokens；拒绝远程上下文、compact、工具和转换路径 |

共 16 个启用渠道、51 条模型/分组路由记录。当前清单没有 Whisper、TTS、实时语音、DALL-E 或 Sora 模型；这些合同的 mock 验收不能代替实际在售模型验收。

## 已有候选合同（不是上述实际实例的通过证明）

| 适配器 / 模型合同 | 协议 | 状态 |
|---|---|---|
| OpenAI / Azure GPT-4o、GPT-4.1 文本白名单 | `/v1/chat/completions` | mock 通过；待用户新增/指定实例后手工实测 |
| OpenAI DALL-E 2 / 3 | `/v1/images/generations` | mock 通过；待手工实测 |
| Sora Sora-2 / Pro | `/v1/videos` + 查询 | mock 通过；待手工实测；OpenAI 类型需独立实例检查 |

## 路径拒绝证据

剩余20项的缺口、适配器、会员结算入口及首发影响详见 [专项分类](channel-membership-remaining-20.md)。火山2项补最小准入验证后，当前全矩阵为16项合同 mock通过、14项缺功能。

`TestMembershipHTTPUnimplementedProtocolsNeverReachWalletOrUpstream` 使用真实 TokenAuth 和本地处理器计数：文本会员 Key 对 audio 转写/翻译/合成、realtime、video、Ark、Claude、Responses compact、图片 edits 均在处理器前 403，钱包不变。其他会员 profile 只放行各自精确路径；通用 `PreConsumeBilling` / `SettleBilling`、实时预扣和后结算额外拒绝会员进入旧钱包路径。后续新增 profile 后应保留跨协议拒绝回归。

复现：`GOCACHE=/private/tmp/yun-token-go-cache go test ./controller ./service -run "^TestMembership" -count=1 -timeout=120s`。只运行隔离 mock，不启动读取 `.env` 的应用主程序。

重新导出：`GOCACHE=/private/tmp/yun-token-go-cache go run ./tools/membership-inventory`。该命令只读、限制回环 MySQL、拒绝远程地址，不迁移数据。


短语音候选合同新增：Whisper-1 转写（PCM WAV/verbose_json，原始毫秒时长）与 tts-1/tts-1-hd 合成（短文本/PCM，输入字符数）均 mock 通过、待用户手工实例验收；本机当前在售清单未配置这些模型。其他语音路径仍未实现并拒绝会员请求。


受限实时语音候选新增：OpenAI `gpt-4o-realtime-preview`、PCM16、关闭 VAD/输入转写/工具、单响应输出硬上限、会话内预算与原始用量结算，mock 通过，实际模型未配置、真实能力待用户手工验收。任意 session.update/工具/自动生成及其他实时模型仍拒绝。
