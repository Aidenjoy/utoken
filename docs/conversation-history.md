# 跨设备会话历史：实现与验收报告

日期：2026-11-23。实现范围：`web/default` 的 Playground 文本聊天、共享服务端历史 API、Electron 可选共享服务器模式。**classic 主题和仓库之外的 Agent 客户端没有接入新历史 UI，不能把它们计为已支持同步。** 本报告不代表已完成 Mac/Windows 实机验收。

## 1. 原有结构与检查结果

- 开始时 `git status --short` 为空，无用户未提交改动被覆盖；未执行 reset、clean、checkout、生产数据库操作。
- 默认主题消息原先由 `use-playground-state.ts` 经 `loadMessages/saveMessages` 保存在浏览器全局 LocalStorage。没有账号归属、会话列表或服务端会话表。旧缓存有 100 条、1 MiB 及文本长度限制，不能用它作为完整历史数据库。
- 默认主题消息 ID 由 `nanoid()` 产生；此前没有持久化会话 ID。新会话使用 UUID，沿用消息 key，不改变消息版本、推理、错误及引用结构。
- 登录用户来自 `useAuthStore`；浏览器按 Cookie + `New-Api-User` 原规则鉴权。桌面授权凭证与模型 `sk-` Key 分离，桌面凭证原来通过 `/api/desktop-auth/session` 换取网页 Cookie。
- 原有上下文路径：`use-playground-conversation` → `use-chat-handler` → `buildChatCompletionPayload` → 原模型接口。历史 GET/PATCH 不经过该路径，不能调用模型或结算。
- Electron 原先每台设备启动本地 Go + 独立 SQLite。**两台独立本地库无法跨设备共享账号或历史**，因此新增可选共享站点地址；未配置时保持原启动方式。
- 迁移沿用 `model/main.go` 的普通、快速两条 GORM AutoMigrate 路径，均登记新表。不修改旧表业务字段。

## 2. 实际文件改动

| 文件 | 目的 |
|---|---|
| `model/conversation.go` | 会话、结构化消息、分页查询、所有权检查、版本 CAS、消息顺序、幂等写入 |
| `model/main.go` | 两条迁移路径登记两张新表 |
| `controller/conversation.go` | Cookie/桌面认证接入、参数与请求体限制、HTTP 错误分类和脱敏故障日志 |
| `router/api-router.go` | 三条独立历史路由 |
| `controller/conversation_test.go` | 双凭证/双用户、Cookie、分页、续写、幂等、越权、冲突、DB 故障的隔离 HTTP 测试 |
| `model/conversation_test.go` | 长结构化消息往返、幂等迁移、失败事务回滚 |
| `web/default/src/features/playground/hooks/use-history.ts` | 服务端分页、增量保存、账号缓存、重试和冲突副本恢复 |
| `web/default/src/features/playground/hooks/use-playground-state.ts` | 只保留现有配置状态，消息交由历史 hook 管理 |
| `web/default/src/features/playground/index.tsx` | 接入历史，按账号重新挂载消息状态，加载时禁止发送 |
| `web/default/src/features/playground/components/chat/history-bar.tsx` | 历史选择、列表分页、刷新、新会话、消息分页及失败恢复 |
| `web/default/src/features/playground/components/chat/playground-chat.tsx` | 可展开原来只显示最近 24 条的历史，不再让更早消息无法查看 |
| `web/default/src/features/playground/lib/storage/history-draft.ts`、对应 `.test.ts` | 缓存归属及格式校验、中断响应恢复为 error、未知扩展字段保留 |
| `web/default/src/i18n/locales/{en,zh,zh-TW,fr,ja,ru,vi}.json` | 新历史 UI 翻译，经技能规定脚本写入、sync 校验 |
| `electron/server-origin.js`、对应 `.test.js` | 共享服务器配置验证，远程只接受 HTTPS origin，保留本机 HTTP 开发支持 |
| `electron/main.js`、`electron/package.json` | 配置共享模式时加载共享站点并复用原登录；将解析模块纳入包 |
| `docs/conversation-history.md`、`docs/conversation-openapi.json` | 本报告及可导入 Apifox 的独立接口说明 |

没有修改登录认证实现、OAuth/PKCE、钱包、套餐、API Key、渠道、倍率、Token 算法、模型请求构建、SSE 解析或工具执行逻辑。Electron 只增加可选站点选择，原登录交换协议不变。

## 3. 数据库与一致性

