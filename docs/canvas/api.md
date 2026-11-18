# 智能画布（Smart Canvas）接口文档

> 全部接口位于 `router/canvas-router.go`，前缀 `/api/canvas`，强制登录态（`middleware.UserAuth()`），
> 所有资源按 `userId` 做归属校验。返回统一为 `{"success":bool,"data":...}`；
> 失败为 `{"success":false,"code":"...","message":"..."}`，前端据此区分冲突/额度/不可用。

## 1. 数据模型

| 表 | 关键字段 | 说明 |
| --- | --- | --- |
| `canvas_projects` | `user_id`、`title`、`width/height`、`background`、`thumbnail`、`document`(LONGTEXT)、`revision`、`layer_count` | `revision` 为乐观锁；`document` 为整幅画布 JSON |
| `canvas_tasks` | `user_id`、`project_id`、`tool`、`idempotency_key`、`params_hash`、`status`、`stage`、`progress`、`upstream`、`model`、`channel_id`、`upstream_task_id`、`input_snapshot`、`result`、`billing_state`、`quota`、`settled_quota`、`funding_org_id` | `(user_id, project_id, idempotency_key)` 唯一索引 |
| `canvas_ledger` | `task_id`、`kind`、`quota`、`billing_state` | `(task_id, kind)` 唯一索引，保证预扣/结算/退款各最多一次 |

任务状态：`pending → running → succeeded | failed | canceled | reviewing`。
`reviewing` 表示**上游结果未知**（网络中断/超时/5xx），不自动重试、不自动退款，等待人工核对。

## 2. 接口

