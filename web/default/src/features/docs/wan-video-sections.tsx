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
import { CodeBlock } from './code-block'
import type { DocSection, DocsTranslate } from './content'
import { DocText, Note, P } from './doc-typography'

const WAN_MODEL = 'wan3.0-video'

export function buildWanVideoSections(
  siteUrl: string,
  t: DocsTranslate
): DocSection[] {
  const submitUrl = `${siteUrl}/api/v1/services/aigc/video-generation/video-synthesis`
  const tasksUrl = `${siteUrl}/api/v1/tasks`
  return [
    {
      id: 'wan-overview',
      title: t('Integration Overview'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'This endpoint is fully compatible with the official Alibaba Cloud DashScope video generation API: replace the base_url with this site and use your token from this site as the API key — request paths, request bodies and response formats stay identical to the official API.'
              )}
            />
          </P>
        </>
      ),
    },
    {
      id: 'wan-submit',
      title: t('Submit Video Generation Task'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Creates an asynchronous video generation task. `input.prompt` describes the video; for image-to-video pass the first frame via `input.img_url`. `parameters.resolution` selects the resolution tier (e.g. `480P` / `720P` / `1080P`), `parameters.ratio` the aspect ratio (`adaptive` follows the input image), and `parameters.duration` the video length in seconds (`-1` lets the model decide the duration automatically).'
              )}
            />
          </P>
          <CodeBlock
            method='POST'
            url={submitUrl}
            lang='bash'
            code={`curl ${submitUrl} \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  -H "Content-Type: application/json" \\
  -H "X-DashScope-Async: enable" \\
  -d '{
    "model": "${WAN_MODEL}",
    "input": {
      "prompt": "一只小猫在月光下的屋顶上奔跑，城市的霓虹灯在远处闪烁，电影级画质，流畅运镜。"
    },
    "parameters": {
      "resolution": "480P",
      "ratio": "adaptive",
      "duration": 5
    }
  }'`}
          />
          <CodeBlock
            title={t('Response example')}
            lang='json'
            code={`{
  "output": {
    "task_id": "a8532587-fa8c-4ef8-82be-0c46b17950d1",
    "task_status": "PENDING"
  },
  "request_id": "7574ee8f-38a3-4b1e-9280-11c33ab46e51"
}`}
          />
          <Note>
            <DocText
              text={t(
                'Keep the returned `output.task_id` for querying the task. Tasks are asynchronous: poll the query endpoint until `task_status` reaches a terminal state.'
              )}
            />
          </Note>
        </>
      ),
    },
    {
      id: 'wan-query',
      title: t('Query Video Generation Task'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Queries the latest task status in real time. When `task_status` is `SUCCEEDED`, `output.video_url` contains the generated video download URL and `usage` reports the actual billed duration and resolution.'
              )}
            />
          </P>
          <CodeBlock
            method='GET'
            url={`${tasksUrl}/{task_id}`}
            lang='bash'
            code={`# ${t('Replace {task_id} with the id returned by the task submission')}
curl ${tasksUrl}/{task_id} \\
  -H "Authorization: Bearer ${t('sk-your-token')}"`}
          />
          <CodeBlock
            title={t('Response example')}
            lang='json'
            code={`{
  "output": {
    "task_id": "a8532587-fa8c-4ef8-82be-0c46b17950d1",
    "task_status": "SUCCEEDED",
    "submit_time": "2026-01-01 12:00:00.000",
    "end_time": "2026-01-01 12:01:30.000",
    "video_url": "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/xxx/demo.mp4"
  },
  "usage": {
    "duration": 5,
    "video_count": 1,
    "SR": 480
  },
  "request_id": "caa089cb-b78c-42a5-9d1a-3f19b1a44b83"
}`}
          />
          <Note>
            <DocText
              text={t(
                'Task status flow: `PENDING` → `RUNNING` → `SUCCEEDED` / `FAILED` / `CANCELED` / `UNKNOWN`. Failed tasks include `code` and `message` describing the failure reason.'
              )}
            />
          </Note>
        </>
      ),
    },
  ]
}