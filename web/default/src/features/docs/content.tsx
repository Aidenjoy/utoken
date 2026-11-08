/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { ReactNode } from 'react'

import { CodeBlock } from './code-block'
import { InlineCode, Note, P } from './doc-typography'

export type DocsTabId = 'language' | 'image' | 'video' | 'faq'

export interface DocSection {
  id: string
  title: string
  /** 侧边栏短标题（缺省用 title）：三级接口条目用 Action 名保持目录紧凑 */
  short?: string
  body: ReactNode
  /** 二级/三级菜单子章节：正文渲染为父章节内的子块 */
  children?: DocSection[]
}

/** 深度优先展平章节树（含子章节），顺序与正文渲染顺序一致，供目录高亮与锚点定位使用。 */
export function flattenDocSections(sections: DocSection[]): DocSection[] {
  const out: DocSection[] = []
  const walk = (list: DocSection[]) => {
    for (const s of list) {
      out.push(s)
      if (s.children) walk(s.children)
    }
  }
  walk(sections)
  return out
}

/**
 * 从系统状态解析站点根地址（系统设置 → 服务器地址），去掉尾部斜杠；
 * 未配置时回退到当前页面同源地址。部署变更只需修改系统设置，无需改代码。
 */
export function resolveDocsSiteUrl(status: unknown): string {
  const s = status as {
    server_address?: unknown
    data?: { server_address?: unknown }
  } | null
  const candidate = s?.server_address ?? s?.data?.server_address
  if (typeof candidate === 'string' && candidate) {
    return candidate.replace(/\/+$/, '')
  }
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

const VIDEO_MODEL = 'doubao-seedance-2.0'

function buildLanguageSections(siteUrl: string): DocSection[] {
  const baseUrl = `${siteUrl}/v1`
  return [
    {
      id: 'lang-chat',
      title: '对话补全',
      body: (
        <>
          <P>
            兼容 OpenAI Chat Completions 协议，将 <InlineCode>model</InlineCode>{' '}
            替换为模型广场中的语言模型 ID 即可调用。
          </P>
          <CodeBlock
            method='POST'
            url={`${baseUrl}/chat/completions`}
            lang='json'
            code={`{
  "model": "kimi-k3",
  "messages": [
    {"role": "system", "content": "你是一个乐于助人的助手"},
    {"role": "user", "content": "你是什么模型"}
  ],
  "stream": false
}`}
          />
          <CodeBlock
            title='curl 示例'
            lang='bash'
            code={`curl -X POST ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer sk-你的token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kimi-k3",
    "messages": [
      {"role": "system", "content": "你是一个乐于助人的助手"},
      {"role": "user", "content": "你是什么模型"}
    ],
    "stream": false
  }'`}
          />
          <CodeBlock
            title='响应示例'
            lang='json'
            code={`{
  "id": "chatcmpl-a1b2c3",
  "object": "chat.completion",
  "created": 1767225600,
  "model": "kimi-k3",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "我是由……"},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 24, "completion_tokens": 38, "total_tokens": 62}
}`}
          />
          <Note>
            示例中的模型 ID 仅作演示，请从「模型广场」复制实际可用的语言模型
            ID。流式输出将 <InlineCode>stream</InlineCode> 设为{' '}
            <InlineCode>true</InlineCode>
            ，响应为 SSE（Server-Sent Events）逐段返回，以{' '}
            <InlineCode>data: [DONE]</InlineCode> 结束。
          </Note>
        </>
      ),
    },
    {
      id: 'lang-models',
      title: '获取模型列表',
      body: (
        <>
          <P>查询当前账号分组下可用的全部模型 ID。</P>
          <CodeBlock
            method='GET'
            url={`${baseUrl}/models`}
            lang='bash'
            code={`curl -X GET ${baseUrl}/models \\
  -H "Authorization: Bearer sk-你的token"`}
          />
        </>
      ),
    },
  ]
}

const IMAGE_MODEL = 'doubao-seedream-5-0'

function buildImageSections(siteUrl: string): DocSection[] {
  const baseUrl = `${siteUrl}/v1`
  return [
    {
      id: 'image-generations',
      title: '文生图',
      body: (
        <>
          <P>
            兼容 OpenAI Images 协议，根据提示词生成图片。示例中的模型 ID
            仅作演示，请从「模型广场」复制实际的图片模型 ID。
          </P>
          <CodeBlock
            method='POST'
            url={`${baseUrl}/images/generations`}
            lang='json'
            code={`{
  "model": "${IMAGE_MODEL}",
  "prompt": "一只橘猫在草地上奔跑，阳光明媚，高清摄影风格",
  "size": "2048x2048",
  "watermark": false
}`}
          />
          <CodeBlock
            title='curl 示例'
            lang='bash'
            code={`curl -X POST ${baseUrl}/images/generations \\
  -H "Authorization: Bearer sk-你的token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${IMAGE_MODEL}",
    "prompt": "一只橘猫在草地上奔跑，阳光明媚，高清摄影风格",
    "size": "2048x2048",
    "watermark": false
  }'`}
          />
          <CodeBlock
            title='响应示例'
            lang='json'
            code={`{
  "created": 1767225600,
  "data": [
    {"url": "https://example.com/generated-image.png"}
  ]
}`}
          />
          <Note>
            <InlineCode>watermark</InlineCode> 设为{' '}
            <InlineCode>false</InlineCode> 可去除图片右下角的「AI 生成」水印；
            <InlineCode>size</InlineCode>{' '}
            等参数的可选值因模型而异，请以「模型广场」中对应模型的说明为准；生成的图片
            URL 为临时地址，请及时下载保存。
          </Note>
        </>
      ),
    },
    {
      id: 'image-to-image',
      title: '图生图',
      body: (
        <>
          <P>
            与文生图同一接口，通过 <InlineCode>image</InlineCode>{' '}
            传入一张输入图片，按提示词在其基础上生成新图；取值支持可公开访问的
            URL 或 base64（
            <InlineCode>data:image/png;base64,...</InlineCode>）。
          </P>
          <CodeBlock
            method='POST'
            url={`${baseUrl}/images/generations`}
            lang='json'
            code={`{
  "model": "${IMAGE_MODEL}",
  "prompt": "将照片转换为水彩画风格，保持构图不变",
  "image": "https://example.com/photo.jpg",
  "size": "2048x2048",
  "watermark": false
}`}
          />
          <CodeBlock
            title='curl 示例'
            lang='bash'
            code={`curl -X POST ${baseUrl}/images/generations \\
  -H "Authorization: Bearer sk-你的token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${IMAGE_MODEL}",
    "prompt": "将照片转换为水彩画风格，保持构图不变",
    "image": "https://example.com/photo.jpg",
    "size": "2048x2048",
    "watermark": false
  }'`}
          />
          <Note>
            输入图片需为可公开访问的 URL 或 base64
            内联数据；响应结构与文生图一致。
          </Note>
        </>
      ),
    },
    {
      id: 'image-edits',
      title: '图片编辑（参考生图）',
      body: (
        <>
          <P>
            与文生图同一接口，<InlineCode>image</InlineCode>{' '}
            传入多张参考图（数组），模型综合各图内容按提示词生成，例如人物换装、
            风格融合。
          </P>
          <CodeBlock
            method='POST'
            url={`${baseUrl}/images/generations`}
            lang='json'
            code={`{
  "model": "${IMAGE_MODEL}",
  "prompt": "将图一中的人物穿上图二中的服装，保持人物姿态不变",
  "image": [
    "https://example.com/person.jpg",
    "https://example.com/outfit.jpg"
  ],
  "size": "2048x2048",
  "watermark": false
}`}
          />
          <CodeBlock
            title='curl 示例'
            lang='bash'
            code={`curl -X POST ${baseUrl}/images/generations \\
  -H "Authorization: Bearer sk-你的token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${IMAGE_MODEL}",
    "prompt": "将图一中的人物穿上图二中的服装，保持人物姿态不变",
    "image": [
      "https://example.com/person.jpg",
      "https://example.com/outfit.jpg"
    ],
    "size": "2048x2048",
    "watermark": false
  }'`}
          />
          <Note>
            参考图需为可公开访问的 URL 或 base64
            内联数据；响应结构与文生图一致。
          </Note>
        </>
      ),
    },
  ]
}

const videoSubmitResponse = `{"id": "cgt-20260826120000-abc12"}`

function buildVideoSections(siteUrl: string): DocSection[] {
  const tasksUrl = `${siteUrl}/api/v3/contents/generations/tasks`
  return [
    {
      id: 'video-reference',
      title: '参考生成',
      body: (
        <>
          <P>
            参考生成支持文本 + 参考图（0-9 张）+ 参考视频（0-3 个）+
            参考音频（0-3
            个）自由组合，示例中的各项按需删减即可；音频不可单独参考，至少搭配一张图片或一个视频。参考图片支持两种写法：直接
            URL，或素材库引用 <InlineCode>asset://&lt;素材ID&gt;</InlineCode>
            （真人虚拟素材上传见「素材库」一节）
          </P>
          <CodeBlock
            method='POST'
            url={tasksUrl}
            lang='json'
            code={`{
  "model": "${VIDEO_MODEL}",
  "content": [
    {"type": "text", "text": "结合参考图中的人物与场景，跟随参考视频的运镜生成新视频，并以参考音频为背景音乐节奏"},
    {"type": "image_url", "image_url": {"url": "https://example.com/reference1.jpg"}, "role": "reference_image"},
    {"type": "image_url", "image_url": {"url": "asset://asset-20260716111338-vwmxj"}, "role": "reference_image"},
    {"type": "video_url", "video_url": {"url": "https://example.com/reference.mp4"}, "role": "reference_video"},
    {"type": "audio_url", "audio_url": {"url": "https://example.com/reference.mp3"}, "role": "reference_audio"}
  ],
  "resolution": "480p",
  "duration": 4,
  "generate_audio": true
}`}
          />
          <CodeBlock
            title='提交响应（id 为任务 ID，用于查询）'
            lang='json'
            code={videoSubmitResponse}
          />
          <CodeBlock
            title='curl 示例'
            lang='bash'
            code={`curl -X POST ${tasksUrl} \\
  -H "Authorization: Bearer sk-你的token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${VIDEO_MODEL}",
    "content": [
      {"type": "text", "text": "结合参考图中的人物与场景，跟随参考视频的运镜生成新视频，并以参考音频为背景音乐节奏"},
      {"type": "image_url", "image_url": {"url": "https://example.com/reference1.jpg"}, "role": "reference_image"},
      {"type": "image_url", "image_url": {"url": "asset://asset-20260716111338-vwmxj"}, "role": "reference_image"},
      {"type": "video_url", "video_url": {"url": "https://example.com/reference.mp4"}, "role": "reference_video"},
      {"type": "audio_url", "audio_url": {"url": "https://example.com/reference.mp3"}, "role": "reference_audio"}
    ],
    "resolution": "480p",
    "duration": 4,
    "generate_audio": true
  }'`}
          />
          <Note>
            含参考视频时按视频编辑任务处理：输出比例跟随输入视频，无需传{' '}
            <InlineCode>ratio</InlineCode>；<InlineCode>duration</InlineCode> 传
            -1 表示输出时长跟随输入视频。
          </Note>
        </>
      ),
    },
    {
      id: 'video-text',
      title: '文生视频',
      body: (
        <>
          <P>仅通过文字提示词生成视频。</P>
          <CodeBlock
            method='POST'
            url={tasksUrl}
            lang='json'
            code={`{
  "model": "${VIDEO_MODEL}",
  "content": [
    {"type": "text", "text": "一只橘猫在草地上奔跑，阳光明媚"}
  ],
  "resolution": "480p",
  "ratio": "16:9",
  "duration": 4,
  "generate_audio": true
}`}
          />
          <CodeBlock
            title='提交响应（id 为任务 ID，用于查询）'
            lang='json'
            code={videoSubmitResponse}
          />
          <CodeBlock
            title='curl 示例'
            lang='bash'
            code={`curl -X POST ${tasksUrl} \\
  -H "Authorization: Bearer sk-你的token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${VIDEO_MODEL}",
    "content": [
      {"type": "text", "text": "一只橘猫在草地上奔跑，阳光明媚"}
    ],
    "resolution": "480p",
    "ratio": "16:9",
    "duration": 4,
    "generate_audio": true
  }'`}
          />
          <Note>
            创建任务还可按模型能力使用{' '}
            <InlineCode>omni_reference_task_type</InlineCode> /{' '}
            <InlineCode>frames</InlineCode> / <InlineCode>watermark</InlineCode>{' '}
            / <InlineCode>output_format</InlineCode> /{' '}
            <InlineCode>seed</InlineCode> /{' '}
            <InlineCode>camera_fixed</InlineCode> /{' '}
            <InlineCode>return_last_frame</InlineCode> /{' '}
            <InlineCode>draft</InlineCode> /{' '}
            <InlineCode>service_tier</InlineCode> /{' '}
            <InlineCode>callback_url</InlineCode> /{' '}
            <InlineCode>execution_expires_after</InlineCode> /{' '}
            <InlineCode>priority</InlineCode> /{' '}
            <InlineCode>safety_identifier</InlineCode> /{' '}
            <InlineCode>tools</InlineCode>。
          </Note>
          <Note>
            官方默认值：<InlineCode>omni_reference_task_type=auto</InlineCode>、
            <InlineCode>watermark=false</InlineCode>、
            <InlineCode>output_format=mp4</InlineCode>、
            <InlineCode>seed=-1</InlineCode>、
            <InlineCode>camera_fixed=false</InlineCode>、
            <InlineCode>return_last_frame=false</InlineCode>、
            <InlineCode>draft=false</InlineCode>、
            <InlineCode>service_tier=default</InlineCode>、
            <InlineCode>execution_expires_after=172800</InlineCode>、
            <InlineCode>priority=0</InlineCode>；具体可用取值以模型能力为准。
          </Note>
        </>
      ),
    },
    {
      id: 'video-frames',
      title: '首尾帧生视频',
      body: (
        <>
          <P>
            通过 <InlineCode>first_frame</InlineCode> 与{' '}
            <InlineCode>last_frame</InlineCode>{' '}
            指定视频的首帧与尾帧画面，模型生成中间过渡内容。
          </P>
          <CodeBlock
            method='POST'
            url={tasksUrl}
            lang='json'
            code={`{
  "model": "${VIDEO_MODEL}",
  "content": [
    {"type": "text", "text": "从白天过渡到黑夜的城市天际线"},
    {"type": "image_url", "image_url": {"url": "https://example.com/first-frame.jpg"}, "role": "first_frame"},
    {"type": "image_url", "image_url": {"url": "https://example.com/last-frame.jpg"}, "role": "last_frame"}
  ],
  "resolution": "480p",
  "ratio": "16:9",
  "duration": 4
}`}
          />
          <CodeBlock
            title='curl 示例'
            lang='bash'
            code={`curl -X POST ${tasksUrl} \\
  -H "Authorization: Bearer sk-你的token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${VIDEO_MODEL}",
    "content": [
      {"type": "text", "text": "从白天过渡到黑夜的城市天际线"},
      {"type": "image_url", "image_url": {"url": "https://example.com/first-frame.jpg"}, "role": "first_frame"},
      {"type": "image_url", "image_url": {"url": "https://example.com/last-frame.jpg"}, "role": "last_frame"}
    ],
    "resolution": "480p",
    "ratio": "16:9",
    "duration": 4
  }'`}
          />
        </>
      ),
    },
    {
      id: 'video-query',
      title: '查询任务状态',
      body: (
        <>
          <P>
            视频生成为异步任务，提交后轮询该接口直到{' '}
            <InlineCode>status</InlineCode> 变为{' '}
            <InlineCode>succeeded</InlineCode>。
          </P>
          <CodeBlock
            method='GET'
            url={`${tasksUrl}/{task_id}`}
            lang='bash'
            code={`# 将 {task_id} 替换为提交任务返回的 id
curl -X GET ${tasksUrl}/{task_id} \\
  -H "Authorization: Bearer sk-你的token"`}
          />
          <CodeBlock
            title='响应示例'
            lang='json'
            code={`{
  "id": "cgt-20260826120000-abc12",
  "model": "${VIDEO_MODEL}",
  "status": "succeeded",
  "content": {
    "video_url": "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/xxx/demo.mp4"
  },
  "usage": {"completion_tokens": 40594, "total_tokens": 40594},
  "created_at": 1787736000,
  "updated_at": 1787736060,
  "seed": 70172,
  "resolution": "480p",
  "ratio": "16:9",
  "duration": 4,
  "framespersecond": 24,
  "service_tier": "default",
  "execution_expires_after": 172800,
  "generate_audio": true,
  "draft": false,
  "priority": 0
}`}
          />
          <Note>
            <InlineCode>status</InlineCode> 取值 <InlineCode>queued</InlineCode>{' '}
            / <InlineCode>running</InlineCode> /{' '}
            <InlineCode>cancelled</InlineCode> /{' '}
            <InlineCode>succeeded</InlineCode> / <InlineCode>failed</InlineCode>{' '}
            / <InlineCode>expired</InlineCode>；
            <InlineCode>succeeded</InlineCode> 时{' '}
            <InlineCode>content.video_url</InlineCode> 为视频地址，有效期 24
            小时，请及时下载或转存。
          </Note>
          <Note>
            <InlineCode>failed</InlineCode> 时通过{' '}
            <InlineCode>error.code</InlineCode> /{' '}
            <InlineCode>error.message</InlineCode> 返回失败原因；创建时设置{' '}
            <InlineCode>return_last_frame=true</InlineCode> 后，成功响应还会包含{' '}
            <InlineCode>content.last_frame_url</InlineCode>。
          </Note>
        </>
      ),
    },
    {
      id: 'video-asset-official',
      title: '素材库',
      body: (
        <>
          <P>
            提供火山方舟官方素材库 10 个 Action 的兼容入口：下游可用火山官方 SDK
            或 curl，把 endpoint 指向本站、用在「Key 管理」页生成的 AK/SK 做 V4
            签名调用；请求参数、响应字段和{' '}
            <InlineCode>ResponseMetadata</InlineCode>/{' '}
            <InlineCode>Result</InlineCode> 信封按官方协议转换，渠道未适配的上游
            操作会返回明确错误。
          </P>
          <Note>
            鉴权与隔离：在「Key 管理」页为令牌生成 Ark AK/SK；签名{' '}
            <InlineCode>service=ark</InlineCode>、
            <InlineCode>region</InlineCode> 任意（如{' '}
            <InlineCode>cn-beijing</InlineCode>
            ）。列表/查询以本站数据库为准，按
            AK→令牌→用户归属过滤，只能查到自己创建的素材与素材组，天然多租户隔离。
          </Note>
          <Note>
            调用形态：统一{' '}
            <InlineCode>{`POST ${siteUrl}/?Action=<接口名>&Version=2024-01-01`}</InlineCode>
            ，<InlineCode>Content-Type: application/json</InlineCode>
            ，AK/SK V4 签名（
            <InlineCode>Authorization: HMAC-SHA256 Credential=...</InlineCode>
            ）。状态词表 <InlineCode>Active</InlineCode> /{' '}
            <InlineCode>Processing</InlineCode> /{' '}
            <InlineCode>Failed</InlineCode>；列表用{' '}
            <InlineCode>NextToken</InlineCode> 游标分页（
            <InlineCode>MaxResults</InlineCode> 默认 10、范围 1～100）。
          </Note>
          <CodeBlock
            title='成功响应信封'
            lang='json'
            code={`{
  "ResponseMetadata": {
    "RequestId": "20260716111338-vwmxj",
    "Action": "CreateAssetGroup",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {"Id": "group-20260716105134-zkx8t"}
}`}
          />
          <CodeBlock
            title='错误响应信封（无 Result）'
            lang='json'
            code={`{
  "ResponseMetadata": {
    "RequestId": "20260716111339-abcde",
    "Action": "GetAsset",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing",
    "Error": {"CodeN": 404, "Code": "NotFound", "Message": "asset not found"}
  }
}`}
          />
          <CodeBlock
            title='火山官方 Go SDK（service/ark）示意：仅把 endpoint 指向本站'
            lang='bash'
            code={`svc := ark.NewInstance()
svc.SetRegion("cn-beijing")            // region 任意
svc.SetService("ark")                  // 固定 ark
svc.SetEndpoint("${siteUrl}")          // ← 指向本站（系统设置 → 服务器地址）
svc.SetAK("AKUTxxxxxxxxxxxxxxxxxxxx")  // 「Key 管理」页生成的 AccessKey
svc.SetSK("your-secret-key")           // 「Key 管理」页生成的 SecretKey

out, err := svc.CreateAssetGroup(ctx, &ark.CreateAssetGroupInput{
    Name:        ark.String("我的素材组"),
    Description: ark.String("可选描述"),
})
// out.Result.Id 即素材组 ID；SDK 自动完成 V4 签名`}
          />
          <CodeBlock
            title='curl 签名请求示例（把 <你的域名> 换成本站域名，不含 https://）'
            lang='bash'
            code={`curl -X POST "${siteUrl}/?Action=ListAssets&Version=2024-01-01" \\
  -H "Content-Type: application/json" \\
  -H "Host: <你的域名>" \\
  -H "X-Date: 20260716T031338Z" \\
  -H "X-Content-Sha256: <请求体的 SHA256 十六进制>" \\
  -H "Authorization: HMAC-SHA256 Credential=<AK>/20260716/cn-beijing/ark/request, SignedHeaders=host;x-content-sha256;x-date, Signature=<V4 签名>" \\
  -d '{"Filter":{"GroupIds":["group-20260716105134-zkx8t"],"GroupType":"AIGC"},"MaxResults":10}'`}
          />
          <Note>
            V4 签名步骤（用官方 SDK 可自动完成，无需手写）：①
            构造规范请求（方法、 URI、query、参与签名的头、payload 哈希）；② 拼
            StringToSign（算法、X-Date、 scope、规范请求哈希）；③ 用 SK
            逐级派生签名密钥（date/region/service）；④ HMAC-SHA256 得到
            Signature 并写入 Authorization 头。X-Date 需在 ±15 分钟内，
            X-Content-Sha256 须等于请求体哈希，否则返回 SignatureDoesNotMatch /
            RequestExpired。
          </Note>
          <Note>
            限制：官方兼容 API 需上游渠道具备对应素材管理能力；ark_official、
            ecloud 等已适配渠道可使用完整管理接口，其他渠道以实际适配能力为准，
            未适配时返回明确错误；并发/QPS 以本站为准。上面 Go SDK
            片段仅为示意， 具体实例化方法、输入结构体与字段名以火山官方
            volcengine-go-sdk（service/ark）为准。
          </Note>
        </>
      ),
      children: [
        {
          id: 'video-asset-official-create-group',
          title: 'CreateAssetGroup · 创建素材组',
          short: 'CreateAssetGroup',
          body: (
            <>
              <P>
                创建素材组。<InlineCode>GroupType</InlineCode>{' '}
                可省略，当前仅支持 <InlineCode>AIGC</InlineCode>；
                <InlineCode>ProjectName</InlineCode> 默认{' '}
                <InlineCode>default</InlineCode>。
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=CreateAssetGroup&Version=2024-01-01`}
                lang='json'
                code='{"Name":"我的素材组","Description":"可选描述","GroupType":"AIGC","ProjectName":"default"}'
              />
              <CodeBlock
                title='Result'
                lang='json'
                code='{"Id": "group-20260716105134-zkx8t"}'
              />
              <Note>
                创建素材组使用当前 Key 绑定的启用素材渠道，Key
                未绑定渠道时无法建组； 同一素材组内的 CreateAsset
                锁定到建组时的渠道，保证同一上游账号。
              </Note>
            </>
          ),
        },
        {
          id: 'video-asset-official-create',
          title: 'CreateAsset · 创建素材',
          short: 'CreateAsset',
          body: (
            <>
              <P>
                在指定素材组内创建素材。<InlineCode>URL</InlineCode>{' '}
                必须是公网可访问的 http(s) 地址（由上游拉取，非文件流）；
                <InlineCode>AssetType</InlineCode> 取值{' '}
                <InlineCode>Image</InlineCode> / <InlineCode>Video</InlineCode>{' '}
                / <InlineCode>Audio</InlineCode>；<InlineCode>Name</InlineCode>{' '}
                可省略。
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=CreateAsset&Version=2024-01-01`}
                lang='json'
                code='{"GroupId":"group-20260716105134-zkx8t","URL":"https://picsum.photos/id/1074/800/600","AssetType":"Image","Name":"lion01","ProjectName":"default"}'
              />
              <CodeBlock
                title='Result'
                lang='json'
                code='{"Id": "asset-20260716111338-vwmxj"}'
              />
            </>
          ),
        },
        {
          id: 'video-asset-official-list-groups',
          title: 'ListAssetGroups · 列出素材组',
          short: 'ListAssetGroups',
          body: (
            <>
              <P>
                列出素材组，<InlineCode>Filter</InlineCode> 与{' '}
                <InlineCode>Filter.GroupType</InlineCode> 必选，支持{' '}
                <InlineCode>GroupIds</InlineCode> /{' '}
                <InlineCode>Name</InlineCode> 过滤。
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=ListAssetGroups&Version=2024-01-01`}
                lang='json'
                code='{"Filter":{"GroupIds":["group-20260716105134-zkx8t"],"GroupType":"AIGC"},"MaxResults":10}'
              />
              <CodeBlock
                title='Result'
                lang='json'
                code='{"Items": [{"Id": "group-20260716105134-zkx8t", "Name": "我的素材组", "Description": "可选描述", "GroupType": "AIGC", "ProjectName": "default", "CreateTime": "2026-07-16T03:13:38Z", "UpdateTime": "2026-07-16T03:13:38Z"}]}'
              />
              <Note>
                <InlineCode>NextToken</InlineCode> +{' '}
                <InlineCode>MaxResults</InlineCode> 游标分页与{' '}
                <InlineCode>PageNumber</InlineCode> +{' '}
                <InlineCode>PageSize</InlineCode>{' '}
                页码分页二选一；页码分页响应返回{' '}
                <InlineCode>PageNumber</InlineCode> /{' '}
                <InlineCode>PageSize</InlineCode> /{' '}
                <InlineCode>TotalCount</InlineCode>。支持{' '}
                <InlineCode>SortBy=CreateTime</InlineCode> 与{' '}
                <InlineCode>SortOrder=Desc|Asc</InlineCode>，
                <InlineCode>ProjectName</InlineCode> 默认{' '}
                <InlineCode>default</InlineCode>。
              </Note>
            </>
          ),
        },
        {
          id: 'video-asset-official-list',
          title: 'ListAssets · 列出素材',
          short: 'ListAssets',
          body: (
            <>
              <P>
                列出素材，<InlineCode>Filter</InlineCode> 与{' '}
                <InlineCode>Filter.GroupType</InlineCode> 必选，支持{' '}
                <InlineCode>GroupIds</InlineCode> /{' '}
                <InlineCode>Statuses</InlineCode> /{' '}
                <InlineCode>Name</InlineCode> 过滤。
                <InlineCode>Statuses</InlineCode> 用官方词表{' '}
                <InlineCode>Active</InlineCode> /{' '}
                <InlineCode>Processing</InlineCode> /{' '}
                <InlineCode>Failed</InlineCode>。
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=ListAssets&Version=2024-01-01`}
                lang='json'
                code='{"Filter":{"GroupIds":["group-20260716105134-zkx8t"],"GroupType":"AIGC"},"MaxResults":10}'
              />
              <CodeBlock
                title='Result'
                lang='json'
                code='{"Items": [{"Id": "asset-20260716111338-vwmxj", "Name": "lion01", "AssetType": "Image", "CreateTime": "2026-07-16T03:13:38Z", "UpdateTime": "2026-07-16T03:13:40Z", "ProjectName": "default", "URL": "https://ark-media-asset.tos-cn-beijing.volces.com/xxx", "GroupId": "group-20260716105134-zkx8t", "Status": "Active", "Moderation": {"Strategy": "Default"}}]}'
              />
              <Note>
                <InlineCode>NextToken</InlineCode> +{' '}
                <InlineCode>MaxResults</InlineCode> 游标分页与{' '}
                <InlineCode>PageNumber</InlineCode> +{' '}
                <InlineCode>PageSize</InlineCode>{' '}
                页码分页二选一；页码分页响应返回{' '}
                <InlineCode>PageNumber</InlineCode> /{' '}
                <InlineCode>PageSize</InlineCode> /{' '}
                <InlineCode>TotalCount</InlineCode>。支持{' '}
                <InlineCode>SortBy=CreateTime|GroupId</InlineCode> 与{' '}
                <InlineCode>SortOrder=Desc|Asc</InlineCode>，
                <InlineCode>ProjectName</InlineCode> 默认{' '}
                <InlineCode>default</InlineCode>。
              </Note>
            </>
          ),
        },
        {
          id: 'video-asset-official-get',
          title: 'GetAsset · 查询素材',
          short: 'GetAsset',
          body: (
            <>
              <P>按 Id 查询单个素材的详情与状态。</P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=GetAsset&Version=2024-01-01`}
                lang='json'
                code='{"Id":"asset-20260716111338-vwmxj","ProjectName":"default"}'
              />
              <CodeBlock
                title='Result'
                lang='json'
                code='{"Id": "asset-20260716111338-vwmxj", "Name": "lion01", "AssetType": "Image", "Status": "Active", "URL": "https://ark-media-asset.tos-cn-beijing.volces.com/xxx", "GroupId": "group-20260716105134-zkx8t", "ProjectName": "default", "CreateTime": "2026-07-16T03:13:38Z", "UpdateTime": "2026-07-16T03:13:40Z", "Moderation": {"Strategy": "Default"}}'
              />
              <Note>
                <InlineCode>Status=Failed</InlineCode> 时查看{' '}
                <InlineCode>Error.Code</InlineCode> /{' '}
                <InlineCode>Error.Message</InlineCode>；
                <InlineCode>LastInferenceTime</InlineCode>{' '}
                表示最近提交至视频生成任务的时间，素材未被任务调用时不返回。
              </Note>
            </>
          ),
        },
        {
          id: 'video-asset-official-get-group',
          title: 'GetAssetGroup · 查询素材组',
          short: 'GetAssetGroup',
          body: (
            <>
              <P>按 Id 查询单个素材组的详情。</P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=GetAssetGroup&Version=2024-01-01`}
                lang='json'
                code='{"Id":"group-20260716105134-zkx8t","ProjectName":"default"}'
              />
              <CodeBlock
                title='Result'
                lang='json'
                code='{"Id": "group-20260716105134-zkx8t", "Name": "我的素材组", "Description": "可选描述", "GroupType": "AIGC", "ProjectName": "default", "CreateTime": "2026-07-16T03:13:38Z", "UpdateTime": "2026-07-16T03:13:38Z"}'
              />
            </>
          ),
        },
        {
          id: 'video-asset-official-update',
          title: 'UpdateAsset · 更新素材',
          short: 'UpdateAsset',
          body: (
            <>
              <P>更新素材（官方当前仅支持改名）。</P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=UpdateAsset&Version=2024-01-01`}
                lang='json'
                code='{"Id":"asset-20260716111338-vwmxj","Name":"新素材名","ProjectName":"default"}'
              />
              <CodeBlock
                title='Result'
                lang='json'
                code='{"Id":"asset-20260716111338-vwmxj"}'
              />
            </>
          ),
        },
        {
          id: 'video-asset-official-update-group',
          title: 'UpdateAssetGroup · 更新素材组',
          short: 'UpdateAssetGroup',
          body: (
            <>
              <P>更新素材组名称 / 描述，官方当前仅支持这两个更新字段。</P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=UpdateAssetGroup&Version=2024-01-01`}
                lang='json'
                code='{"Id":"group-20260716105134-zkx8t","Name":"新组名","Description":"新描述","ProjectName":"default"}'
              />
              <CodeBlock
                title='Result'
                lang='json'
                code='{"Id":"group-20260716105134-zkx8t"}'
              />
            </>
          ),
        },
        {
          id: 'video-asset-official-delete',
          title: 'DeleteAsset · 删除素材',
          short: 'DeleteAsset',
          body: (
            <>
              <P>
                删除素材，尽力联动上游一并删除（best-effort）：上游故障不阻断本地删除。
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=DeleteAsset&Version=2024-01-01`}
                lang='json'
                code='{"Id":"asset-20260716111338-vwmxj","ProjectName":"default"}'
              />
              <CodeBlock title='Result' lang='json' code='{}' />
            </>
          ),
        },
        {
          id: 'video-asset-official-delete-group',
          title: 'DeleteAssetGroup · 删除素材组',
          short: 'DeleteAssetGroup',
          body: (
            <>
              <P>
                删除素材组：组内素材先尽力联动上游删除（best-effort），再清理本地登记。
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=DeleteAssetGroup&Version=2024-01-01`}
                lang='json'
                code='{"Id":"group-20260716105134-zkx8t","ProjectName":"default"}'
              />
              <CodeBlock title='Result' lang='json' code='{}' />
              <Note>
                官方定义成功响应为空对象；部分上游可能额外返回{' '}
                <InlineCode>Id</InlineCode>，调用方不应依赖该字段。
              </Note>
            </>
          ),
        },
      ],
    },
  ]
}

