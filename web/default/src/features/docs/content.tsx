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

export type DocsTabId = 'language' | 'image' | 'video'

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

const VIDEO_MODEL = 'ty-doubao-seedance-2-0'

function buildLanguageSections(siteUrl: string): DocSection[] {
  const baseUrl = `${siteUrl}/v1`
  return [
  {
    id: 'lang-chat',
    title: '对话补全',
    body: (
      <>
        <P>
          兼容 OpenAI Chat Completions 协议，将{' '}
          <InlineCode>model</InlineCode> 替换为模型广场中的语言模型 ID
          即可调用。
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
  "size": "2K",
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
    "size": "2K",
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
          <InlineCode>false</InlineCode> 可去除图片右下角的「AI
          生成」水印；<InlineCode>size</InlineCode>{' '}
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
  "size": "2K",
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
    "size": "2K",
    "watermark": false
  }'`}
        />
        <Note>
          输入图片需为可公开访问的 URL 或 base64 内联数据；响应结构与文生图一致。
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
  "size": "2K",
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
    "size": "2K",
    "watermark": false
  }'`}
        />
        <Note>
          参考图需为可公开访问的 URL 或 base64 内联数据；响应结构与文生图一致。
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
          参考图片支持两种写法：直接 URL 或素材库{' '}
          <InlineCode>asset://&lt;素材ID&gt;</InlineCode>
          （真人虚拟素材上传见「素材库 API」一节）。
        </P>
        <CodeBlock
          method='POST'
          url={tasksUrl}
          lang='json'
          code={`{
  "model": "${VIDEO_MODEL}",
  "content": [
    {"type": "text", "text": "根据参考图片生成新视频"},
    {"type": "image_url", "image_url": {"url": "https://example.com/reference1.jpg"}, "role": "reference_image"},
    {"type": "image_url", "image_url": {"url": "asset://asset-20260716111338-vwmxj"}, "role": "reference_image"}
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
      {"type": "text", "text": "根据参考图片生成新视频"},
      {"type": "image_url", "image_url": {"url": "https://example.com/reference1.jpg"}, "role": "reference_image"},
      {"type": "image_url", "image_url": {"url": "asset://asset-20260716111338-vwmxj"}, "role": "reference_image"}
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
          <InlineCode>status</InlineCode> 取值{' '}
          <InlineCode>queued</InlineCode> / <InlineCode>running</InlineCode> /{' '}
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
    title: '素材库 API · 上传素材',
    body: (
      <>
        <P>
          先上传真人虚拟素材，再在视频任务 <InlineCode>content</InlineCode>{' '}
          中以 <InlineCode>asset://&lt;素材ID&gt;</InlineCode> 引用。
        </P>
        <CodeBlock
          method='POST'
          url={`${baseUrl}/api/assets/upload`}
          lang='json'
          code={`{
  "url": "https://picsum.photos/id/1074/800/600",
  "asset_type": "Image",
  "name": "test",
  "channel": "ty"
}`}
        />
        <CodeBlock
          title='响应内容'
          lang='json'
          code='{"code":0,"message":"ok","data":{"Id":"asset-20260716111338-vwmxj"}}'
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
    "name": "test",
    "channel": "ty"
  }'`}
        />
        <Note>
          <InlineCode>asset_type</InlineCode> 取值{' '}
          <InlineCode>Image</InlineCode> / <InlineCode>Video</InlineCode> /{' '}
          <InlineCode>Audio</InlineCode>；<InlineCode>channel</InlineCode>{' '}
          为资源分组名称（用模型前缀，例如 <InlineCode>ty</InlineCode>
          ），指定素材注册到哪个渠道，素材只在注册它的渠道上游可用；只有一个素材渠道时可省略，
          多个素材渠道时省略会报错，必须显式指定。
        </Note>
      </>
    ),
  },
  {
    id: 'video-asset-query',
    title: '素材库 API · 查询素材状态',
    body: (
      <>
        <P>
          查询素材上传任务状态，<InlineCode>Active</InlineCode>{' '}
          后才可在视频任务中引用。
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
        <Note>
          <InlineCode>Status</InlineCode> 取值{' '}
          <InlineCode>Pending</InlineCode> / <InlineCode>Active</InlineCode> /{' '}
          <InlineCode>Failed</InlineCode>。
        </Note>
      </>
    ),
  },
]
}

export function getDocSections(
  tab: DocsTabId,
  siteUrl: string
): DocSection[] {
  if (tab === 'image') return buildImageSections(siteUrl)
  if (tab === 'video') return buildVideoSections(siteUrl)
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
