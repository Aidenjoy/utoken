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
import { DocText, Note, P } from './doc-typography'

export type DocsTabId = 'language' | 'image' | 'video' | 'faq'

/** 文档文案翻译函数：键为英文源串，行内代码以反引号标记 */
export type DocsTranslate = (
  key: string,
  options?: Record<string, unknown>
) => string

export interface DocSection {
  id: string
  title: string
  body: ReactNode
  /** 二级菜单子章节：正文渲染为父章节内的子块 */
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

function buildLanguageSections(siteUrl: string, t: DocsTranslate): DocSection[] {
  const baseUrl = `${siteUrl}/v1`
  return [
    {
      id: 'lang-chat',
      title: t('Chat Completions'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Compatible with the OpenAI Chat Completions protocol: replace `model` with a language model ID from the Model Square and call directly.'
              )}
            />
          </P>
          <CodeBlock
            method='POST'
            url={`${baseUrl}/chat/completions`}
            lang='json'
            code={`{
  "model": "kimi-k3",
  "messages": [
    {"role": "system", "content": "${t('You are a helpful assistant')}"},
    {"role": "user", "content": "${t('What model are you?')}"}
  ],
  "stream": false
}`}
          />
          <CodeBlock
            title={t('curl example')}
            lang='bash'
            code={`curl -X POST ${baseUrl}/chat/completions \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "kimi-k3",
    "messages": [
      {"role": "system", "content": "${t('You are a helpful assistant')}"},
      {"role": "user", "content": "${t('What model are you?')}"}
    ],
    "stream": false
  }'`}
          />
          <CodeBlock
            title={t('Response example')}
            lang='json'
            code={`{
  "id": "chatcmpl-a1b2c3",
  "object": "chat.completion",
  "created": 1767225600,
  "model": "kimi-k3",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "${t('I am an AI assistant built by……')}"},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 24, "completion_tokens": 38, "total_tokens": 62}
}`}
          />
          <Note>
            <DocText
              text={t(
                'Model IDs in examples are for demonstration only; copy an actually available language model ID from the Model Square. For streaming output set `stream` to `true`: the response is returned chunk by chunk via SSE (Server-Sent Events) and ends with `data: [DONE]`.'
              )}
            />
          </Note>
        </>
      ),
    },
    {
      id: 'lang-models',
      title: t('List Models'),
      body: (
        <>
          <P>{t('Lists all model IDs available under the current account group.')}</P>
          <CodeBlock
            method='GET'
            url={`${baseUrl}/models`}
            lang='bash'
            code={`curl -X GET ${baseUrl}/models \\
  -H "Authorization: Bearer ${t('sk-your-token')}"`}
          />
          <CodeBlock
            title={t('Response example')}
            lang='json'
            code={`{
  "object": "list",
  "data": [
    {"id": "kimi-k3", "object": "model", "created": 1767225600, "owned_by": "system"}
  ]
}`}
          />
        </>
      ),
    },
  ]
}

const IMAGE_MODEL = 'doubao-seedream-5-0'