- `conversation_info`：UUID 主键 `id`、认证用户 `user_id`、`title`、`revision`、`next_sequence`、最后一次 mutation ID/摘要，以及 `create_time/update_time`。
- `conversation_message_detail`：`conversation_id + message_id` 联合主键、服务端 `sequence`、原始 JSON `payload`、服务端 `create_time`。
- 索引：会话 owner/update_time/id 索引；消息 conversation/sequence 唯一索引，以及消息联合主键。只读列表不拉消息正文。
- 消息列声明容量 1 MiB，由 GORM 映射：SQLite TEXT、MySQL MEDIUMTEXT、PostgreSQL VARCHAR(1048576)。请求总上限 2 MiB，单批最多 100 条变更和 100 条删除，每条消息上限 1 MiB。超限返回 400，不截断原文。
- 版本 CAS 的 UPDATE 是事务第一项业务写入；随后分配序号、写入/更新/删除消息、保存 mutation 和摘要。失败整体回滚。SQLite 不使用不支持的 FOR UPDATE。
- 已有消息保留顺序，新消息在事务内追加顺序；同一 key 更新不新增记录。相同 mutation + 相同摘要立即重复请求会返回同一提交结果；mutation 内容不同或过期 revision 返回 409。
- 两设备同时编辑不自动合并：过期版本被拒绝。保留本地副本，用户可重试；持续冲突时明确点击“将本地消息另存为新会话”，保留两端结果。旧 mutation 在其他 mutation 已提交后重试会返回冲突，绝不覆盖新版本。
- 读取消息按 before 序号游标分页，页面返回 revision；加载旧页要求相同 revision，避免拼接不同版本。列表按 update_time DESC、id DESC，每页最多 100，前端每页 30；列表使用 offset，新写入期间可刷新列表。
- SQLite 实际运行已验证；MySQL/PostgreSQL 目前仅驱动映射与 SQL/GORM 代码兼容性检查，**没有连接这两类真实测试实例，不算运行时验收通过**。

## 4. 接口与本地兼容

- `GET /api/conversations?offset=0&limit=30`：当前账号列表，`items/has_more`。
- `GET /api/conversations/:id/messages?limit=50&before=0&revision=-1`：消息页，`items/revision/has_more`；后续页传返回的 revision。
- `PATCH /api/conversations/:id`：`revision/mutation_id/title/messages/deleted_ids`。revision=0 可创建新 UUID；前端一次只提交变化消息。
- 身份只从已校验 Cookie 或现有桌面凭证取得。客户端 user_id 不参与所有权判定。模型 API Key、管理 access token 不能作为新的历史凭证。其他用户的 ID 返回 404；无效凭证返回 401。
- 消息 payload 保留原始 JSON，不转纯文本，包括 assistant 中原有扩展工具字段和引用。默认主题显示前验证其现有 Message 渲染结构，结构异常则保留当前显示并报错，不触发模型。
- 旧的无归属全局 LocalStorage 不读取、不上传、不清空。**不能验证归属，所以本次不提供自动迁移**；其内容仍保留在原键，旧版原有导出功能可继续读取。新草稿使用 `conversation-draft-v1:<userID>`，只恢复相同账号的合格缓存。
- 正在 loading/streaming 的响应不作为完整回答提交。刷新后本地中断内容恢复为 error，保留正文；不自动重发模型请求。
- 消息第一页只读最近 50 条，可加载旧页；较长会话先加载完旧页才能继续发送，防止因为只载入一页而丢失原有请求上下文。原来的 payload builder、过滤与 Token 参数没有改动。界面展开不会自行请求模型。此交互在长会话中需要多次加载，是当前版本的明确限制。
- 历史列表的非 401 故障局部返回不可用状态，避免触发本项目全局 QueryCache 的 500 页面跳转；401 仍进入原登录过期处理。
- 同步失败不重复请求模型，也不进入退款/扣费路径。保留内存消息及尽力保存的账号草稿；LocalStorage 配额满时仍尝试服务端保存，离线且缓存也满时不能保证关闭客户端后的未提交内容恢复。

## 5. 功能验收 T01–T16

| 编号 | 结果类型 | 已执行证据及边界 |
|---|---|---|
| T01 | Mock 测试通过；尚未手动测试 | 两个独立桌面凭证及浏览器 Cookie 均能继续读取，凭证未消费；Mac/Windows 实机未测 |
| T02 | 隔离 HTTP 自动化通过 | A 保存后 B 列表得到同一会话 |
| T03 | 隔离 HTTP 自动化通过 | 原始正文、扩展工具数据、附件引用和顺序保持 |
| T04 | Mock 测试通过；尚未手动测试 | B 向原会话保存新消息；实际 UI 发模型续聊未实机测试 |
| T05 | 隔离 HTTP 自动化通过 | A 重新 GET 可见 B 已提交的四条消息 |
| T06 | 隔离 HTTP 自动化通过 | B 查询/写入/删除 A 会话均 404，列表也无 A 会话 |
| T07 | 隔离 HTTP 自动化通过 | 同 mutation 重试，消息行数不增加 |
| T08 | 隔离 HTTP 自动化通过 | before/revision 消息分页内容顺序稳定；分页参数超限拒绝 |
| T09 | 隔离 HTTP 自动化通过；UI 代码检查通过 | 空账号 items=[]；默认主题有原空状态 |
| T10 | 自动化及代码检查通过；网络 UI 尚未手测 | 消息表故障返回受控 500；事务插入失败 revision/title/message 全部回滚；前端 catch 不清空已加载状态 |
| T11 | 隔离 HTTP 自动化及代码检查通过 | 历史测试不注册 relay，无上游请求；用户 quota/used_quota、凭证行数不变 |
| T12 | 原有相关自动化回归通过 | model/common/service 的钱包、订阅、额度相关回归，及聚焦计费测试 |
| T13 | 原有相关自动化回归通过 | token、鉴权、渠道分配及 relay 相关测试 |
| T14 | 原有 Mock 回归通过；UI 尚未手动测试 | relay 包及各 provider/streaming 测试通过；原解析和请求实现无改动 |
| T15 | 代码检查通过 | 初始工作区为空，最终 diff 仅新增功能文件；未执行覆盖操作 |
| T16 | 自动化及代码检查通过；双账号 UI 尚未手测 | 草稿账号不匹配拒绝；旧无归属缓存拒绝；组件按用户 key 重挂载、queryKey 按账号隔离，历史 GET 禁止跨账号去重 |

