# 智能画布：手动联调清单（按工具）

> 本文只描述**真实上游联调**需要你做的事。所有条目都标注了当前状态：
>
> - ✅ **本地 mock 已通过**：协议映射、参数校验、结果处理、计费幂等已用本地 mock 上游跑通（`scripts/canvas-local-acceptance/`）。
> - 🟡 **真实协议已适配待联调**：请求/响应结构按公开文档实现，未对真实账号发过请求。
> - ⛔ **缺官方协议或配置，真实适配未完成**：需要你提供文档或授权后才能补齐。
>
> 本次交付内**没有任何真实上游调用**。下列操作全部由你执行，且**可能产生真实费用**。

## 0. 联调前的一次性准备

| 步骤 | 内容 | 说明 |
| --- | --- | --- |
| 1 | 在「渠道」页新增/确认一条火山方舟**图片**渠道（类型 45 或 60），模型列表含 `CANVAS_IMAGE_MODEL` | 画布只使用已启用的同类型渠道，找不到就判为不可用（不回退默认渠道） |
| 2 | 配置 `CANVAS_MEDIAKIT_API_KEY`（AI MediaKit） | 不配置时 5 个 MediaKit 工具在页面上显示「未配置 Key」并禁用提交 |
| 3 | 确认对象存储 `TOS_ACCESS_KEY/TOS_SECRET_KEY/TOS_BUCKET` 可用 | 上传、蒙版、结果转存都落在自有 TOS；未配置时上传与转存会直接失败并报错 |
| 4 | 确认发起联调的账号额度充足 | 画布先预扣、成功结算、失败退款；Ark 工具还会经 Relay 正常计费 |
| 5 | 打开页面 `/canvas`，先看每个工具是否 `available`，不可用时页面会显示后端返回的原因 | 这一屏就能判断配置是否齐 |

占位凭证（**请替换为你自己的真实值**，下面只是示例，不要直接使用）：

```
CANVAS_IMAGE_MODEL=doubao-seedream-4-0-250828
CANVAS_RELAY_BASE=            # 留空则回环到本机自身网关
CANVAS_MEDIAKIT_API_KEY=<你的 AI MediaKit API Key>
CANVAS_MEDIAKIT_BASE_URL=https://mediakit.cn-beijing.volces.com
CANVAS_UPSTREAM_TIMEOUT=180
CANVAS_TOOL_PRICE_ERASE=100   # 可选：画布层加价，单位 quota
```

## 1. 通用联调路径（每个工具都一样）

页面点击路径：**侧边栏「智能画布」→ 新建画布 → 上传图片（或从素材库导入）→ 右侧「工具」页签选工具 → 填参数 → 提交任务 → 「任务」页签看进度与结果 → 加入画布 / 保存到素材库**

提交任务的等价请求（示例见各工具小节），观察点：

1. `POST /api/canvas/tasks` 返回 `task.status=pending`、`quota` 为预扣额度；
2. `GET /api/canvas/tasks/:id` 轮询到 `succeeded`，`settledQuota` 与 `quota` 一致（或按实际结算）；
3. `result.images[].url` 必须是你自己的 TOS 域名；若出现上游临时链接，看 `result.warnings` 与 `repersist`；
4. 失败时 `errorCode/errorMsg` 是否可读；`status=reviewing` 表示上游结果未知（**不要手动重试同一幂等键以外的新任务，先核对上游账单**）。

## 2. 逐工具清单

### 2.1 文生图 `text2image` — 🟡 待联调

- 官方依据：火山方舟「图片生成 API」`POST /api/v3/images/generations`（经本仓库 Relay 以 `/v1/images/generations` 回环）。
- 前提：渠道已配置、模型在能力表登记（`doubao-seedream-4-0-250828` 已登记）。
- 示例请求：

```bash
curl -s -X POST "$BASE/api/canvas/tasks" \
  -H 'Content-Type: application/json' -H "New-Api-User: $UID" -b "$COOKIE" \
  -d '{"projectId":1,"tool":"text2image","idempotencyKey":"t2i-manual-1",
       "prompt":"一只坐在窗台上的橘猫，柔和晨光","size":"1024x1024"}'
```

- 预期：`task.model=doubao-seedream-4-0-250828`，上游请求体含 `response_format:"url"`、`watermark:false`、`size:"1024x1024"`；结果落到 TOS。
- 费用：按 Relay 的图片生成计费，**每次提交计一次**。

### 2.2 单图参考 `image_ref_single` — 🟡 待联调

- 页面：选中一个图片图层作为「源图」，提示词描述改造目标。
- 关键差异：`image` 字段是**字符串**（不是数组）。
- 费用：同上（Ark 计费）。

### 2.3 多图参考 `image_ref_multi` — 🟡 待联调

- 页面：源图层 + 「从素材库选择」补足参考图，面板显示「已选 N 张，最多 M 张」。
- 注意：上限由模型档案决定（当前登记 4.0 系列最多 14 张）；数组顺序即 `image[]` 顺序。
- 费用：按张数可能叠加，**联调时先用 2 张**。

### 2.4 涂抹消除 `erase` — 🟡 待联调

