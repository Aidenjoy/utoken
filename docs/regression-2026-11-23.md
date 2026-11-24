# 2026-11-23 完整功能兼容性回归

## 结论

本轮已完成可执行的全仓库功能回归，并按用户确认的“原入口不变、新能力独立启用”方案修复兼容问题。没有修改旧登录、钱包、套餐、渠道、模型倍率、计费或原日志 API 的生产实现。

- 原入口 `/playground` 恢复原本地消息加载、保存、清空、请求上下文和流式聊天路径。
- 新同步 UI 仅通过 `/playground?history=server` 显式启用；新增桌面日志、服务端会话接口仍可使用。
- 原本地聊天记录和新会话草稿不再被 UI 缓存初始化清理。
- 所有执行的功能测试通过，未跳过已知失败用例来制造通过。默认全仓库 Go 命令中有两个依赖外部数据库的测试自动跳过，已在本轮新建空库补跑通过。
- 全局 lint/vet 仍有存量诊断；不能把它们称为通过，详见下文。
- 本轮修复未提交、未部署；正式发布需要包含本轮工作区修复。

## 实际检查结果

| 范围 | 结果 | 执行内容 |
|---|---|---|
| 全仓库 Go | 通过 | `go test ./... -json -count=1`：39 个有测试包、2133 个测试/子测试通过，0 失败；58 个包无测试文件 |
| 外部数据库 Key 迁移 | 通过 | 默认跳过的 MySQL/PostgreSQL 两个 CHAR(48) → VARCHAR(128) 兼容用例，在本轮全新空库另行执行通过 |
| 默认前端全量测试 | 通过 | `bun test ./src`：11 个文件、167 项通过，0 失败 |
| 默认前端类型检查 | 通过 | `bun run typecheck` |
| 本轮改动前端 lint | 通过 | Playground、状态 hook、路由、缓存初始化四个 TS/TSX 文件 |
| 默认前端构建 | 通过 | `bun run build` |
| classic 前端构建 | 通过 | `bun run build`，没有修改 classic 代码 |
| Electron 原测试 | 通过 | PKCE/授权取消/共享服务器配置，共 4 项通过 |
| 主程序构建 | 通过 | `go build -o /tmp/utoken-regression-app .`，包含两套前端产物 |
| 改动相关 Go vet | 通过 | `go vet ./controller ./model ./dto ./router` |
| 展示及输入额外验证 | 通过 | 四种币种/点数展示模式，以及11组合成输入/脱敏/截断/故障降级场景 |
| 格式及 Git 差异检查 | 通过 | 本轮四个前端文件 oxfmt、`git diff --check` |

本次没有执行真实付费模型请求，未读取生产用户数据、未连接生产数据库。

## 原功能覆盖

全仓库 Go 回归包含已有登录/认证、API Key、日志读写/脱敏、钱包、套餐/订阅、预扣/结算/退款、Token 边界、代理商/组织隔离、渠道适配和流式协议等测试。新增桌面日志与原 `/api/log/self`、管理员日志、会话 API 的隔离测试同样执行。

桌面登录的原测试补充验证：

- 新 Bearer 的 expires_in 为 7776000 秒（90 天）。
- 换取 Cookie 后 Bearer 仍能读取资料及再次建立 Cookie。
- 主动撤销后，资料和 Cookie 兑换都拒绝该 Bearer。
- 一次性授权码与 PKCE 校验仍保留原行为。

原钱包/套餐/Key/日志接口的生产文件没有为了测试通过而改动。

## 三种数据库的真实隔离升级

使用临时 SQLite 文件、两台本轮新建的 Docker 容器：MySQL 8.0 与 PostgreSQL 15。容器仅绑定 127.0.0.1 随机端口，使用合成账号与空数据库，无生产持久卷。

三个引擎均执行：

1. 用本轮基线提交 `94e8da79f` 的父版本 `model/main.go`，通过 Go overlay 调用真实 `model.InitDB()`，创建旧版 schema。
2. 写入合成用户钱包、API Key、订阅额度、使用日志和请求快照，并保存数据库读取后的完整对象快照。
3. 用当前迁移代码调用真实数据库初始化，验证两张会话表创建。
4. 对比全部上述对象，确认没有被迁移或新查询改写。
5. 验证会话保存、重复提交幂等、跨用户拒绝和日志用户输入提取。
6. 再次调用数据库初始化，验证重复升级仍成功且原数据不变。

三个引擎全部通过。两个原有 Key 字段迁移外部数据库测试在额外空库运行，未覆盖上述合成业务库。

这不等于已验证 MySQL 5.7、PostgreSQL 9.6 或真实生产库的全部历史 schema。正式库版本、权限、数据量和既有结构不在本轮隔离数据中。

## 实际浏览器回归

使用独立临时 Chrome 用户目录和本机 Mock HTTP 服务加载最新默认前端构建。没有使用个人浏览器配置、真实账号、真实模型渠道或生产服务。