测试均使用临时 SQLite、合成用户或本机 Mock 服务。未使用生产数据，未调用付费 AI。

## 6. 执行验证与未通过项

- 新增 Go 历史 HTTP、存储回滚与桌面授权聚焦测试通过。
- 前端相关 10 个测试文件共 159 项通过，其中本次新增 3 项；Electron 原 PKCE 与新配置测试共 4 项通过。
- 默认前端 TypeScript、全部变更 TS/TSX 文件 lint、生产构建均通过；`git diff --check` 通过；七种现有语言的 missingCount 均为 0。
- 执行 `go test ./model ./controller ./middleware ./router ./common ./service ./relay/... -count=1`。除 controller 的一项既有测试外，其余包通过。既有失败为 `TestRelayArkAssetAction_ValidationError/CreateAsset_missing_GroupId`：期望 InvalidParameter，实际 ChannelBindingRequired。
- 用 Go overlay 将本次修改的 Go 文件替换为 HEAD 内容/空新增文件，再单独执行该失败测试，得到相同失败，证明确为本次改动前已有问题；未顺手修改素材业务。随后仅跳过此失败子用例重跑上述范围，28 个有测试的包全部通过，其余包无测试文件。
- 部分原测试依赖本机端口，沙箱首次执行 EPERM；在获准的隔离本机测试环境重跑后消除该限制。未改变测试语义。
- Apifox：当前环境没有可调用的 Apifox 工具或会话，**未执行 Apifox 测试**。提供 `conversation-openapi.json` 供导入，隔离 HTTP 自动化不能冒充 Apifox 验收。
- 没有 Windows GUI、双设备真实登录、MySQL/PostgreSQL 实例验收；没有测试或打包桌面安装产物。

## 7. 风险与回滚

- 两设备必须连接同一共享服务端，并使用同一账号；每台设备独立 SQLite 仍各自独立。本次没有上传、覆盖或合并任何已有本地数据库。
- classic 主题使用 role/content 消息结构，默认主题使用 from/versions；本次没有统一转换它们，以避免改变原消息格式和模型行为。classic 及仓库之外的 Agent 客户端需要另行接入上述 API，属于本次尚未交付的覆盖范围。
- 共享模式只新增显式配置，首次从本地站点切到共享站点使用共享站点的账号；现有本地登录 Cookie 不迁移到另一个 origin，也不会清除旧站点 Cookie。
- 长会话依原上下文规则发请求，可能达到现有 Token 限制；没有通过强行缩短、拼接或提升 Token 上限来绕开。
- 附件只同步原引用，不复制第三方文件。引用若原本是设备本地路径或短期 URL，跨设备/过期可用性不保证。
- AutoMigrate 只新增两表及索引；升级前备份共享数据库。迁移权限不足或数据库 DDL 限制仍需按现有部署方式处理。
- 关闭新能力可回滚应用/前端版本或在入口禁用历史路由，**保留两张历史表，禁止 DROP/TRUNCATE**。保留新增账号草稿及旧 LocalStorage，恢复新版本后可继续读取。无需回滚、删除任何钱包/套餐/Token 数据。回滚旧前端后，新历史不会自动转换成原全局本地历史。

## 8. Mac + Windows 最简人工流程

1. 在隔离共享服务端部署新版本，使用默认主题和测试账号 A/B；不要用生产数据。两端均配置相同 `NEW_API_SERVER_URL=https://你的测试站点` 后启动 Electron。未配置会启动独立本地库，不满足此验收前提。
2. Mac、Windows 分别按原入口登录账号 A，确认两端都保持登录。先不用付费模型，可在测试环境使用已有 Mock 渠道，或导入 OpenAPI 直接写入合成历史。
3. Mac 新建会话发送到 Mock 渠道，等待保存完成。Windows 打开 Playground，检查列表/正文；继续发送后 Mac 点“刷新”，检查新消息与顺序。
4. 用 >50 条合成消息检查分页与展开。加载旧页不应产生任何模型网络请求或余额变化；加载完后再用 Mock 继续聊天。
5. Windows 切换 B，确认没有 A 列表/草稿；携带 B 凭证请求 A 会话应 404。
6. 两端同时打开旧版本记录并编辑，确认第二个提交提示同步失败，不覆盖先提交的版本；可将本地消息另存新会话。模拟断网检查已有内容和恢复重试。
7. 记录钱包/套餐额度、旧 API Key、渠道及流式 Mock 结果；确认查看历史零模型请求，两端没有被互踢。