function buildImageSections(siteUrl: string, t: DocsTranslate): DocSection[] {
  const baseUrl = `${siteUrl}/v1`
  return [
    {
      id: 'image-generations',
      title: t('Text-to-Image'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Compatible with the OpenAI Images protocol; generates images from prompts. The model ID in examples is for demonstration only; copy an actual image model ID from the Model Square.'
              )}
            />
          </P>
          <CodeBlock
            method='POST'
            url={`${baseUrl}/images/generations`}
            lang='json'
            code={`{
  "model": "${IMAGE_MODEL}",
  "prompt": "${t('An orange cat running on a sunlit grassland, high-definition photography style')}",
  "size": "2048x2048",
  "watermark": false
}`}
          />
          <CodeBlock
            title={t('curl example')}
            lang='bash'
            code={`curl -X POST ${baseUrl}/images/generations \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${IMAGE_MODEL}",
    "prompt": "${t('An orange cat running on a sunlit grassland, high-definition photography style')}",
    "size": "2048x2048",
    "watermark": false
  }'`}
          />
          <CodeBlock
            title={t('Response example')}
            lang='json'
            code={`{
  "created": 1767225600,
  "data": [
    {"url": "https://example.com/generated-image.png"}
  ]
}`}
          />
          <Note>
            <DocText
              text={t(
                'Set `watermark` to `false` to remove the "AI-generated" watermark at the bottom-right of the image; available values for parameters such as `size` vary by model — refer to the corresponding model description in the Model Square; generated image URLs are temporary, please download and save them promptly.'
              )}
            />
          </Note>
        </>
      ),
    },
    {
      id: 'image-to-image',
      title: t('Image-to-Image'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Same endpoint as text-to-image: pass one input image via `image` and generate a new image based on it according to the prompt; the value supports publicly accessible URLs or base64 (`data:image/png;base64,...`).'
              )}
            />
          </P>
          <CodeBlock
            method='POST'
            url={`${baseUrl}/images/generations`}
            lang='json'
            code={`{
  "model": "${IMAGE_MODEL}",
  "prompt": "${t('Convert the photo to watercolor style, keeping the composition unchanged')}",
  "image": "https://example.com/photo.jpg",
  "size": "2048x2048",
  "watermark": false
}`}
          />
          <CodeBlock
            title={t('curl example')}
            lang='bash'
            code={`curl -X POST ${baseUrl}/images/generations \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${IMAGE_MODEL}",
    "prompt": "${t('Convert the photo to watercolor style, keeping the composition unchanged')}",
    "image": "https://example.com/photo.jpg",
    "size": "2048x2048",
    "watermark": false
  }'`}
          />
          <CodeBlock
            title={t('Response example')}
            lang='json'
            code={`{
  "created": 1767225600,
  "data": [
    {"url": "https://example.com/generated-image.png"}
  ]
}`}
          />
          <Note>
            <DocText
              text={t(
                'The input image must be a publicly accessible URL or base64 inline data.'
              )}
            />
          </Note>
        </>
      ),
    },
    {
      id: 'image-edits',
      title: t('Image Editing (Reference-based)'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Same endpoint as text-to-image: pass multiple reference images via `image` (array); the model combines the content of all images and generates according to the prompt, e.g. character outfit change or style fusion.'
              )}
            />
          </P>
          <CodeBlock
            method='POST'
            url={`${baseUrl}/images/generations`}
            lang='json'
            code={`{
  "model": "${IMAGE_MODEL}",
  "prompt": "${t('Dress the person in the first image in the outfit from the second image, keeping the pose unchanged')}",
  "image": [
    "https://example.com/person.jpg",
    "https://example.com/outfit.jpg"
  ],
  "size": "2048x2048",
  "watermark": false
}`}
          />
          <CodeBlock
            title={t('curl example')}
            lang='bash'
            code={`curl -X POST ${baseUrl}/images/generations \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${IMAGE_MODEL}",
    "prompt": "${t('Dress the person in the first image in the outfit from the second image, keeping the pose unchanged')}",
    "image": [
      "https://example.com/person.jpg",
      "https://example.com/outfit.jpg"
    ],
    "size": "2048x2048",
    "watermark": false
  }'`}
          />
          <CodeBlock
            title={t('Response example')}
            lang='json'
            code={`{
  "created": 1767225600,
  "data": [
    {"url": "https://example.com/generated-image.png"}
  ]
}`}
          />
          <Note>
            <DocText
              text={t(
                'Reference images must be publicly accessible URLs or base64 inline data.'
              )}
            />
          </Note>
        </>
      ),
    },
  ]
}

const videoSubmitResponse = `{
  "id": "cgt-20260826120000-abc12"
}`

