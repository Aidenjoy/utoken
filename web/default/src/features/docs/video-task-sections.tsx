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
import type { DocSection } from './content'
import { InlineCode, Note, P } from './doc-typography'

const VIDEO_MODEL = 'doubao-seedance-2.0'

export function buildVideoTaskSections(siteUrl: string): DocSection[] {
  const tasksUrl = `${siteUrl}/api/v3/contents/generations/tasks`
  return [
    {
      id: 'video-list',
      title: '查询任务列表',
      body: (
        <>
          <P>
            查询当前账号创建的视频生成任务。可通过{' '}
            <InlineCode>filter.model</InlineCode>、{' '}
            <InlineCode>filter.status</InlineCode> 和{' '}
            <InlineCode>filter.service_tier</InlineCode> 过滤；需要按任务 ID
            查询时，可重复传入 <InlineCode>filter.task_ids</InlineCode>。
          </P>
          <P>
            <InlineCode>page_num</InlineCode> 默认 1，
            <InlineCode>page_size</InlineCode> 默认 20，二者取值范围均为 1-500；
            <InlineCode>filter.service_tier</InlineCode> 默认为{' '}
            <InlineCode>default</InlineCode>，也可设为{' '}
            <InlineCode>flex</InlineCode>。
          </P>
          <CodeBlock
            method='GET'
            url={tasksUrl}
            lang='bash'
            code={`curl -G ${tasksUrl} \\
  -H "Authorization: Bearer sk-你的token" \\
  --data-urlencode "filter.model=${VIDEO_MODEL}" \\
  --data-urlencode "filter.status=succeeded" \\
  --data-urlencode "filter.service_tier=default" \\
  --data-urlencode "filter.task_ids=cgt-20260826120000-abc12" \\
  --data-urlencode "filter.task_ids=cgt-20260826120001-def34" \\
  --data-urlencode "page_num=1" \\
  --data-urlencode "page_size=20"`}
          />
          <CodeBlock
            title='响应示例'
            lang='json'
            code={`{
  "items": [
    {
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
    }
  ],
  "total": 1
}`}
          />
          <Note>
            列表仅包含当前账号创建且当前 Key
            有权访问的任务；其他用户及共享上游账号中的任务不会出现在结果中。
          </Note>
          <Note>
            列表项与单任务查询使用相同的任务字段，失败任务包含{' '}
            <InlineCode>error</InlineCode>，开启尾帧返回时包含{' '}
            <InlineCode>content.last_frame_url</InlineCode>。
          </Note>
        </>
      ),
    },
    {
      id: 'video-delete',
      title: '取消或删除任务',
      body: (
        <>
          <P>
            对 <InlineCode>queued</InlineCode>{' '}
            状态的任务调用该接口会取消任务；对{' '}
            <InlineCode>succeeded</InlineCode> / <InlineCode>failed</InlineCode>{' '}
            / <InlineCode>cancelled</InlineCode> /{' '}
            <InlineCode>expired</InlineCode>{' '}
            状态的终态任务调用该接口会删除任务记录。
          </P>
          <CodeBlock
            method='DELETE'
            url={`${tasksUrl}/{task_id}`}
            lang='bash'
            code={`# 将 {task_id} 替换为提交任务返回的 id
curl -X DELETE ${tasksUrl}/{task_id} \\
  -H "Authorization: Bearer sk-你的token"`}
          />
          <CodeBlock title='成功响应' lang='json' code='{}' />
          <Note>
            <InlineCode>running</InlineCode> 状态的任务不能取消或删除，接口返回
            HTTP 409。取消成功后任务状态变为 <InlineCode>cancelled</InlineCode>
            ；已删除的任务不再出现在任务列表和单任务查询结果中，重复删除返回
            HTTP 404。
          </Note>
        </>
      ),
    },
  ]
}
