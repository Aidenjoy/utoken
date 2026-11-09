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

const VIDEO_MODEL = 'doubao-seedance-2.0'

export function buildVideoTaskSections(
  siteUrl: string,
  t: DocsTranslate
): DocSection[] {
  const tasksUrl = `${siteUrl}/api/v3/contents/generations/tasks`
  return [
    {
      id: 'video-list',
      title: t('List Content Generation Tasks'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Lists video generation tasks created under the current account. Filter via `filter.model`, `filter.status`, and `filter.service_tier`; to query by task ID, pass `filter.task_ids` repeatedly.'
              )}
            />
          </P>
          <P>
            <DocText
              text={t(
                '`page_num` defaults to 1 and `page_size` to 20, both in the range 1-500; `filter.service_tier` defaults to `default` and can also be set to `flex`.'
              )}
            />
          </P>
          <CodeBlock
            method='GET'
            url={tasksUrl}
            lang='bash'
            code={`curl -G ${tasksUrl} \\
  -H "Authorization: Bearer ${t('sk-your-token')}" \\
  --data-urlencode "filter.model=${VIDEO_MODEL}" \\
  --data-urlencode "filter.status=succeeded" \\
  --data-urlencode "filter.service_tier=default" \\
  --data-urlencode "filter.task_ids=cgt-20260826120000-abc12" \\
  --data-urlencode "filter.task_ids=cgt-20260826120001-def34" \\
  --data-urlencode "page_num=1" \\
  --data-urlencode "page_size=20"`}
          />
          <CodeBlock
            title={t('Response example')}
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
            {t(
              'The list only includes tasks created under the current account and accessible to the current Key; tasks of other users or shared upstream accounts never appear in results.'
            )}
          </Note>
          <Note>
            <DocText
              text={t(
                'List items use the same task fields as single-task queries; failed tasks include `error`, and tasks with last-frame return enabled include `content.last_frame_url`.'
              )}
            />
          </Note>
        </>
      ),
    },
    {
      id: 'video-delete',
      title: t('Cancel or Delete Content Generation Task'),
      body: (
        <>
          <P>
            <DocText
              text={t(
                'Calling this endpoint on a `queued` task cancels it; calling it on a terminal task in `succeeded` / `failed` / `cancelled` / `expired` state deletes the task record.'
              )}
            />
          </P>
          <CodeBlock
            method='DELETE'
            url={`${tasksUrl}/{task_id}`}
            lang='bash'
            code={`# ${t('Replace {task_id} with the id returned by the task submission')}
curl -X DELETE ${tasksUrl}/{task_id} \\
  -H "Authorization: Bearer ${t('sk-your-token')}"`}
          />
          <CodeBlock title={t('Response example')} lang='json' code='{}' />
          <Note>
            <DocText
              text={t(
                'A `running` task cannot be cancelled or deleted — the endpoint returns HTTP 409. After a successful cancellation the task status becomes `cancelled`; deleted tasks no longer appear in the task list or single-task queries, and repeated deletion returns HTTP 404.'
              )}
            />
          </Note>
        </>
      ),
    },
  ]
}