最终验证全部通过：

- 缺少前端缓存版本标记时，原 `playground_messages` 中的两条历史仍可见。
- 默认入口输入框可用，续聊请求保留原用户/助手上下文。
- 只产生一次本机 Mock 模型调用，页面正常显示流式回复。
- 默认入口没有调用会话列表、消息读取或会话保存接口。
- 自动保存完成后刷新，原消息、新用户输入和 Mock 回复仍保留。
- `/playground?history=server` 加载服务端合成历史，不混入原本地历史。
- 查看服务端历史只产生读取，没有模型调用或历史写入，也没有删除原本地缓存。
- 最终过程无浏览器运行时异常。

Browser Use 插件因额度不足无法执行，本地浏览器桥接也超时；最终改为独立本机无头 Chrome，通过浏览器协议完成上述验证。Windows/macOS 原生 Electron 安装包 GUI、Apifox GUI 未在本轮执行，不计为通过。

## 本轮最小修复

| 文件 | 改动 |
|---|---|
| `web/default/src/features/playground/hooks/use-playground-state.ts` | 恢复父版本的本地消息加载/保存逻辑；服务端模式可显式关闭本地历史读写 |
| `web/default/src/features/playground/index.tsx` | 原本地模式作为默认；服务端模式组件独立，复用同一原模型请求和界面处理逻辑 |
| `web/default/src/routes/_authenticated/playground/index.tsx` | 仅 `history=server` 参数启用同步 UI，原链接和 prompt 参数保留 |
| `web/default/src/lib/frontend-cache.ts` | UI 缓存清理保留本地聊天记录及 `conversation-draft-v1:*` 草稿 |
| `controller/ark_asset_test.go` | 修正一个过时预期：GroupId 可省略，缺渠道绑定时是 ChannelBindingRequired，不是 InvalidParameter；没有修改素材业务实现 |
| `controller/desktop_auth_test.go` | 增强现有 90 天、换取 Cookie 后可用、撤销后拒绝的回归断言 |
| `docs/conversation-history.md`、`docs/desktop-usage-logs.md` | 更新入口和验证状态 |
| `docs/regression-2026-11-23.md` | 本报告 |

没有更改登录设备数量限制、计费语义、已有数据库字段含义或任何真实业务数据；未执行破坏性 Git 操作。

## 未通过的存量静态检查

- `bun run lint`：508 条 error，分布在 204 个文件。第一轮检查确认诊断文件均不在基线提交 `94e8da79f` 的改动文件中。本轮涉及的四个前端文件单独 lint 通过；没有全局格式化或批量修复这些存量代码。
- `go vet ./...`：`common/custom-event.go` 四条复制 mutex 的诊断，`common/email_test.go` 一条 IPv6 地址格式诊断。这两个文件在基线提交及本轮均未改动；改动相关 Go 包的 vet 通过。

上述不是本轮发现的功能测试失败，但仍是全仓库静态门禁的未通过项。若部署流水线强制全局 lint/vet，门禁仍会失败，需要作为单独任务处理，不能伪报全部检查通过。

## 执行顺序与复现

先完成两套前端构建，再运行 Go 全仓库测试/主程序构建。主程序通过 go:embed 读取 dist，不能与清理 dist 的前端构建并行。本轮发现的并行构建 setup failure 已按此顺序串行重跑，最终无失败。

```bash
# web/default
bun test ./src
bun run typecheck
bun run build

# web/classic
bun run build

# 仓库根目录，测试数据与数据库环境必须隔离
GOCACHE=/tmp/utoken-full-regression-cache go test ./... -json -count=1
GOCACHE=/tmp/utoken-full-regression-cache go vet ./controller ./model ./dto ./router
GOCACHE=/tmp/utoken-full-regression-cache go build -o /tmp/utoken-regression-app .
node --test electron/desktop-auth.test.js electron/server-origin.test.js
```

执行全量 Go 时清除了 SQL_DSN、LOG_SQL_DSN、REDIS_CONN_STRING、TEST_MYSQL_DSN、TEST_POSTGRES_DSN；外部数据库用例只在补跑时设置为本轮容器的明确测试地址。

临时详细结果：`/tmp/utoken-complete-final-go-tests.jsonl`、`/tmp/utoken-final-frontend-tests.log`、`/tmp/utoken-regression-browser-result.log`、`/tmp/utoken-db-{sqlite,mysql,postgres}-upgrade.log`、`/tmp/utoken-external-token-tests.jsonl`。临时脚本/截图保留用于本轮复核，不是正式安装包或生产数据。

## 环境收尾

本轮专用 MySQL/PostgreSQL 容器、无头 Chrome 和本机 Mock HTTP 服务均已停止。容器启用 --rm，无生产持久卷；临时日志、脚本、截图和编译产物仅保留在 /tmp，未创建压缩包、未发布、未修改生产配置。