function FaqItem(props: { q: string; a: ReactNode }) {
  return (
    <div className='border-border/60 bg-card/40 rounded-xl border px-4 py-3'>
      <p className='mb-1.5 text-sm font-medium'>{props.q}</p>
      <div className='text-muted-foreground space-y-2 text-sm leading-relaxed'>
        {props.a}
      </div>
    </div>
  )
}

function buildFaqSections(siteUrl: string): DocSection[] {
  return [
    {
      id: 'faq-start',
      title: '入门引导',
      body: (
        <>
          <FaqItem
            q='Q1：网页如何体验？'
            a={
              <ol className='list-decimal space-y-1.5 pl-5'>
                <li>
                  浏览器打开 <InlineCode>{siteUrl}</InlineCode>
                </li>
                <li>输入用户名和密码</li>
                <li>
                  点击左侧「新对话」菜单，在右侧页面切换模型（如{' '}
                  <InlineCode>seedance</InlineCode>）
                </li>
                <li>输入提示词</li>
                <li>点击右下角生成</li>
              </ol>
            }
          />
          <FaqItem
            q='Q2：接口如何对接？'
            a={
              <>
                <ol className='list-decimal space-y-1.5 pl-5'>
                  <li>
                    浏览器打开 <InlineCode>{siteUrl}</InlineCode>
                  </li>
                  <li>输入用户名和密码</li>
                  <li>点击左侧「API 密钥」菜单，点击右上角「创建 API 密钥」</li>
                  <li>
                    使用密钥替换示例中的 <InlineCode>sk-你的token</InlineCode>
                  </li>
                </ol>
                <P>
                  各接口的调用方式与示例见上方「语言模型」「图片模型」「视频模型」页签。
                </P>
              </>
            }
          />
        </>
      ),
    },
    {
      id: 'faq-compliance',
      title: '真人与合规',
      body: (
        <>
          <FaqItem
            q='Q3：能通过真人人脸核验吗？'
            a='人脸需要使用素材库核验后才能生成视频：把真人图片上传到素材库，素材通过审核后，生成视频时使用 assetID。生成视频时直接使用真人图片存在合规风险，会造成生成视频失败。'
          />
          <FaqItem
            q='Q4：有高级创作权益包吗？'
            a='有高级创作权益包，支持100万个素材。'
          />
          <FaqItem
            q='Q5：素材上传接口是什么？'
            a={
              <>
                参考{' '}
                <a
                  href={`${siteUrl}/docs#video-asset-official`}
                  className='text-primary hover:underline'
                >
                  素材库 API
                </a>
                。通过素材库创建素材组并上传素材，审核通过后得到素材
                ID，在视频任务中以 asset://&lt;素材ID&gt; 引用。
              </>
            }
          />
        </>
      ),
    },
    {
      id: 'faq-quota',
      title: '限流与配额',
      body: (
        <FaqItem
          q='Q6：网站并发如何？'
          a='接口请求 rpm600（每分钟接口请求数 600）；素材上传 QPM 20（真人虚拟素材库每分钟上传 20 个），和火山方舟一致。如果需要更大的并发需要提前报备并开通指定的 url。'
        />
      ),
    },
    {
      id: 'faq-billing',
      title: '接入与计费',
      body: (
        <>
          <FaqItem q='Q7：平台跟火山是直连吗？' a='是，协议透传。' />
          <FaqItem
            q='Q8：计费按 token 还是按秒？'
            a={
              <>
                按
                token，和官方计价方式一致。同一模型按分辨率和是否带视频输入费用不同，不同模型费用也不同，费用请参考{' '}
                <a
                  href={`${siteUrl}/pricing`}
                  className='text-primary hover:underline'
                >
                  模型广场
                </a>
                。
              </>
            }
          />
          <FaqItem
            q='Q9：平台如何计费？'
            a='提交任务时先预扣一笔费用，任务完成后按官方返回的实际 token 消耗结算，多退少补。'
          />
          <FaqItem q='Q10：失败的任务扣费吗？' a='不扣。失败任务不扣费。' />
        </>
      ),
    },
    {
      id: 'faq-models',
      title: '模型与能力',
      body: (
        <>
          <FaqItem
            q='Q11：支持哪些模型？文本/图像/视频三类能力都通吗？'
            a='文本/图像/视频三类能力全部打通。'
          />
          <FaqItem
            q='Q12：任务详情能回读吗？方便对账吗？'
            a='支持。任务查询接口可回读任务号、状态、进度、结果地址、token 用量等，便于对账。'
          />
        </>
      ),
    },
    {
      id: 'faq-stability',
      title: '稳定性与交付定位',
      body: (
        <FaqItem
          q='Q13：供给稳定性如何？能承载正式交付吗？'
          a='上游资源火山方舟，上游波动时可静默切换渠道，提升系统稳定性。'
        />
      ),
    },
  ]
}

export function getDocSections(tab: DocsTabId, siteUrl: string): DocSection[] {
  if (tab === 'image') return buildImageSections(siteUrl)
  if (tab === 'video') return buildVideoSections(siteUrl)
  if (tab === 'faq') return buildFaqSections(siteUrl)
  return buildLanguageSections(siteUrl)
}