- 官方依据：AI MediaKit 同步工具 `POST /api/v1/tools-sync/erase-image`。
- 页面：工具面板点「画笔」或「框选」→ 在图上涂抹 → 「蒙版已就绪」→ 提交。
- 关键点：蒙版 PNG 的宽高**必须等于原图像素**（前端按原图尺寸生成，后端二次校验，不符直接 400）。
- 示例请求（`mask` 为 data URL）：

```bash
curl -s -X POST "$BASE/api/canvas/tasks" \
  -H 'Content-Type: application/json' -H "New-Api-User: $UID" -b "$COOKIE" \
  -d '{"projectId":1,"tool":"erase","idempotencyKey":"erase-manual-1",
       "images":["https://<你的TOS>/x.png"],"mask":"data:image/png;base64,....",
       "params":{"toolVersion":"standard"}}'
```

- 预期上游体：`{"image_url":...,"mask_url":...,"standard_scene":"selected_area_erase","tool_version":"standard"}`。
- 费用：MediaKit 侧按张计费 + 可选画布加价；同步接口，**不可取消**。

### 2.5 提示词局部编辑 `prompt_inpaint` — 🟡 待联调

- 页面：选中图片图层，提示词写清「改哪里、改成什么」，尺寸留空表示与原图同尺寸。
- 预期：回贴画布时与原图逐像素对齐（`size` 沿用原图）。

### 2.6 参考图局部编辑 `ref_inpaint` — 🟡 待联调

- 页面：源图层 + 素材库参考图（1~14 张）。
- 用途：保持人物/商品一致性后局部改造。

### 2.7 智能扩图 `outpaint` — 🟡 待联调

- 官方依据：AI MediaKit `POST /api/v1/tools-sync/expand-image-canvas`。
- 页面：四种方式都在参数区切换（等比 / 目标画幅 / 四边 / 自定义画布）。
- 关键点：官方四边比例范围 `[0, 0.4]`（相对短边）；换算超限会在本地 400 拦下，提示改用更接近原图的画幅。
- 示例（四边）：

```bash
-d '{"projectId":1,"tool":"outpaint","idempotencyKey":"expand-manual-1",
     "images":["https://<你的TOS>/x.png"],
     "params":{"mode":"edges","top":0.2,"bottom":0.2,"left":0.1,"right":0.1}}'
```

- 预期上游体：`{"image_url":...,"expand_top":0.2,...}`。
- 费用：按张计费，**扩图结果尺寸变大，注意后续处理成本**。

### 2.8 主体分割 / 透明抠图 `matting` — 🟡 待联调

- 官方依据：AI MediaKit `POST /api/v1/tools-sync/remove-image-background`。
- 参数：`scene`（general/human/product）、`needContour`、`contourColor`、`contourSize`、`cropBackground`。
- 预期：返回透明底 PNG；结果加入画布后为普通图片图层（画布背景仍按项目背景导出）。

### 2.9 普通超分 `upscale` — 🟡 待联调

- 官方依据：AI MediaKit `POST /api/v1/tools-sync/enhance-image`（`tool_version=standard|professional`）。
- 参数：`multiple`（1~8）或 `targetWidth/targetHeight`。
- 注意：MediaKit 对输入分辨率/体积有上限，超限会在本地校验阶段报错并说明。

### 2.10 生成式超分 `generative_upscale` — 🟡 待联调

- 同上接口，固定 `tool_version=max`，`multiple` 上限更高（1~30），可带 `generativeEnhanceMode`、`enableCorrectColor`。
- 费用提示：**单价通常最高**，联调时先用小图。

## 3. 需要你确认或补齐的事项

| 项 | 现状 | 需要你做什么 |
| --- | --- | --- |
| Ark 图片模型能力表 | 只登记了公开文档中明确给出限制的 seedream 家族（5.5/5.0-pro/5.0-flash/5.0-lite/4.5/4.0） | 若要用别的模型，请把官方「分辨率档位/像素范围/宽高比/参考图上限」给我，我补进 `service/canvas/capability.go`；未登记会被判不可用（这是有意为之，避免错误上限导致上游 400） |
| MediaKit 各工具的分辨率/体积限制 | 按公开「使用限制」实现（`mediaKitLimitFor`） | 如与你账号实际限制不同，请提供数值 |
| MediaKit 是否支持异步任务/取消 | 按**同步接口**实现，因此画布侧 `cancelable=false` | 若官方有异步任务接口与文档，我可以补「提交-轮询-取消」链路 |
| Ark 异步/取消 | 当前按同步生成实现 | 同上，需要官方异步任务接口文档 |
| 视觉理解类参数（如 `sequential_image_generation`） | 未开放到画布工具面板 | 如需要请在能力表登记后由我补参数 |
| 对象存储直传 | 走服务端中转 | 若要走前端直传，需要 STS 方案与你的桶策略 |

## 4. 联调时怎么判断「是配置问题还是代码问题」

- 页面工具卡片灰掉 + 有原因 → **配置问题**，按第 0 节补；
- 提交返回 `503 tool_unavailable` → 同上；
- 提交返回 400 且 message 指明参数/尺寸/蒙版 → **本地校验**，按提示调整输入；
- 任务 `failed` 且 `errorCode=http_4xx` → 上游拒绝，对照上游文档核对字段；
- 任务 `reviewing` → 上游结果未知，去上游控制台核对是否已出图/已计费，再决定人工补单或作废。
