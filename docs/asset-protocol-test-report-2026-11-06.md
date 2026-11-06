# 素材库剩余协议真实上游测试报告

测试日期：2026-11-06

测试范围：天翼云中转（`relay`）、Bit 官方（`bit_official`）、星枢无极（`xswj_official`）、Baidu DataBuilder（`baidu_databuilder`）、360 AI（`qihoo360`）。火山方舟和移动云不在本轮范围内。

## 结果汇总

| 协议 | 渠道 | 真实上游结果 | 本轮接口对接结果 |
| --- | ---: | --- | --- |
| 天翼云中转 `relay` | 5 | 上传、查询、删除通过；本站公开上传、查询、删除 API 通过 | 补齐上游删除，并接入本站删除联动 |
| 天翼云中转 `relay` | 34 | 上传、查询、删除通过 | 与渠道 5 共用实现 |
| 天翼云中转 `relay` | 15 | **失败**：HTTP 403，`model_not_activated`，模型未开通 | 协议本身已由渠道 5、34 验证，无额外代码改动 |
| Bit 官方 `bit_official` | 8 | **失败**：HTTP 401，`AccessDenied`，Access Key 无效或已停用 | 已复用方舟完整管理协议；需更换有效凭据后复测 |
| 星枢无极 `xswj_official` | 12 | 上传、查询、创建组、创建素材、更新素材、更新组、删除素材、删除组全部通过 | 复用方舟完整管理协议，无需新增适配代码 |
| Baidu DataBuilder `baidu_databuilder` | 30 | 新建有效素材组后，上传、查询及完整管理链路全部通过 | 补齐素材和素材组的显式创建、更新、删除接口 |
| 360 AI `qihoo360` | 35 | 使用正确的 Image/PNG 样本后，上传、查询及完整管理链路全部通过 | 补齐素材和素材组的显式创建、更新、删除接口 |

## 失败与配置问题

### Bit 官方渠道 8

真实 `CreateAsset` 请求已到达 Bit 官方上游，但返回：

```text
HTTP 401 AccessDenied
Access Key 无效或已停用
```

这是当前渠道凭据问题，不是请求签名或接口路径未接通。部署复测前必须更换有效的素材 AK/SK；凭据未修复前，完整管理链路无法继续实测。

### 天翼云渠道 15

上游返回：

```text
HTTP 403 model_not_activated
模型未开通，请联系管理员
```

这是上游账号或模型开通问题。相同 `relay` 协议已在渠道 5、34 完成上传、查询、删除实测，因此不需要修改协议代码。渠道 15 需开通对应模型后再复测，或改用已验证渠道。

### Baidu DataBuilder 渠道 30 的旧素材组

首次使用渠道中保存的旧素材组上传时返回：

```text
HTTP 404 NotFound.resource
素材组不存在或无权限访问
```

忽略旧组并重新创建素材组后，上传、查询以及完整管理链路均通过，说明 BCE Auth V1 签名和协议实现可用。部署复测前应清空渠道的旧 `asset_group_id`，让系统自动建组并回写，或改填一个当前账号可访问的有效组 ID。

### 360 AI 测试样本说明

首次测试误将视频 URL 按 `Image` 类型提交，上游返回 HTTP 400 `Unsupported media format`。改用 PNG 公网 URL 后全部通过，该首次失败不属于协议故障。复测时应确保 `AssetType` 与源文件类型一致。

## 已通过的真实管理链路

星枢无极渠道 12、Baidu DataBuilder 渠道 30、360 AI 渠道 35 均按以下顺序直连真实上游执行并通过：

1. `CreateAssetGroup`
2. `CreateAsset`
3. `GetAsset` 轮询至 `Active`
4. `UpdateAsset`
5. `UpdateAssetGroup`
6. `DeleteAsset`
7. `DeleteAssetGroup`

测试创建的素材和素材组已在链路末尾删除。

天翼云渠道 5、34 的中转协议只具备上传、查询、删除语义，不提供官方素材组管理协议。渠道 5 另外完成本站以下公开 API 实测：

- `POST /v1/api/assets/upload`
- `GET /v1/api/assets/{id}`，状态由 `Pending` 轮询至 `Active`
- `DELETE /v1/api/assets/{id}`，同时联动上游删除

## 本轮代码改动

- 新增独立 `AssetDeleter` 能力，完整官方管理协议和中转协议可分别声明删除能力。
- Baidu DataBuilder 实现完整 `AssetManagement`，自动上传与显式管理接口复用同一创建逻辑。
- 360 AI 实现完整 `AssetManagement`，新增 update/delete 四类 `cmecloud/*` model。
- `RelayProtocol` 实现 `DELETE {asset_query_path}`；HTTP 200 且 `code == 0` 即视为成功，不强制要求响应包含 `data.Deleted`。
- 本站删除素材时，通过 `AssetDeleter` 对 Relay、Baidu DataBuilder、360 AI 和方舟系协议执行 best-effort 上游删除；上游删除失败只记录日志，不阻断本地删除。
- 新增协议请求契约测试和 Relay 控制器删除联动回归测试。

对外官方兼容 API 的 `ListAssets`、`ListAssetGroups`、`GetAsset`、`GetAssetGroup` 继续读取本站数据库并按用户归属过滤，不透传共享上游账号的全量列表；创建、更新、删除操作同步调用对应渠道上游。

## 回归验证

以下命令均已通过：

```text
go test ./relay/channel/asset ./controller ./middleware -count=1
go build ./...
gofmt -l <本轮修改的 Go 文件>
```

`gofmt -l` 无输出。

## 服务器部署复测前置条件

1. 启用需要复测的渠道。本次渠道 12、30、35 使用直接上游探针验证，测试时渠道本身为禁用状态。
2. 为视频模型 Key 绑定目标渠道；未绑定渠道的 Key 会按既定约束直接报错，不会自动选路。
3. 更换 Bit 渠道 8 的无效 AK/SK。
4. 开通天翼云渠道 15 对应模型，或改用渠道 5、34。
5. 处理 Baidu 渠道 30 已失效的 `asset_group_id`。
6. 使用上游可访问的公网源文件 URL，并保证素材类型与文件实际类型一致。
7. 服务器上分别执行公开上传、查询、删除，以及官方兼容 API 的创建、列表、查询、更新、删除复测；列表和单条查询以本站登记数据为准。
