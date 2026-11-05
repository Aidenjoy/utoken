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
  body: ReactNode
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
  const baseUrl = `${siteUrl}/v1`
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
            （真人虚拟素材上传见「素材库 API」一节）。
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
  "usage": {"completion_tokens": 40594, "total_tokens": 40594}
}`}
          />
          <Note>
            <InlineCode>status</InlineCode> 取值 <InlineCode>queued</InlineCode>{' '}
            / <InlineCode>running</InlineCode> /{' '}
            <InlineCode>succeeded</InlineCode> / <InlineCode>failed</InlineCode>
            ；<InlineCode>succeeded</InlineCode> 时{' '}
            <InlineCode>content.video_url</InlineCode>{' '}
            为视频地址（临时地址，请及时下载保存）。
          </Note>
        </>
      ),
    },
    {
      id: 'video-asset-upload',
      title: '素材库快速对接 · 上传素材',
      body: (
        <>
          <Note>
            「素材库快速对接」用 Bearer 令牌（<InlineCode>sk-...</InlineCode>）
            鉴权、ctaigw 兼容的 <InlineCode>{'{code, message, data}'}</InlineCode>{' '}
            信封，挂载在 <InlineCode>/v1/api/assets</InlineCode>
            ，适合快速集成或作为下级网关的素材中转上游。若要用火山官方 SDK +
            AK/SK V4 签名 1:1 调用，见下文「素材库官方兼容对接（火山方舟 1:1）」。
          </Note>
          <P>
            上传真人虚拟素材后会得到一个素材 ID，在视频任务{' '}
            <InlineCode>content</InlineCode> 中以{' '}
            <InlineCode>asset://&lt;素材ID&gt;</InlineCode> 引用即可。默认上传为
            智能素材：提交视频时系统会自动把它同步到服务该模型的渠道，你无需
            关心素材具体落在哪个渠道。
          </P>
          <CodeBlock
            method='POST'
            url={`${baseUrl}/api/assets/upload`}
            lang='json'
            code={`{
  "url": "https://picsum.photos/id/1074/800/600",
  "asset_type": "Image",
  "name": "test"
}`}
          />
          <CodeBlock
            title='响应内容（data.Id 即素材 ID，视频任务中以 asset://<data.Id> 引用）'
            lang='json'
            code='{"code":0,"message":"ok","data":{"Id":"asset-20260907221226-sm042","Name":"test","Smart":true}}'
          />
          <CodeBlock
            title='curl 示例'
            lang='bash'
            code={`curl -X POST ${baseUrl}/api/assets/upload \\
  -H "Authorization: Bearer sk-你的token" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://picsum.photos/id/1074/800/600",
    "asset_type": "Image",
    "name": "test"
  }'`}
          />
          <Note>
            <InlineCode>asset_type</InlineCode> 取值{' '}
            <InlineCode>Image</InlineCode> / <InlineCode>Video</InlineCode> /{' '}
            <InlineCode>Audio</InlineCode>；<InlineCode>url</InlineCode>{' '}
            必须是公网可访问的 http(s) 地址；<InlineCode>name</InlineCode>{' '}
            可省略，省略时取 url 末段；同一 url 重复上传会复用已有素材。
          </Note>
          <Note>
            智能素材与渠道素材：<InlineCode>channel</InlineCode>{' '}
            选填。不传即智能素材（推荐），渠道无关，提交视频时自动路由并同步到
            服务该模型的任意渠道；传入 <InlineCode>channel</InlineCode>
            （资源分组名，格式为 <InlineCode>qd</InlineCode> 前缀加数字，例如{' '}
            <InlineCode>qd1</InlineCode>
            ）则注册为渠道素材，只在指定渠道上游可用、需自行管理，不会自动同步
            到其他渠道。
          </Note>
          <Note>
            智能素材首次用于某个模型时会现场同步到服务该模型的渠道并送审，审核通常需
            1-2 分钟，此期间提交视频会返回「素材审核中（通常需 1-2
            分钟），请耐心等待审核通过后重试」；待状态转为{' '}
            <InlineCode>Active</InlineCode> 后重试即可成功。
          </Note>
        </>
      ),
    },
    {
      id: 'video-asset-query',
      title: '素材库快速对接 · 查询素材状态',
      body: (
        <>
          <P>
            查询素材上传任务状态，<InlineCode>Active</InlineCode>{' '}
            后才可在视频任务中引用。<InlineCode>{'{asset_id}'}</InlineCode>{' '}
            为上传返回的 <InlineCode>data.Id</InlineCode>。
          </P>
          <CodeBlock
            method='GET'
            url={`${baseUrl}/api/assets/{asset_id}`}
            lang='bash'
            code={`# 将 {asset_id} 替换为上传素材返回的 data.Id
curl -X GET ${baseUrl}/api/assets/{asset_id} \\
  -H "Authorization: Bearer sk-你的token"`}
          />
          <CodeBlock
            title='响应内容'
            lang='json'
            code={`{
  "code": 0,
  "message": "ok",
  "data": {
    "GroupId": "group-20260716105134-zkx8t",
    "Status": "Active",
    "CreateTime": "2026-07-16T03:13:38Z",
    "AssetType": "Image",
    "UpdateTime": "2026-07-16T03:13:40Z",
    "ProjectName": "public-upload",
    "Id": "asset-20260716111338-vwmxj",
    "Name": "lion01",
    "URL": "https://ark-media-asset.tos-cn-beijing.volces.com/xxx"
  }
}`}
          />
          <CodeBlock
            title='响应内容（智能素材：额外返回 Smart 与各渠道同步状态）'
            lang='json'
            code={`{
  "code": 0,
  "message": "ok",
  "data": {
    "Id": "asset-20260907221226-sm042",
    "Name": "test",
    "AssetType": "Image",
    "Status": "Pending",
    "Smart": true,
    "URL": "https://picsum.photos/id/1074/800/600",
    "Channels": [
      {"ChannelId": 13, "AssetId": "asset-20260916162454-hfkl5", "Status": "Pending"}
    ]
  }
}`}
          />
          <Note>
            <InlineCode>Status</InlineCode> 取值{' '}
            <InlineCode>Pending</InlineCode> / <InlineCode>Active</InlineCode> /{' '}
            <InlineCode>Failed</InlineCode>。智能素材额外返回{' '}
            <InlineCode>Smart</InlineCode> 与 <InlineCode>Channels</InlineCode>
            （各渠道副本状态）；顶层 <InlineCode>Status</InlineCode>{' '}
            为汇总：任一渠道 Active 即 Active，尚有 Pending 或还没同步任何渠道为
            Pending，全 Failed 为 Failed。
          </Note>
        </>
      ),
    },
    {
      id: 'video-asset-delete',
      title: '素材库快速对接 · 删除素材',
      body: (
        <>
          <P>
            删除已上传的素材登记。<InlineCode>{'{asset_id}'}</InlineCode>{' '}
            为上传返回的 <InlineCode>data.Id</InlineCode>
            。删除会尽力联动上游一并删除（best-effort）：上游不支持删除接口或临时
            不可用时仅删本地登记、不阻断操作。
          </P>
          <CodeBlock
            method='DELETE'
            url={`${baseUrl}/api/assets/{asset_id}`}
            lang='bash'
            code={`# 将 {asset_id} 替换为上传素材返回的 data.Id
curl -X DELETE ${baseUrl}/api/assets/asset-20260907221226-sm042 \\
  -H "Authorization: Bearer sk-你的token"`}
          />
          <CodeBlock
            title='响应内容'
            lang='json'
            code='{"code":0,"message":"ok","data":{"Id":"asset-20260907221226-sm042","Deleted":true}}'
          />
          <Note>
            删除智能素材会级联删除其各渠道副本记录，并尽力联动各上游渠道删除
            （best-effort）；删除后该素材的{' '}
            <InlineCode>asset://&lt;素材ID&gt;</InlineCode>{' '}
            引用即失效；删除不可恢复，请谨慎操作。
          </Note>
        </>
      ),
    },
    {
      id: 'video-asset-official',
      title: '素材库官方兼容对接（火山方舟 1:1）',
      body: (
        <>
          <P>
            与火山方舟官方素材库 1:1 兼容：下游直接用火山官方 SDK 或
            curl，把 endpoint 指向本站、用在「Key 管理」页生成的 AK/SK 做 V4
            签名，即可原样调用官方 10 个 Action；请求体、响应体、
            <InlineCode>ResponseMetadata</InlineCode>/{' '}
            <InlineCode>Result</InlineCode> 信封与鉴权全部与官方一致。
          </P>
          <Note>
            鉴权与隔离：在「Key 管理」页为令牌生成 Ark AK/SK；签名{' '}
            <InlineCode>service=ark</InlineCode>、<InlineCode>region</InlineCode>{' '}
            任意（如 <InlineCode>cn-beijing</InlineCode>）。列表/查询以本站数据库为准，按
            AK→令牌→用户归属过滤，只能查到自己创建的素材与素材组，天然多租户隔离。
          </Note>
          <Note>
            调用形态：统一{' '}
            <InlineCode>{`POST ${siteUrl}/?Action=<接口名>&Version=2024-01-01`}</InlineCode>，
            <InlineCode>Content-Type: application/json</InlineCode>，AK/SK V4 签名（
            <InlineCode>Authorization: HMAC-SHA256 Credential=...</InlineCode>）。状态词表{' '}
            <InlineCode>Active</InlineCode> / <InlineCode>Processing</InlineCode> /{' '}
            <InlineCode>Failed</InlineCode>；列表用 <InlineCode>NextToken</InlineCode>{' '}
            游标分页（<InlineCode>MaxResults</InlineCode> 默认 20、上限 100）。
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
  -d '{"Filter":{"Statuses":["Active"]},"MaxResults":20}'`}
          />
          <Note>
            V4 签名步骤（用官方 SDK 可自动完成，无需手写）：① 构造规范请求（方法、
            URI、query、参与签名的头、payload 哈希）；② 拼 StringToSign（算法、X-Date、
            scope、规范请求哈希）；③ 用 SK 逐级派生签名密钥（date/region/service）；④
            HMAC-SHA256 得到 Signature 并写入 Authorization 头。X-Date 需在 ±15 分钟内，
            X-Content-Sha256 须等于请求体哈希，否则返回 SignatureDoesNotMatch / RequestExpired。
          </Note>
          <P>
            10 个 Action：CreateAssetGroup（创建素材组）、CreateAsset（创建素材）、
            ListAssetGroups（列出素材组）、ListAssets（列出素材）、GetAsset（查询素材）、
            GetAssetGroup（查询素材组）、UpdateAsset（更新素材）、UpdateAssetGroup（更新素材组）、
            DeleteAsset（删除素材）、DeleteAssetGroup（删除素材组）。以下逐个给出请求体（均以{' '}
            <InlineCode>{`POST ${siteUrl}/?Action=<名>&Version=2024-01-01`}</InlineCode> 调用）：
          </P>
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=CreateAssetGroup&Version=2024-01-01`}
            lang='json'
            code='{"Name":"我的素材组","Description":"可选描述","GroupType":"AIGC","ProjectName":"default"}'
          />
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=CreateAsset&Version=2024-01-01`}
            lang='json'
            code='{"GroupId":"group-20260716105134-zkx8t","URL":"https://picsum.photos/id/1074/800/600","AssetType":"Image","Name":"lion01","ProjectName":"default"}'
          />
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=ListAssetGroups&Version=2024-01-01`}
            lang='json'
            code='{"Filter":{"Name":"素材"},"MaxResults":20,"NextToken":""}'
          />
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=ListAssets&Version=2024-01-01`}
            lang='json'
            code='{"Filter":{"GroupIds":["group-20260716105134-zkx8t"],"Statuses":["Active"]},"MaxResults":20}'
          />
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=GetAsset&Version=2024-01-01`}
            lang='json'
            code='{"Id":"asset-20260716111338-vwmxj"}'
          />
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=GetAssetGroup&Version=2024-01-01`}
            lang='json'
            code='{"Id":"group-20260716105134-zkx8t"}'
          />
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=UpdateAsset&Version=2024-01-01`}
            lang='json'
            code='{"Id":"asset-20260716111338-vwmxj","Name":"新素材名"}'
          />
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=UpdateAssetGroup&Version=2024-01-01`}
            lang='json'
            code='{"Id":"group-20260716105134-zkx8t","Name":"新组名","Description":"新描述"}'
          />
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=DeleteAsset&Version=2024-01-01`}
            lang='json'
            code='{"Id":"asset-20260716111338-vwmxj"}'
          />
          <CodeBlock
            method='POST'
            url={`${siteUrl}/?Action=DeleteAssetGroup&Version=2024-01-01`}
            lang='json'
            code='{"Id":"group-20260716105134-zkx8t"}'
          />
          <CodeBlock
            title='各 Action 的 Result 结构（外层均包在 ResponseMetadata + Result 信封内）'
            lang='json'
            code={`{
  "CreateAssetGroup": {"Id": "group-20260716105134-zkx8t"},
  "CreateAsset":      {"Id": "asset-20260716111338-vwmxj"},
  "ListAssetGroups":  {"Items": [{"Id": "group-20260716105134-zkx8t", "Name": "我的素材组", "Description": "可选描述", "GroupType": "AIGC", "ProjectName": "default", "CreateTime": "2026-07-16T03:13:38Z", "UpdateTime": "2026-07-16T03:13:38Z"}], "NextToken": ""},
  "ListAssets":       {"Items": [{"Id": "asset-20260716111338-vwmxj", "Name": "lion01", "AssetType": "Image", "CreateTime": "2026-07-16T03:13:38Z", "UpdateTime": "2026-07-16T03:13:40Z", "ProjectName": "default", "URL": "https://ark-media-asset.tos-cn-beijing.volces.com/xxx", "GroupId": "group-20260716105134-zkx8t", "Status": "Active", "Moderation": {"Strategy": "Default"}}], "NextToken": ""},
  "GetAsset":         {"Id": "asset-20260716111338-vwmxj", "Name": "lion01", "AssetType": "Image", "Status": "Active", "URL": "https://ark-media-asset.tos-cn-beijing.volces.com/xxx", "GroupId": "group-20260716105134-zkx8t", "ProjectName": "default", "CreateTime": "2026-07-16T03:13:38Z", "UpdateTime": "2026-07-16T03:13:40Z", "Moderation": {"Strategy": "Default"}},
  "GetAssetGroup":    {"Id": "group-20260716105134-zkx8t", "Name": "我的素材组", "Description": "可选描述", "GroupType": "AIGC", "ProjectName": "default", "CreateTime": "2026-07-16T03:13:38Z", "UpdateTime": "2026-07-16T03:13:38Z"},
  "UpdateAsset":      {},
  "UpdateAssetGroup": {},
  "DeleteAsset":      {},
  "DeleteAssetGroup": {}
}`}
          />
          <Note>
            创建素材组会自动选用你分组下优先级最高的启用素材渠道；同一素材组内的
            CreateAsset 锁定到建组时的渠道，保证同一上游账号。删除（DeleteAsset /
            DeleteAssetGroup）会尽力联动上游一并删除（best-effort），上游故障不阻断本地删除。
          </Note>
          <Note>
            限制：官方兼容 API 需上游为 ark_official（或透传了完整管理能力的兼容）渠道，
            relay / ecloud / 360 等协议不支持完整管理接口；并发/QPS 以本站为准。上面 Go SDK
            片段仅为示意，具体实例化方法、输入结构体与字段名以火山官方 volcengine-go-sdk（service/ark）为准。
          </Note>
        </>
      ),
    },
  ]
}