function buildVideoSections(siteUrl: string, t: DocsTranslate): DocSection[] {
  const tasksUrl = `${siteUrl}/api/v3/contents/generations/tasks`
  return [
    {
      id: 'video-create',
      title: t('Create Video Generation Task'),
      body: (
        <P>
          <DocText
            text={t(
              'Three creation modes are supported: reference-based generation, text-to-video, and first & last frame; a successful submission returns a task ID for later status queries and task cancellation or deletion.'
            )}
          />
        </P>
      ),
      children: [
        {
          id: 'video-reference',
          title: t('Reference-based Generation'),
          body: (
            <>
              <P>
                <DocText
                  text={t(
                    'Reference-based generation freely combines text + reference images (0-9) + reference videos (0-3) + reference audio (0-3); trim the example fields as needed. Audio cannot be referenced alone — pair it with at least one image or one video. Reference images support two forms: a direct URL, or an asset library reference `asset://<AssetID>` (see the Asset Library section for uploading real-person virtual assets).'
                  )}
                />
              </P>
              <CodeBlock
                method='POST'
                url={tasksUrl}
                lang='json'
                code={`{
  "model": "${VIDEO_MODEL}",
  "content": [
    {"type": "text", "text": "${t('Combine the person and scene from the reference images, follow the camera movement of the reference video, and use the reference audio as the background music rhythm')}"},
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
                title={t('curl example')}
                lang='bash'
                code={`curl -X POST ${tasksUrl} \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${VIDEO_MODEL}",
    "content": [
      {"type": "text", "text": "${t('Combine the person and scene from the reference images, follow the camera movement of the reference video, and use the reference audio as the background music rhythm')}"},
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
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={videoSubmitResponse}
              />
              <Note>
                <DocText
                  text={t(
                    'The `id` in the response example is the task ID, used for later status queries and task cancellation or deletion.'
                  )}
                />
              </Note>
              <Note>
                <DocText
                  text={t(
                    'When a reference video is included, the request is treated as a video editing task: the output ratio follows the input video and `ratio` is not required; `duration` set to -1 means the output duration follows the input video.'
                  )}
                />
              </Note>
            </>
          ),
        },
        {
          id: 'video-text',
          title: t('Text-to-Video'),
          body: (
            <>
              <P>{t('Generates a video from a text prompt only.')}</P>
              <CodeBlock
                method='POST'
                url={tasksUrl}
                lang='json'
                code={`{
  "model": "${VIDEO_MODEL}",
  "content": [
    {"type": "text", "text": "${t('An orange cat running on a sunlit grassland, bright and sunny')}"}
  ],
  "resolution": "480p",
  "ratio": "16:9",
  "duration": 4,
  "generate_audio": true
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl -X POST ${tasksUrl} \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${VIDEO_MODEL}",
    "content": [
      {"type": "text", "text": "${t('An orange cat running on a sunlit grassland, bright and sunny')}"}
    ],
    "resolution": "480p",
    "ratio": "16:9",
    "duration": 4,
    "generate_audio": true
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={videoSubmitResponse}
              />
              <Note>
                <DocText
                  text={t(
                    'The `id` in the response example is the task ID, used for later status queries and task cancellation or deletion.'
                  )}
                />
              </Note>
            </>
          ),
        },
        {
          id: 'video-frames',
          title: t('First & Last Frame'),
          body: (
            <>
              <P>
                <DocText
                  text={t(
                    'Specify the first and last frame of the video via `first_frame` and `last_frame`; the model generates the transitional content in between.'
                  )}
                />
              </P>
              <CodeBlock
                method='POST'
                url={tasksUrl}
                lang='json'
                code={`{
  "model": "${VIDEO_MODEL}",
  "content": [
    {"type": "text", "text": "${t('A city skyline transitioning from day to night')}"},
    {"type": "image_url", "image_url": {"url": "https://example.com/first-frame.jpg"}, "role": "first_frame"},
    {"type": "image_url", "image_url": {"url": "https://example.com/last-frame.jpg"}, "role": "last_frame"}
  ],
  "resolution": "480p",
  "ratio": "16:9",
  "duration": 4
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl -X POST ${tasksUrl} \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${VIDEO_MODEL}",
    "content": [
      {"type": "text", "text": "${t('A city skyline transitioning from day to night')}"},
      {"type": "image_url", "image_url": {"url": "https://example.com/first-frame.jpg"}, "role": "first_frame"},
      {"type": "image_url", "image_url": {"url": "https://example.com/last-frame.jpg"}, "role": "last_frame"}
    ],
    "resolution": "480p",
    "ratio": "16:9",
    "duration": 4
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={videoSubmitResponse}
              />
              <Note>
                <DocText
                  text={t(
                    'The `id` in the response example is the task ID, used for later status queries and task cancellation or deletion.'
                  )}
                />
              </Note>
            </>
          ),
        },
      ],
    },
    {
      id: 'video-query',
      title: t('Query Video Generation Task'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Video generation is asynchronous: poll this endpoint after submission until `status` becomes `succeeded`.'
              )}
            />
          </P>
          <CodeBlock
            method='GET'
            url={`${tasksUrl}/{task_id}`}
            lang='bash'
            code={`# ${t('Replace {task_id} with the id returned by the task submission')}
curl -X GET ${tasksUrl}/{task_id} \\
  -H "Authorization: Bearer ${t('sk-your-token')}"`}
          />
          <CodeBlock
            title={t('Response example')}
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
            <DocText
              text={t(
                '`status` values: `queued` / `running` / `cancelled` / `succeeded` / `failed` / `expired`; on `succeeded`, `content.video_url` is the video address, valid for 24 hours — download or transfer it promptly.'
              )}
            />
          </Note>
          <Note>
            <DocText
              text={t(
                'On `failed`, the failure reason is returned via `error.code` / `error.message`; if `return_last_frame=true` was set at creation, the success response also includes `content.last_frame_url`.'
              )}
            />
          </Note>
        </>
      ),
    },
    {
      id: 'video-asset-official',
      title: t('Asset Library'),
      body: (
        <>
          <Note>
            <DocText
              text={t(
                'Auth & isolation: generate Ark AK/SK for the token on the Key Management page. List/query requests are served from this site\'s database, filtered by AK → token → user ownership, so you can only see assets and asset groups you created.'
              )}
            />
          </Note>
          <CodeBlock
            title={t('Success response')}
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
            title={t('Error response (no Result)')}
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
        </>
      ),
      children: [
        {
          id: 'video-asset-official-create-group',
          title: t('Create Asset Group'),
          body: (
            <>
              <P>
                <DocText
                  text={t(
                    'Creates an asset group. `GroupType` can be omitted (currently only `AIGC` is supported); `ProjectName` defaults to `default`.'
                  )}
                />
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=CreateAssetGroup&Version=2024-01-01`}
                lang='json'
                code={`{
  "Name": "demo-portrait-group",
  "Description": "${t('Demo virtual portrait asset group')}",
  "GroupType": "AIGC",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=CreateAssetGroup&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "Name": "demo-portrait-group",
    "Description": "${t('Demo virtual portrait asset group')}",
    "GroupType": "AIGC",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "20240514212750B2C3D4E5F6789ABCDE",
    "Action": "CreateAssetGroup",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Id": "group-20240514212750-b5e9m"
  }
}`}
              />
              <Note>
                <DocText
                  text={t(
                    'Creating an asset group uses the enabled asset channel bound to the current Key; without a bound channel, group creation fails. CreateAsset within the same group is locked to the channel used at group creation, ensuring the same upstream account.'
                  )}
                />
              </Note>
            </>
          ),
        },
        {
          id: 'video-asset-official-create',
          title: t('Create Asset'),
          body: (
            <>
              <P>
                <DocText
                  text={t(
                    'Creates an asset in the specified group. `URL` must be a publicly accessible http(s) address (fetched by upstream, not a file stream); `AssetType` values: `Image` / `Video` / `Audio`; `Name` can be omitted.'
                  )}
                />
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=CreateAsset&Version=2024-01-01`}
                lang='json'
                code={`{
  "GroupId": "group-20240514212750-b5e9m",
  "URL": "${siteUrl}/asset-20240514212750-a3f8k.jpg",
  "Name": "demo-portrait-image",
  "AssetType": "Image",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=CreateAsset&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "GroupId": "group-20240514212750-b5e9m",
    "URL": "${siteUrl}/asset-20240514212750-a3f8k.jpg",
    "Name": "demo-portrait-image",
    "AssetType": "Image",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "20240514212750A1B2C3D4E5F67890",
    "Action": "CreateAsset",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Id": "asset-20240514212750-a3f8k"
  }
}`}
              />
            </>
          ),
        },
        {
          id: 'video-asset-official-list-groups',
          title: t('List Asset Groups'),
          body: (
            <>
              <P>
                <DocText
                  text={t(
                    'Lists asset groups. `Filter` and `Filter.GroupType` are required; `GroupIds` / `Name` filters are supported.'
                  )}
                />
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=ListAssetGroups&Version=2024-01-01`}
                lang='json'
                code={`{
  "Filter": {
    "GroupIds": [
      "group-20240514212750-b5e9m",
      "group-20240514212810-c7n2p"
    ],
    "GroupType": "AIGC"
  },
  "MaxResults": 1,
  "SortBy": "CreateTime",
  "SortOrder": "Desc",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=ListAssetGroups&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "Filter": {
      "GroupIds": [
        "group-20240514212750-b5e9m",
        "group-20240514212810-c7n2p"
      ],
      "GroupType": "AIGC"
    },
    "MaxResults": 1,
    "SortBy": "CreateTime",
    "SortOrder": "Desc",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "202405142130002B3C4D5E6F70819203",
    "Action": "ListAssetGroups",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Items": [
      {
        "Id": "group-20240514212750-b5e9m",
        "Name": "demo-portrait-group",
        "Description": "${t('Demo virtual portrait asset group')}",
        "GroupType": "AIGC",
        "ProjectName": "default",
        "CreateTime": "2024-05-14T21:27:50Z",
        "UpdateTime": "2024-05-14T21:30:00Z"
      }
    ],
    "NextToken": "****bmNyeXB0ZWRfY3Vyc29yIjoiLi4****"
  }
}`}
              />
              <Note>
                <DocText
                  text={t(
                    'Cursor pagination via `NextToken` + `MaxResults` and page pagination via `PageNumber` + `PageSize` are mutually exclusive; page pagination responses return `PageNumber` / `PageSize` / `TotalCount`. Supports `SortBy=CreateTime` and `SortOrder=Desc|Asc`; `ProjectName` defaults to `default`.'
                  )}
                />
              </Note>
            </>
          ),
        },
        {
          id: 'video-asset-official-list',
          title: t('List Assets'),
          body: (
            <>
              <P>
                <DocText
                  text={t(
                    'Lists assets. `Filter` and `Filter.GroupType` are required; `GroupIds` / `Statuses` / `Name` filters are supported. `Statuses` uses the official vocabulary `Active` / `Processing` / `Failed`.'
                  )}
                />
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=ListAssets&Version=2024-01-01`}
                lang='json'
                code={`{
  "Filter": {
    "GroupIds": ["group-20240514212750-b5e9m"],
    "GroupType": "AIGC",
    "Statuses": ["Active"]
  },
  "MaxResults": 1,
  "SortBy": "CreateTime",
  "SortOrder": "Desc",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=ListAssets&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "Filter": {
      "GroupIds": ["group-20240514212750-b5e9m"],
      "GroupType": "AIGC",
      "Statuses": ["Active"]
    },
    "MaxResults": 1,
    "SortBy": "CreateTime",
    "SortOrder": "Desc",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "202405142130001A2B3C4D5E6F708192",
    "Action": "ListAssets",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Items": [
      {
        "Id": "asset-20240514212750-a3f8k",
        "Name": "demo-portrait-image",
        "URL": "${siteUrl}/asset-20240514212750-a3f8k.jpg?X-Amz-Expires=43200",
        "GroupId": "group-20240514212750-b5e9m",
        "AssetType": "Image",
        "Status": "Active",
        "Moderation": {
          "Strategy": "Default"
        },
        "Error": {
          "Code": "",
          "Message": ""
        },
        "ProjectName": "default",
        "CreateTime": "2024-05-14T21:27:50Z",
        "UpdateTime": "2024-05-14T21:30:00Z",
        "LastInferenceTime": "2024-05-14T22:15:30Z"
      }
    ],
    "NextToken": "****bmNyeXB0ZWRfY3Vyc29yIjoiLi4****"
  }
}`}
              />
              <Note>
                <DocText
                  text={t(
                    'Cursor pagination via `NextToken` + `MaxResults` and page pagination via `PageNumber` + `PageSize` are mutually exclusive; page pagination responses return `PageNumber` / `PageSize` / `TotalCount`. Supports `SortBy=CreateTime|GroupId` and `SortOrder=Desc|Asc`; `ProjectName` defaults to `default`.'
                  )}
                />
              </Note>
            </>
          ),
        },
        {
          id: 'video-asset-official-get',
          title: t('Get Asset'),
          body: (
            <>
              <P>{t('Queries the details and status of a single asset by Id.')}</P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=GetAsset&Version=2024-01-01`}
                lang='json'
                code={`{
  "Id": "asset-20240514212750-a3f8k",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=GetAsset&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "Id": "asset-20240514212750-a3f8k",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "20240514213000E5F6789ABCDEF01234",
    "Action": "GetAsset",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Id": "asset-20240514212750-a3f8k",
    "Name": "demo-portrait-image",
    "URL": "${siteUrl}/asset-20240514212750-a3f8k.jpg?X-Amz-Expires=43200",
    "AssetType": "Image",
    "GroupId": "group-20240514212750-b5e9m",
    "Status": "Active",
    "Moderation": {
      "Strategy": "Default"
    },
    "Error": {
      "Code": "",
      "Message": ""
    },
    "CreateTime": "2024-05-14T21:27:50Z",
    "UpdateTime": "2024-05-14T21:30:00Z",
    "LastInferenceTime": "2024-05-14T22:15:30Z",
    "ProjectName": "default"
  }
}`}
              />
              <Note>
                <DocText
                  text={t(
                    'When `Status=Failed`, check `Error.Code` / `Error.Message`; `LastInferenceTime` is the last time the asset was submitted to a video generation task, and is omitted when the asset has never been used by a task.'
                  )}
                />
              </Note>
            </>
          ),
        },
        {
          id: 'video-asset-official-get-group',
          title: t('Get Asset Group'),
          body: (
            <>
              <P>{t('Queries the details of a single asset group by Id.')}</P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=GetAssetGroup&Version=2024-01-01`}
                lang='json'
                code={`{
  "Id": "group-20240514212750-b5e9m",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=GetAssetGroup&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "Id": "group-20240514212750-b5e9m",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "20240514213000F6789ABCDEF0123456",
    "Action": "GetAssetGroup",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Id": "group-20240514212750-b5e9m",
    "Name": "demo-portrait-group",
    "Description": "${t('Demo virtual portrait asset group')}",
    "GroupType": "AIGC",
    "ProjectName": "default",
    "CreateTime": "2024-05-14T21:27:50Z",
    "UpdateTime": "2024-05-14T21:30:00Z"
  }
}`}
              />
            </>
          ),
        },
        {
          id: 'video-asset-official-update-group',
          title: t('Update Asset Group'),
          body: (
            <>
              <P>
                {t(
                  'Updates the name / description of an asset group — the only two update fields currently supported officially.'
                )}
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=UpdateAssetGroup&Version=2024-01-01`}
                lang='json'
                code={`{
  "Id": "group-20240514212750-b5e9m",
  "Name": "demo-portrait-group-renamed",
  "Description": "${t('Updated demo virtual portrait asset group description')}",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=UpdateAssetGroup&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "Id": "group-20240514212750-b5e9m",
    "Name": "demo-portrait-group-renamed",
    "Description": "${t('Updated demo virtual portrait asset group description')}",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "202405142130004D5E6F708192031A2B",
    "Action": "UpdateAssetGroup",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Id": "group-20240514212750-b5e9m"
  }
}`}
              />
            </>
          ),
        },
        {
          id: 'video-asset-official-update',
          title: t('Update Asset'),
          body: (
            <>
              <P>{t('Updates an asset (officially only renaming is supported).')}</P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=UpdateAsset&Version=2024-01-01`}
                lang='json'
                code={`{
  "Id": "asset-20240514212750-a3f8k",
  "Name": "demo-portrait-image-renamed",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=UpdateAsset&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "Id": "asset-20240514212750-a3f8k",
    "Name": "demo-portrait-image-renamed",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "202405142130003C4D5E6F708192031A",
    "Action": "UpdateAsset",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {
    "Id": "asset-20240514212750-a3f8k"
  }
}`}
              />
            </>
          ),
        },
        {
          id: 'video-asset-official-delete',
          title: t('Delete Asset'),
          body: (
            <>
              <P>
                {t(
                  'Deletes an asset, with best-effort upstream deletion: upstream failures do not block local deletion.'
                )}
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=DeleteAsset&Version=2024-01-01`}
                lang='json'
                code={`{
  "Id": "asset-20240514212750-a3f8k",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=DeleteAsset&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "Id": "asset-20240514212750-a3f8k",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "20240514213000C3D4E5F6789ABCDEF0",
    "Action": "DeleteAsset",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {}
}`}
              />
            </>
          ),
        },
        {
          id: 'video-asset-official-delete-group',
          title: t('Delete Asset Group'),
          body: (
            <>
              <P>
                {t(
                  'Deletes an asset group: assets in the group are first deleted upstream on a best-effort basis, then local registrations are cleaned up.'
                )}
              </P>
              <CodeBlock
                method='POST'
                url={`${siteUrl}/?Action=DeleteAssetGroup&Version=2024-01-01`}
                lang='json'
                code={`{
  "Id": "group-20240514212750-b5e9m",
  "ProjectName": "default"
}`}
              />
              <CodeBlock
                title={t('curl example')}
                lang='bash'
                code={`curl '${siteUrl}/?Action=DeleteAssetGroup&Version=2024-01-01' \\
  -H 'Content-Type: application/json' \\
  -H 'X-Date: <X-Date>' \\
  -H 'X-Content-Sha256: <X-Content-Sha256>' \\
  -H 'Authorization: HMAC-SHA256 Credential=<AK>/<X-Date>/cn-beijing/ark/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=<Signature>' \\
  -d '{
    "Id": "group-20240514212750-b5e9m",
    "ProjectName": "default"
  }'`}
              />
              <CodeBlock
                title={t('Response example')}
                lang='json'
                code={`{
  "ResponseMetadata": {
    "RequestId": "20240514213000D4E5F6789ABCDEF012",
    "Action": "DeleteAssetGroup",
    "Version": "2024-01-01",
    "Service": "ark",
    "Region": "cn-beijing"
  },
  "Result": {}
}`}
              />
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

function buildFaqSections(siteUrl: string, t: DocsTranslate): DocSection[] {
  return [
    {
      id: 'faq-start',
      title: t('Getting Started'),
      body: (
        <>
          <FaqItem
            q={t('Q1: How to try it on the web?')}
            a={
              <ol className='list-decimal space-y-1.5 pl-5'>
                <li>
                  <DocText
                    text={t('Open `{{url}}` in a browser', { url: siteUrl })}
                  />
                </li>
                <li>{t('Enter your username and password')}</li>
                <li>
                  <DocText
                    text={t(
                      'Click the New Conversation menu on the left and switch models (e.g. `seedance`) on the right'
                    )}
                  />
                </li>
                <li>{t('Enter a prompt')}</li>
                <li>{t('Click Generate at the bottom right')}</li>
              </ol>
            }
          />
          <FaqItem
            q={t('Q2: How to integrate via API?')}
            a={
              <>
                <ol className='list-decimal space-y-1.5 pl-5'>
                  <li>
                    <DocText
                      text={t('Open `{{url}}` in a browser', { url: siteUrl })}
                    />
                  </li>
                  <li>{t('Enter your username and password')}</li>
                  <li>
                    {t(
                      'Click the API Keys menu on the left, then Create API Key at the top right'
                    )}
                  </li>
                  <li>
                    <DocText
                      text={t(
                        'Replace `sk-your-token` in the examples with your key'
                      )}
                    />
                  </li>
                </ol>
                <P>
                  {t(
                    'See the Language Models, Image Models, and Video Models tabs above for calling conventions and examples of each endpoint.'
                  )}
                </P>
              </>
            }
          />
        </>
      ),
    },
    {
      id: 'faq-compliance',
      title: t('Real Persons & Compliance'),
      body: (
        <>
          <FaqItem
            q={t('Q3: Can real-person face verification be passed?')}
            a={t(
              'Faces must be verified via the asset library before video generation: upload the real-person image to the asset library, and after the asset passes review, use its asset ID for video generation. Using real-person images directly for video generation carries compliance risks and will cause generation failures.'
            )}
          />
          <FaqItem
            q={t('Q4: Is there an advanced creation entitlement package?')}
            a={t('Yes, the advanced creation entitlement package supports 1 million assets.')}
          />
          <FaqItem
            q={t('Q5: What is the asset upload endpoint?')}
            a={
              <>
                {t('Refer to the')}{' '}
                <a
                  href={`${siteUrl}/docs#video-asset-official`}
                  className='text-primary hover:underline'
                >
                  {t('Asset Library API')}
                </a>
                <DocText
                  text={t(
                    '. Create an asset group and upload assets via the asset library; after review passes you get an asset ID, referenced as `asset://<AssetID>` in video tasks.'
                  )}
                />
              </>
            }
          />
        </>
      ),
    },
    {
      id: 'faq-quota',
      title: t('Rate Limits & Quota'),
      body: (
        <FaqItem
          q={t('Q6: What is the site concurrency?')}
          a={t(
            'API requests rpm600 (600 API requests per minute); asset upload QPM 20 (20 uploads per minute for the real-person virtual asset library), consistent with Volcano Ark. Higher concurrency requires advance registration and enabling of designated URLs.'
          )}
        />
      ),
    },
    {
      id: 'faq-billing',
      title: t('Integration & Billing'),
      body: (
        <>
          <FaqItem
            q={t('Q7: Is the platform directly connected to Volcano?')}
            a={t('Yes, protocol passthrough.')}
          />
          <FaqItem
            q={t('Q8: Is billing per token or per second?')}
            a={
              <>
                {t(
                  'Per token, consistent with official pricing. For the same model, fees differ by resolution and whether video input is included; fees also differ across models — see the'
                )}{' '}
                <a
                  href={`${siteUrl}/pricing`}
                  className='text-primary hover:underline'
                >
                  {t('Model Square')}
                </a>
                {t('.')}
              </>
            }
          />
          <FaqItem
            q={t('Q9: How does the platform bill?')}
            a={t(
              'A fee is pre-deducted when the task is submitted; after completion it is settled by the actual token consumption returned officially, with refunds or extra charges as appropriate.'
            )}
          />
          <FaqItem
            q={t('Q10: Are failed tasks charged?')}
            a={t('No. Failed tasks are not charged.')}
          />
        </>
      ),
    },
    {
      id: 'faq-models',
      title: t('Models & Capabilities'),
      body: (
        <>
          <FaqItem
            q={t(
              'Q11: Which models are supported? Are text/image/video capabilities all covered?'
            )}
            a={t('All three capabilities — text, image, and video — are fully integrated.')}
          />
          <FaqItem
            q={t('Q12: Can task details be read back? Is reconciliation convenient?')}
            a={t(
              'Yes. The task query endpoint returns task number, status, progress, result URL, token usage, etc., facilitating reconciliation.'
            )}
          />
        </>
      ),
    },
    {
      id: 'faq-stability',
      title: t('Stability & Delivery Positioning'),
      body: (
        <FaqItem
          q={t('Q13: How is supply stability? Can it support formal delivery?')}
          a={t(
            'Upstream resources come from Volcano Ark; on upstream fluctuations the channel can be switched silently to improve system stability.'
          )}
        />
      ),
    },
  ]
}

export function getDocSections(
  tab: DocsTabId,
  siteUrl: string,
  t: DocsTranslate
): DocSection[] {
  if (tab === 'image') return buildImageSections(siteUrl, t)
  if (tab === 'video') return buildVideoSections(siteUrl, t)
  if (tab === 'faq') return buildFaqSections(siteUrl, t)
  return buildLanguageSections(siteUrl, t)
}