### 2.1 能力与素材

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/capabilities` | 返回 10 个工具的 `available/unavailableReason`、模型、渠道、蒙版语义、参数规格、限制、单价 |
| GET | `/assets?start_idx=` | 可导入的共享素材库图片（`refId/name/url`） |
| POST | `/upload` | multipart（`file` + `projectId`）上传本地图片，返回 `url/name/width/height/format/bytes` |
| GET | `/image?url=` | 同源图片代理（仅放行自有存储域名 + 本地存储替身），供导出与蒙版底图使用 |
| GET | `/local-asset/*name` | 本地存储替身读取（仅当 `CANVAS_LOCAL_STORAGE_DIR` 开启） |

### 2.2 项目

| 方法 | 路径 | 入参 | 说明 |
| --- | --- | --- | --- |
| GET | `/projects?p&page_size&keyword` | — | 列表（不含文档正文） |
| POST | `/projects` | `{title,width,height,background}` | 新建；缺省 2048×2048、`#ffffff`、标题「未命名画布」 |
| GET | `/projects/:id` | — | 详情（含 `document` 字符串） |
| PUT | `/projects/:id` | `{title}` | 重命名（不改 `revision`） |
| DELETE | `/projects/:id` | — | 级联删除任务与流水；对象存储文件保留 |
| PUT | `/projects/:id/document` | `{revision,document,thumbnail?,background?}` | 保存文档；旧 `revision` → **409 `revision_conflict`** |

`document` 结构：`{version:1,width,height,background,layers:[...]}`；
图层字段：`id/type(image|text)/name/url|text/x/y/width/height/scale/rotation/opacity/visible/locked/crop?/fontSize?/color?`。
校验：`version` 必须为 1、单边 ≤ 8192、宽高比 1:16~16:1、图层数上限、`image` 必须有 url、`text` 必须有内容、数值不得为 NaN/Inf、文档体积 ≤ 8MB。

### 2.3 任务

| 方法 | 路径 | 入参 | 说明 |
| --- | --- | --- | --- |
| POST | `/tasks` | 见下 | 提交任务；返回 `{task,reused}` |
| GET | `/tasks?projectId&tool&status&p&page_size` | — | 历史列表 |
| GET | `/tasks/:id` | — | 详情（含进度、结果、输入快照） |
| POST | `/tasks/:id/cancel` | — | 仅 `pending` 可取消；同步上游工具返回 **409 `cancel_not_supported`** |
| POST | `/tasks/:id/repersist` | — | 上游成功但转存失败时，从快照里的原始地址补存 |
| POST | `/tasks/:id/save-asset` | `{index,name}` | 结果图登记到共享素材库，返回 `{refId,name,url,assetType,createdAt}` |
| GET | `/tasks/:id/download?index=` | — | 302 到结果图地址（同步工具直接回源字节流） |

提交入参：

```json
{
  "projectId": 1,
  "tool": "erase",
  "idempotencyKey": "erase_<uuid>",
  "prompt": "可选，需要提示词的工具必填",
  "images": ["https://.../source.png", "asset:<refId>"],
  "mask": "data:image/png;base64,...",
  "size": "1024x1024",
  "params": {"mode": "edges", "top": 0.2}
}
```

语义要点：

- **幂等**：`(user, project, idempotencyKey)` 唯一。同键同参 → 复用原任务（`reused=true`）；同键异参 → **409 `idempotency_conflict`**。
- **蒙版**：只有 `supportsMask=required` 的工具接受蒙版，且蒙版尺寸必须与原图逐像素一致，否则 **400 `mask_size_mismatch`**；不允许蒙版的工具带蒙版会被拒。
- **计费**：先预扣（`quota`），成功按实际结算（`settledQuota`），definite 失败退款一次；`reviewing` 不退款。流水表唯一索引保证「至多预扣/结算/退款一次」。
- **归属**：项目、任务、素材引用全部校验 `userId`；越权一律当作「不存在」。

## 3. 十个工具与上游映射

| tool | 上游 | 请求映射 | 蒙版 | 输入图 | 需要提示词 |
| --- | --- | --- | --- | --- | --- |
| `text2image` | Ark（网关回环） | `POST /v1/images/generations`，`response_format=url`、`watermark=false` | 否 | 0 | 否 |
| `image_ref_single` | Ark | 同上，`image` 为字符串 | 否 | 1 | 是 |
| `image_ref_multi` | Ark | 同上，`image` 为数组（≤14） | 否 | 2~14 | 是 |
| `prompt_inpaint` | Ark | 同上，尺寸默认沿用原图 | 否 | 1 | 是 |
| `ref_inpaint` | Ark | 同上，参考图数组 | 否 | 1~14 | 是 |
| `erase` | MediaKit | `POST /api/v1/tools-sync/erase-image`，`standard_scene=selected_area_erase` + `mask_url` | **必需** | 1 | 否 |
| `outpaint` | MediaKit | `POST /api/v1/tools-sync/expand-image-canvas`，`expand_top/bottom/left/right`（相对短边，0~0.4） | 否 | 1 | 否 |
| `matting` | MediaKit | `POST /api/v1/tools-sync/remove-image-background`，`scene=general/human/product` | 否 | 1 | 否 |
| `upscale` | MediaKit | `POST /api/v1/tools-sync/enhance-image`，`tool_version=standard/professional` | 否 | 1 | 否 |
| `generative_upscale` | MediaKit | 同上，`tool_version=max` + `generative_enhance_mode` | 否 | 1 | 否 |

扩图四种方式统一换算为官方四边比例：`ratio`（等比倍数 1~1.8）、`aspect`（目标画幅）、`edges`（四边独立）、`canvas`（目标画布宽高）；换算结果超出 `[0,0.4]` 时在本地 400 拦下并说明原因。

## 4. 配置项

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `CANVAS_IMAGE_MODEL` | `doubao-seedream-4-0-250828` | Ark 图片模型；未在能力表登记的模型会判为不可用 |
| `CANVAS_RELAY_BASE` / `DIRECTOR_RELAY_BASE` | 本机 `127.0.0.1:PORT` | Ark 回环地址；计费走既有 Relay 链路 |
| `CANVAS_MEDIAKIT_API_KEY` | 空 | 未配置时 MediaKit 工具不可用并给出原因 |
| `CANVAS_MEDIAKIT_BASE_URL` | `https://mediakit.cn-beijing.volces.com` | MediaKit 网关 |
| `CANVAS_UPSTREAM_TIMEOUT` | `180` | 单次上游超时（秒） |
| `CANVAS_TOOL_PRICE_<TOOL>` | `0` | 画布层单价（quota/张），如 `CANVAS_TOOL_PRICE_ERASE=100`；Ark 工具由 Relay 计费，画布层不再加价 |
| `CANVAS_MAX_UPLOAD_MB` | `30` | 上传/蒙版体积上限 |
| `CANVAS_LOCAL_STORAGE_DIR` | 空 | **仅本地验收**：产物写本地目录，配 `/api/canvas/local-asset` 读取；不设置时走 TOS |
| `CANVAS_LOCAL_STORAGE_BASE` | 本机回环地址 | 本地替身对外基地址 |

## 5. 前端路由与入口

- 侧边栏「智能画布」→ `/canvas`（`chat` 分组，与调试台、素材库并列；代理商账号受 `experience` 菜单开关控制）
- `/canvas` 项目列表：新建 / 打开 / 重命名 / 删除
- `/canvas/:projectId` 编辑器：图层、缩放平移、蒙版画笔/框选、撤销重做、自动保存、PNG/JPEG 导出、工具面板、任务历史与结果处理

## 6. 本地验收脚本

```bash
go build -o /tmp/newapi_canvas .
python3 scripts/canvas-local-acceptance/acceptance.py --binary /tmp/newapi_canvas   # 接口全链路
node   scripts/canvas-local-acceptance/ui-smoke.mjs --binary /tmp/newapi_canvas     # 浏览器点击链路
```

两个脚本都会：起本地 mock 上游（`mock_upstream.py`）→ 临时 SQLite → 本地存储替身 → 走完全链路。
**默认保留临时目录并打印路径**，只有显式加 `--clean` 才会清理。