function FaqItem(props: { q: string; a: ReactNode }) {
  return (
    <div className='border-border/60 bg-card/40 rounded-xl border px-4 py-3'>
      <p className='mb-1.5 text-sm font-medium'>{props.q}</p>
      <P>{props.a}</P>
    </div>
  )
}

function buildFaqSections(siteUrl: string): DocSection[] {
  return [
    {
      id: 'faq-compliance',
      title: '真人与合规',
      body: (
        <>
          <FaqItem
            q='Q1：能通过真人人脸核验吗？'
            a='人脸需要使用素材库核验后才能生成视频：把真人图片上传到素材库，素材通过审核后，生成视频时使用 assetID。生成视频时直接使用真人图片存在合规风险，会造成生成视频失败。'
          />
          <FaqItem
            q='Q2：有高级创作权益包吗？'
            a='有高级创作权益包，支持100万个素材。'
          />
          <FaqItem
            q='Q3：素材上传接口是什么？'
            a={
              <>
                参考{' '}
                <a
                  href={`${siteUrl}/docs#video-asset-upload`}
                  className='text-primary hover:underline'
                >
                  素材库 API
                </a>
                。默认直接上传即为智能素材，切换渠道时会自动同步到下一个渠道，无需手动管理；若上传时指定
                channel
                参数，则为特定渠道素材，只在该渠道可用、切换渠道时需自行管理。
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
          q='Q4：网站并发如何？'
          a='接口请求 rpm600（每分钟接口请求数 600）；素材上传 QPM 20（真人虚拟素材库每分钟上传 20 个），和火山方舟一致。如果需要更大的并发需要提前报备并开通指定的 url。'
        />
      ),
    },
    {
      id: 'faq-billing',
      title: '接入与计费',
      body: (
        <>
          <FaqItem q='Q5：平台跟火山是直连吗？' a='是，协议透传。' />
          <FaqItem
            q='Q6：计费按 token 还是按秒？'
            a={
              <>
                按 token，和官方计价方式一致。同一模型按分辨率和是否带视频输入费用不同，不同模型费用也不同，费用请参考{' '}
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
            q='Q7：平台如何计费？'
            a='提交任务时先预扣一笔费用，任务完成后按官方返回的实际 token 消耗结算，多退少补。'
          />
          <FaqItem q='Q8：失败的任务扣费吗？' a='不扣。失败任务不扣费。' />
        </>
      ),
    },
    {
      id: 'faq-models',
      title: '模型与能力',
      body: (
        <>
          <FaqItem
            q='Q9：支持哪些模型？文本/图像/视频三类能力都通吗？'
            a='文本/图像/视频三类能力全部打通。'
          />
          <FaqItem
            q='Q10：任务详情能回读吗？方便对账吗？'
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
          q='Q11：供给稳定性如何？能承载正式交付吗？'
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

function buildGettingStarted(siteUrl: string) {
  return {
    webTest: {
      title: '网页体验',
      steps: [
        <>
          浏览器打开 <InlineCode>{siteUrl}</InlineCode>
        </>,
        '输入用户名和密码',
        <>
          点击左侧「新对话」菜单，在右侧页面切换模型（如{' '}
          <InlineCode>seedance</InlineCode>）
        </>,
        '输入提示词',
        '点击右下角生成',
      ] as ReactNode[],
    },
    apiKey: {
      title: '创建 API Key',
      steps: [
        <>
          浏览器打开 <InlineCode>{siteUrl}</InlineCode>
        </>,
        '输入用户名和密码',
        '点击左侧「API 密钥」菜单，点击右上角「创建 API 密钥」',
        <>
          使用密钥替换示例中的 <InlineCode>sk-你的token</InlineCode>
        </>,
      ] as ReactNode[],
    },
  }
}

export function getGettingStarted(siteUrl: string) {
  return buildGettingStarted(siteUrl)
}
